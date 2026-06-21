#pragma once
#include <array>
#include <atomic>
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
    static constexpr size_t CAPACITY = 32;
    static constexpr size_t MAX_MSG  = 16384;

    struct alignas(64) Slot { std::string msg; };

    SpscIpcQueue() {
        for (auto& s : slots_) s.msg.reserve(MAX_MSG);
    }

    // Called from RT thread. Returns false if queue is full (message is dropped).
    bool push(const std::string& m) {
        size_t w    = write_.load(std::memory_order_relaxed);
        size_t next = (w + 1) % CAPACITY;
        if (next == read_.load(std::memory_order_acquire)) return false;
        slots_[w].msg.assign(m);  // no alloc: capacity pre-reserved in constructor
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

    // v2: audio mode (simulated / realtime) and real-time audio configuration
    std::atomic<int>    audio_mode{0};           // AudioMode enum value
    std::atomic<size_t> rt_buffer_size{256};     // target buffer size for CoreAudio (FR-AU-9)
    std::atomic<uint32_t> xrun_count{0};         // incremented by CoreAudio on deadline miss
    // M15: master output volume (0.0–1.0) applied before CoreAudio write
    std::atomic<float>  output_volume{1.f};

    // v2 (M9): WAV file input. When wav_active is true, the simulated-clock loop
    // feeds wav_data into the input buffer instead of the sine generator.
    // wav_data is published under wav_mutex by the IPC thread; the audio engine
    // copies the shared_ptr per block. wav_generation bumps on each (un)load so
    // the engine can reset its playhead.
    std::atomic<bool>     wav_active{false};
    std::atomic<bool>     wav_loop{false};
    std::atomic<uint64_t> wav_generation{0};
    std::mutex                       wav_mutex;
    std::shared_ptr<const WavData>   wav_data;

    // v2 (M14): session recorder and player.
    // recorder is driven by the audio engine (writeBlock per block) and the IPC
    // thread (enqueuePot/enqueueButton). player is used by run_simulated as an
    // input source when replay_active is true.
    // Both fields are protected by recorder_mutex / player_mutex.
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
    daisy::AudioHandle::InterleavingAudioCallback interleaving_cb{nullptr};
    daisy::AudioHandle::AudioCallback             block_cb{nullptr};
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

    EmulatorState() {
        for (auto& v : pot_values) v.store(0.f);
        for (auto& b : button_states) b.store(false);
        for (auto& l : led_last_state) l.store(-1);
    }
};

// Single global instance — defined in runtime/main.cpp.
extern EmulatorState g_state;

}  // namespace daisy_emu
