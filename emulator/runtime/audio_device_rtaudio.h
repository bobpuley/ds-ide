#pragma once
#include "audio_device.h"

namespace daisy_emu {

// Windows backend built on RtAudio (FR-WIN-AUD-5). WASAPI by default;
// DS_EMU_AUDIO_API=asio selects ASIO when the build compiled it in (see
// emulator/CMakeLists.txt, ASIO_SDK_DIR), otherwise WASAPI is used.
//
//   start_output_only() — output-only stream on the default output device; no
//                         input stream is opened.
//   start()             — duplex: not implemented yet, returns false so the
//                         engine falls back to simulated mode.
class RtAudioDevice final : public AudioDevice {
public:
    RtAudioDevice();
    ~RtAudioDevice() override;

    bool start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    bool start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) override;
    void stop() override;
    bool isRunning() const override { return running_; }
    uint32_t maxCallbackFrames(uint32_t requestedBufferSize) const override;
    uint32_t drainXruns() override;
    uint32_t drainRenderErrors() override { return 0; }
    uint32_t drainDriverOverruns() override;
    float lastLatencyMs() const override;
    float queriedInputSampleRate() const override { return 0.f; }

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    bool running_{false};
};

}  // namespace daisy_emu
