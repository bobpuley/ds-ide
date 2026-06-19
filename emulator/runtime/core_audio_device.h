#pragma once
#include <cstdint>
#include <functional>

namespace daisy_emu {

// CoreAudio device for macOS audio I/O.
//
// Two modes:
//   start()             — full-duplex AUHAL: pulls live mic input via AudioUnitRender,
//                         requires microphone permission.
//   start_output_only() — output-only AUHAL: no input bus, no mic permission needed.
//                         processBlock receives a zeroed input buffer; the caller
//                         generates its own audio input (sine, WAV, etc.).
//
// On non-Apple platforms both methods compile to no-op stubs.
//
// processBlock signature: (const float* in_interleaved, float* out_interleaved, size_t frames)
// Both buffers are stereo-interleaved (L0,R0,L1,R1,...).

class CoreAudioDevice {
public:
    using ProcessFn = std::function<void(const float*, float*, size_t)>;

    CoreAudioDevice();
    ~CoreAudioDevice();

    // Start duplex I/O (mic + speakers). Requires microphone permission.
    // Returns true on success.
    bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock);

    // Start output-only (speakers only, no mic). Does not require microphone permission.
    // processBlock receives a zeroed input buffer; caller generates its own audio input.
    // Returns true on success.
    bool start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock);

    void stop();

    bool isRunning() const { return running_; }

    // Returns the number of xruns accumulated since the last call and resets the counter.
    uint32_t drainXruns();

    // Returns the most recently measured round-trip latency in milliseconds.
    // Updated once per output render callback.
    float lastLatencyMs() const;

private:
#ifdef __APPLE__
    struct Impl;
    Impl* impl_{nullptr};
#endif
    bool running_{false};
};

} // namespace daisy_emu
