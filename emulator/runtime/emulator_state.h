#pragma once
#include <array>
#include <atomic>
#include <cassert>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include "daisy/audio_handle.h"
#include "session_recorder.h"
#include "session_player.h"
#include "wav_reader.h"

namespace daisy_emu {

// Clock mode: simulated = v1 sleep-paced loop; realtime = CoreAudio OS callback.
enum class AudioMode { Simulated = 0, Realtime = 1 };

// Lock-free single-producer / single-consumer ring buffer for IPC messages
// emitted from the CoreAudio real-time thread (AC-39).
//
// Producer (RT thread): push() — no mutex, no heap allocation after construction.
// Consumer (drain thread): pop() — no mutex on the producer path.
// Slot strings are pre-reserved to MAX_MSG bytes so assign() inside push()
// never triggers heap reallocation for typical scope/spectrum messages.
struct SpscIpcQueue {
    static constexpr size_t CAPACITY = 64;
    // 80 kB: accommodates the maximum scope message (~76 kB at SCOPE_BLOCKS=33,
    // SCOPE_STEP=4, rt_buffer_size=256). Must be ≥ that size to prevent
    // std::string::assign from reallocating on the RT thread.
    static constexpr size_t MAX_MSG  = 81920;

    struct alignas(64) Slot { std::string msg; };

    // Counts messages that arrived at push() already larger than MAX_MSG and
    // had to be truncated (FR-EMU-2) — a regression backstop for any future
    // producer (scope/spectrum or otherwise) that miscalculates its budget.
    // Public, like ipc_queue_drops on EmulatorState, so the drain thread can
    // fold it into the existing periodic drop report.
    std::atomic<uint32_t> oversize_drops{0};

    SpscIpcQueue() {
        for (auto& s : slots_) s.msg.reserve(MAX_MSG);
    }

    // Called from RT thread. Returns false if queue is full (message is dropped).
    // A message larger than MAX_MSG is truncated rather than assigned in full
    // (FR-EMU-2): slots_ are pre-reserved to exactly MAX_MSG bytes, so an
    // over-budget assign() would force a heap reallocation on this RT thread.
    bool push(const std::string& m) {
        size_t w    = write_.load(std::memory_order_relaxed);
        size_t next = (w + 1) % CAPACITY;
        if (next == read_.load(std::memory_order_acquire)) return false;
        if (m.size() > MAX_MSG) {
            slots_[w].msg.assign(m, 0, MAX_MSG);
            oversize_drops.fetch_add(1, std::memory_order_relaxed);
        } else {
            slots_[w].msg.assign(m);  // no alloc: capacity pre-reserved in constructor
        }
        assert(slots_[w].msg.size() <= MAX_MSG);
        write_.store(next, std::memory_order_release);
        return true;
    }

    // Overload for NUL-terminated C strings — avoids constructing a temporary
    // std::string on the RT thread when called with a string literal or char buf[].
    bool push(const char* m) {
        size_t w    = write_.load(std::memory_order_relaxed);
        size_t next = (w + 1) % CAPACITY;
        if (next == read_.load(std::memory_order_acquire)) return false;
        size_t len = std::strlen(m);
        if (len > MAX_MSG) {
            slots_[w].msg.assign(m, MAX_MSG);
            oversize_drops.fetch_add(1, std::memory_order_relaxed);
        } else {
            slots_[w].msg.assign(m);  // no alloc: capacity pre-reserved in constructor
        }
        assert(slots_[w].msg.size() <= MAX_MSG);
        write_.store(next, std::memory_order_release);
        return true;
    }

    // Called from drain thread. Returns false when queue is empty.
    bool pop(std::string& out) {
        size_t r = read_.load(std::memory_order_relaxed);
        if (r == write_.load(std::memory_order_acquire)) return false;
        out.assign(slots_[r].msg);
        read_.store((r + 1) % CAPACITY, std::memory_order_release);
        return true;
    }

private:
    std::array<Slot, CAPACITY> slots_;
    std::atomic<size_t> write_{0};
    std::atomic<size_t> read_{0};
};

struct EmulatorState {
    // Audio configuration — set via IPC config message or shim calls
    std::atomic<float>  sample_rate{48000.f};
    std::atomic<size_t> block_size{48};
    // FR-EMU-7: bumped whenever the `config` IPC handler updates sample_rate
    // or block_size, alongside notifying mode_cv. The active mode loop
    // (run_simulated/run_realtime in audio_engine.cpp) wakes on this even
    // when audio_mode itself hasn't changed, so it can return and let the
    // outer engine loop re-enter it with freshly re-read values — otherwise
    // a config update would only take effect after the next explicit mode
    // switch, and the values captured once at run_audio_engine() startup
    // would silently go stale for the rest of the session.
    std::atomic<uint64_t> config_generation{0};

