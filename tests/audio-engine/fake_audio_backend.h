#pragma once
// Deterministic fake audio backend for the real-time-path regression tests
// (M79 / FR-WIN-AUD-4).
//
// The tests link audio_engine.cpp against fake_core_audio_device.cpp instead of
// the real backend. The fake never opens hardware: start()/start_output_only()
// just capture the engine's ProcessFn, and the test thread plays "the audio
// driver" by calling FakeAudio::fire() with a frame count of its choosing.

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <mutex>

namespace fake_audio {

// Heap-allocation accounting for the "RT thread" (M79 / FR-WIN-AUD-2). While a
// thread has t_rt_section set, the test binary's replaced operator new counts
// allocations in t_rt_allocs. FakeAudio::fire() brackets the engine callback
// with it, so a test can assert the callback never touches the heap.
extern thread_local bool          t_rt_section;
extern thread_local unsigned long t_rt_allocs;

using ProcessFn = std::function<void(const float*, float*, size_t)>;

struct FakeAudio {
    // ---- Behaviour knobs (test -> fake) -------------------------------------
    std::atomic<bool>     duplex_ok{true};      // start() result
    std::atomic<bool>     output_ok{true};      // start_output_only() result
    std::atomic<uint32_t> pending_xruns{0};     // returned (and cleared) by drainXruns()
    std::atomic<uint32_t> pending_render_errors{0};
    std::atomic<uint32_t> pending_driver_overruns{0};
    std::atomic<float>    latency_ms{0.f};
    std::atomic<float>    queried_rate{0.f};    // queriedInputSampleRate() after start()
    std::atomic<uint32_t> max_callback_frames{0}; // maxCallbackFrames() floor (0 = requested size)

    // ---- Observations (fake -> test) ----------------------------------------
    std::atomic<int>      start_calls{0};
    std::atomic<int>      output_calls{0};
    std::atomic<int>      stop_calls{0};
    std::atomic<uint32_t> last_rate{0};
    std::atomic<uint32_t> last_buffer{0};
    std::atomic<unsigned long> last_fire_allocs{0};  // heap allocations during the last fire()

    // Reset every knob/observation and drop the captured callback.
    void reset();

    bool running();

    // Invoke the captured ProcessFn as the driver would: `in` is fed to the
    // callback (interleaved stereo, `frames` frames, every sample = in_value);
    // the callback's output is copied into `out` (resized to frames*2).
    // Heap allocations made by the callback are recorded in last_fire_allocs.
    // Returns false when no stream is running.
    bool fire(size_t frames, float in_value, float* out_capture = nullptr);

    // Internal — used by the fake device.
    std::mutex m;
    ProcessFn  cb;
    bool       is_running{false};
};

extern FakeAudio g_fake;

}  // namespace fake_audio
