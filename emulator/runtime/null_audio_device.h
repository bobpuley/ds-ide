#pragma once
#include "audio_device.h"

namespace daisy_emu {

// Fallback backend for platforms without a real implementation: every start*()
// fails, so the engine takes its existing fallbacks (realtime_unavailable ->
// simulated mode; output-only failure -> silent software loop).
class NullAudioDevice final : public AudioDevice {
public:
    bool start(uint32_t, uint32_t, ProcessFn) override { return false; }
    bool start_output_only(uint32_t, uint32_t, ProcessFn) override { return false; }
    void stop() override {}
    bool isRunning() const override { return false; }
    uint32_t maxCallbackFrames(uint32_t requestedBufferSize) const override { return requestedBufferSize; }
    uint32_t drainXruns() override { return 0; }
    uint32_t drainRenderErrors() override { return 0; }
    uint32_t drainDriverOverruns() override { return 0; }
    float lastLatencyMs() const override { return 0.f; }
    float queriedInputSampleRate() const override { return 0.f; }
};

}  // namespace daisy_emu