    // Transport
    std::atomic<bool> transport_running{false};
    std::atomic<bool> shutdown{false};

    // Sine generator
    std::atomic<float> sine_freq{440.f};
    std::atomic<float> sine_amp{0.353553f};  // ~-9 dBFS

    // ADC pot values (0..1), one per channel (Daisy Seed has 12 ADC channels)
    std::atomic<float> pot_values[12];

    // v2 (M10): virtual button state, indexed by canonical_gpio_index(pin) (AC-48).
    // Written by the IPC `button`/`buttonSnapshot` thread, read by the Switch
    // shim's Debounce(). The stored value is the *logical* press (active_level
    // is resolved UI-side), so Switch::Pressed() returns it directly.
    // kNumGpioPins = 64: port=0 occupies 0–30 (D/A pins), port=1 occupies 32–37 (A6–A11).
    static constexpr int kNumGpioPins = 64;
    std::atomic<bool> button_states[kNumGpioPins];

    // v2 (M10): LED output. The LED shim (SetLed / Led::Update) emits a `led`
    // IPC message on each *change*; led_last_state holds the last emitted level
    // per pin (-1 = none yet) so unchanged writes are suppressed. The onboard
    // user LED maps to D23 = canonical_gpio_index({0, 23}) = 23.
    static constexpr int kOnboardLedPin = 23;
    std::atomic<int8_t> led_last_state[kNumGpioPins];

    // FR-DEV-7: virtual toggle-switch (Switch3) position, indexed by
    // canonical_gpio_index(pin). Written by the IPC `controlValue`/
    // `controlSnapshot` handler (tgl<N> ids), read by the Switch3 shim's
    // Debounce(). Value is an integer position: 0, 1, or 2.
    std::atomic<int> toggle_states[kNumGpioPins];

    // FR-DEV-8: last-emitted RGB LED channel values, indexed by
    // canonical_gpio_index(r_pin) — the RgbLed shim's dedup state (mirrors
    // led_last_state's change-suppression, extended to three channels).
    // -1.f sentinel means "not yet emitted" (a valid brightness is 0..1).
    std::atomic<float> rgb_r_last[kNumGpioPins];
    std::atomic<float> rgb_g_last[kNumGpioPins];
    std::atomic<float> rgb_b_last[kNumGpioPins];

    // FR-DEV-9: encoder's accumulated position, indexed by
    // canonical_gpio_index(a_pin) — the primary (A-channel) pin. Written by
    // the IPC `controlValue` handler (enc<N> ids) as a value already wrapped
    // into [0, kEncoderPositionModulus); the Encoder shim's Debounce() derives
    // a per-callback delta by diffing against its own previously-read value
    // (mirrors button_states being read by Switch::Debounce()). The click
    // pin reuses button_states directly — no separate state needed for it.
    static constexpr int32_t kEncoderPositionModulus = 1024;
    std::atomic<int32_t> encoder_positions[kNumGpioPins];

    // v2: audio mode (simulated / realtime) and real-time audio configuration
    std::atomic<int>    audio_mode{0};           // AudioMode enum value
    std::atomic<size_t> rt_buffer_size{256};     // target buffer size for CoreAudio (FR-AU-9)
    std::atomic<uint32_t> xrun_count{0};         // incremented by CoreAudio on deadline miss
    // M15: master output volume (0.0–1.0) applied before CoreAudio write
    std::atomic<float>  output_volume{1.f};

