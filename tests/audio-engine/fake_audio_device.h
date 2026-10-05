#pragma once
// FakeAudioDevice: AudioDevice test double (M79 / FR-WIN-AUD-4). Never opens
// hardware; shares its knobs/observations through fake_audio::g_fake.
#include "audio_device.h"
#include "fake_audio_backend.h"

namespace fake_audio {

class FakeAudioDevice final : public daisy_emu::AudioDevice {
public:
    FakeAudioDevice() = default;
    ~FakeAudioDevice() override { stop(); }

    bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    bool start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    void stop() override;
    bool isRunning() const override { return running_; }
    uint32_t maxCallbackFrames(uint32_t requestedBufferSize) const override;
    uint32_t drainXruns() override;
    uint32_t drainRenderErrors() override;
    uint32_t drainDriverOverruns() override;
    float lastLatencyMs() const override;
    float queriedInputSampleRate() const override;

private:
    bool begin(bool ok, uint32_t sampleRate, uint32_t bufferSize, ProcessFn fn, bool output_only);
    bool running_{false};
};

}  // namespace fake_audio
