#pragma once
#include "audio_device.h"

namespace daisy_emu {

// macOS CoreAudio (AUHAL) backend. Built only on Apple platforms — see
// audio_device_factory.cpp.
//
//   start()             — full-duplex AUHAL: pulls live mic input via AudioUnitRender,
//                         requires microphone permission.
//   start_output_only() — output-only AUHAL: no input bus, no mic permission needed.
class CoreAudioDevice final : public AudioDevice {
public:
    CoreAudioDevice();
    ~CoreAudioDevice() override;

    bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    bool start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    void stop() override;
    bool isRunning() const override { return running_; }
    uint32_t maxCallbackFrames(uint32_t requestedBufferSize) const override;
    uint32_t drainXruns() override;
    uint32_t drainRenderErrors() override;
    uint32_t drainDriverOverruns() override { return 0; }  // CoreAudio reports no driver overruns
    float lastLatencyMs() const override;
    float queriedInputSampleRate() const override;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    bool running_{false};
};

}  // namespace daisy_emu
