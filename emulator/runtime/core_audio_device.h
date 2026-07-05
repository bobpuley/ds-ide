#pragma once
#include <cstdint>
#include <functional>
#include <memory>

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

    // Impl is heap-owned via unique_ptr; copying would otherwise yield two
    // owners of the same Impl and a double `delete` when both destruct
    // (FR-QA-EMU-2).
    CoreAudioDevice(const CoreAudioDevice&)            = delete;
    CoreAudioDevice& operator=(const CoreAudioDevice&) = delete;

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

    // Returns the number of AudioUnitRender failures accumulated since the
    // last call and resets the counter (FR-EMU-3). Only incremented by the
    // duplex render callback (start()) — start_output_only() never calls
    // AudioUnitRender.
    uint32_t drainRenderErrors();

    // Returns the most recently measured round-trip latency in milliseconds.
    // Updated once per output render callback.
    float lastLatencyMs() const;

    // Returns the input hardware's actual queried sample rate from the most
    // recent start() call (0 if unavailable or start_output_only() was used) —
    // for the caller to compare against the engine's configured rate and
    // surface a sample_rate_mismatch event (FR-EMU-3).
    float queriedInputSampleRate() const;

private:
#ifdef __APPLE__
    struct Impl;
    std::unique_ptr<Impl> impl_;
#endif
    bool running_{false};
};

} // namespace daisy_emu
