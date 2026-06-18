#pragma once
#include <cstdint>
#include <functional>

namespace daisy_emu {

// Duplex CoreAudio device for macOS real-time audio I/O.
//
// Opens the default AUHAL input+output unit. The output render callback pulls
// live input via AudioUnitRender(bus=1) and passes it through to the user
// processBlock function, which runs the Daisy effect.
//
// On non-Apple platforms this compiles to a no-op stub.
//
// processBlock signature: (const float* in_interleaved, float* out_interleaved, size_t frames)
// Both buffers are stereo-interleaved (L0,R0,L1,R1,...).

class CoreAudioDevice {
public:
    using ProcessFn = std::function<void(const float*, float*, size_t)>;

    CoreAudioDevice();
    ~CoreAudioDevice();

    // Start duplex I/O with the given sample rate and buffer size.
    // The processBlock function is called from the real-time callback thread.
    // Returns true on success.
    bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock);

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
