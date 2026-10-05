#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>

namespace daisy_emu {

// Platform audio backend interface (FR-WIN-AUD-1).
//
// audio_engine.cpp talks to the host audio hardware only through this
// interface; the backend is chosen by make_audio_device() (audio_device_factory.cpp,
// the single place that branches on the platform). Implementations: CoreAudio
// on macOS, RtAudio on Windows, the no-backend NullAudioDevice everywhere else,
// and a fake in tests.
//
// Two modes:
//   start()             — full-duplex: pulls live input, may require an input
//                         permission (macOS microphone).
//   start_output_only() — output only: no input stream, no permission needed.
//                         processBlock receives a zeroed input buffer; the caller
//                         generates its own audio input (sine, WAV, etc.).
//
// processBlock signature: (const float* in_interleaved, float* out_interleaved, size_t frames).
// Both buffers are stereo-interleaved (L0,R0,L1,R1,...) regardless of how many
// channels the hardware has; adapting mono/multichannel hardware is the backend's job.
class AudioDevice {
public:
    using ProcessFn = std::function<void(const float*, float*, size_t)>;

    AudioDevice() = default;
    virtual ~AudioDevice() = default;

    // Backends own driver handles; copying or moving would yield two owners of
    // the same stream (FR-QA-EMU-2).
    AudioDevice(const AudioDevice&)            = delete;
    AudioDevice& operator=(const AudioDevice&) = delete;
    AudioDevice(AudioDevice&&)                 = delete;
    AudioDevice& operator=(AudioDevice&&)      = delete;

    // Start duplex I/O. Returns true on success.
    virtual bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) = 0;

    // Start output-only. Returns true on success.
    virtual bool start_output_only(uint32_t sampleRate, uint32_t bufferSize,
                                   ProcessFn processBlock) = 0;

    // Stops the stream and releases driver resources. Idempotent; safe on a
    // device that was never started.
    virtual void stop() = 0;

    virtual bool isRunning() const = 0;

    // Upper bound on the frame count a single processBlock call can carry for a
    // stream started with `requestedBufferSize`. Valid before start() so the
    // caller can size its work buffers up front, never on the real-time thread.
    // Always >= requestedBufferSize.
    virtual uint32_t maxCallbackFrames(uint32_t requestedBufferSize) const = 0;

    // Returns the number of xruns accumulated since the last call and resets
    // the counter. An xrun is a processBlock call that took longer than the
    // buffer duration it was asked to fill.
    virtual uint32_t drainXruns() = 0;

    // Returns the number of input-render failures accumulated since the last
    // call and resets the counter (FR-EMU-3). Only incremented by a duplex
    // stream's input path.
    virtual uint32_t drainRenderErrors() = 0;

    // Driver-level overflow/underflow count since the last call (resets the
    // counter): audio the *driver* reports it dropped or had to synthesise
    // (e.g. a Windows stream's input-overflow / output-underflow status).
    // Deliberately separate from drainXruns(), which only measures this
    // process's own callback CPU time. Backends with no such signal —
    // CoreAudio — always return 0 (FR-WIN-AUD-3).
    virtual uint32_t drainDriverOverruns() = 0;

    // Most recently measured round-trip latency in milliseconds (0 = unknown).
    virtual float lastLatencyMs() const = 0;

    // The input hardware's actual sample rate from the most recent start()
    // (0 if unavailable or start_output_only() was used), for the caller to
    // compare against the engine's configured rate and surface a
    // sample_rate_mismatch event (FR-EMU-3).
    virtual float queriedInputSampleRate() const = 0;
};

// Creates the platform's audio backend. Never returns null; when the platform
// has no backend the returned device's start*() calls simply return false.
std::unique_ptr<AudioDevice> make_audio_device();

}  // namespace daisy_emu