    // v2 (M9): WAV file input. When wav_active is true, the simulated-clock loop
    // feeds wav_data into the input buffer instead of the sine generator.
    // wav_generation bumps on each (un)load so the engine can reset its playhead.
    //
    // wav_data_ptr / wav_data_in_use replace a wav_mutex + shared_ptr copy on
    // the RT thread (FR-RTS-3): the IPC thread publishes a new WavData via an
    // atomic pointer swap (retireWavData() in ipc_server.cpp — release-ordered,
    // no mutex); the audio engine loads it once per block (acquire) and
    // republishes the pointer it is currently reading via wav_data_in_use so
    // the IPC thread can confirm the engine has moved off the old WavData
    // before deleting it.
    std::atomic<bool>     wav_active{false};
    std::atomic<bool>     wav_loop{false};
    std::atomic<uint64_t> wav_generation{0};
    std::atomic<const WavData*> wav_data_ptr{nullptr};
    std::atomic<const WavData*> wav_data_in_use{nullptr};

    // v2 (M14): session recorder and player.
    // recorder is driven by the audio engine (enqueueBlock per block, RT-safe)
    // and the IPC thread (enqueuePot/enqueueButton, under recorder_mutex).
    // player is used by run_simulated as an input source when replay_active is
    // true; its RT-facing popBlock() (FR-RTS-3) needs no external locking —
    // player_mutex only guards the non-RT open()/close() lifecycle calls made
    // from the IPC and engine-management threads.
    std::mutex       recorder_mutex;
    SessionRecorder  recorder;
    std::mutex       player_mutex;
    SessionPlayer    player;
    std::atomic<bool> replay_active{false};

    // Audio mode change notification — audio engine waits on this when in realtime mode.
    std::mutex              mode_mutex;
    std::condition_variable mode_cv;

    // Audio callbacks — exactly one is set by shim StartAudio(), read by audio engine.
    // Interleaved form (v1.0): InterleavingAudioCallback — flat L/R array.
    // Block/non-interleaved form (v1.1): AudioCallback — per-channel pointer array.
    // atomic (FR-QA-EMU-3): each StartAudio() overload nulls the other pointer,
    // and the audio engine re-reads both per block so a StartAudio() call made
    // after the engine has already started is picked up on the next block
    // instead of being latched to whichever overload ran first.
    std::atomic<daisy::AudioHandle::InterleavingAudioCallback> interleaving_cb{nullptr};
    std::atomic<daisy::AudioHandle::AudioCallback>             block_cb{nullptr};
    std::mutex              callback_mutex;
    std::condition_variable callback_cv;
    bool                    callback_set{false};

    // IPC output — set by ipc_server when a client is connected; nullptr otherwise.
    // Audio engine calls this to emit scope/status/event JSON lines.
    std::mutex                        send_mutex;
    std::function<void(std::string)>  send_ipc;

    // Lock-free queue for IPC messages posted from the RT audio thread (AC-39).
    // The drain thread in run_audio_engine() reads this and forwards via send_ipc.
    SpscIpcQueue ipc_queue;
    // Counts messages silently dropped when ipc_queue is full (FR-QA-1).
    std::atomic<uint32_t> ipc_queue_drops{0};

    // FR-DEV-14: a second, dedicated queue for OLED framebuffer frames — same
    // lock-free, non-allocating type as ipc_queue, but a separate instance.
    // OledDisplay::Update() is called from the effect's own while(1) loop
    // (effect_main()'s thread, see runtime/main.cpp), not the audio engine's
    // RT callback thread that owns ipc_queue; sharing that single instance
    // would turn it into a two-producer queue and break its SPSC invariant.
    // Drained alongside ipc_queue by the same drain thread in
    // run_audio_engine() — one consumer thread servicing two independent
    // SPSC queues is safe, since each queue's own single-producer/
    // single-consumer contract is unaffected by what else that thread does.
    SpscIpcQueue oled_queue;
    // Counts messages silently dropped when oled_queue is full.
    std::atomic<uint32_t> oled_queue_drops{0};

    EmulatorState() {
        for (auto& v : pot_values) v.store(0.f);
        for (auto& b : button_states) b.store(false);
        for (auto& l : led_last_state) l.store(-1);
        for (auto& t : toggle_states) t.store(0);
        for (auto& v : rgb_r_last) v.store(-1.f);
        for (auto& v : rgb_g_last) v.store(-1.f);
        for (auto& v : rgb_b_last) v.store(-1.f);
        for (auto& p : encoder_positions) p.store(0);
    }
};

// Single global instance — defined in runtime/main.cpp.
extern EmulatorState g_state;

}  // namespace daisy_emu
