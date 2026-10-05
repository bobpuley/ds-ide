#include "audio_device_rtaudio.h"
#include "rtaudio_adapt.h"

#include "RtAudio.h"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace daisy_emu {

namespace {

// Returns the RtAudio API selected by DS_EMU_AUDIO_API among the compiled ones
// (WASAPI by default), or RtAudio::UNSPECIFIED if none is compiled in.
RtAudio::Api select_api(std::string& nameOut) {
    std::vector<RtAudio::Api> apis;
    RtAudio::getCompiledApi(apis);
    std::vector<std::string> names;
    names.reserve(apis.size());
    for (RtAudio::Api a : apis) names.push_back(RtAudio::getApiName(a));
    nameOut = rtaudio_adapt::choose_api_name(std::getenv("DS_EMU_AUDIO_API"), names);
    return nameOut.empty() ? RtAudio::UNSPECIFIED : RtAudio::getCompiledApiByName(nameOut);
}

}  // namespace

struct RtAudioDevice::Impl {
    std::string apiName;
    RtAudio rt;
    rtaudio_adapt::OutputRenderer renderer;
    std::atomic<float> latencyMs{0.f};

    explicit Impl(RtAudio::Api api, std::string name)
        : apiName(std::move(name)),
          rt(api, [](RtAudioErrorType type, const std::string& text) {
              // Setup errors only reach here off the audio thread; warnings
              // are silenced below.
              if (type != RTAUDIO_WARNING)
                  std::fprintf(stderr, "[daisy-emu] RtAudio: %s\n", text.c_str());
          }) {
        rt.showWarnings(false);
    }

    // RtAudio callback (driver thread). Interleaved float32, outChannels wide.
    static int outputCallback(void* outputBuffer, void* /*inputBuffer*/, unsigned int nFrames,
                              double /*streamTime*/, RtAudioStreamStatus status, void* userData) {
        auto* self = static_cast<Impl*>(userData);
        self->renderer.render(static_cast<float*>(outputBuffer), nFrames,
                              (status & RTAUDIO_OUTPUT_UNDERFLOW) != 0);
        return 0;  // keep streaming
    }
};

RtAudioDevice::RtAudioDevice() = default;

RtAudioDevice::~RtAudioDevice() {
    stop();
}

bool RtAudioDevice::start(uint32_t /*sampleRate*/, uint32_t /*bufferSize*/, ProcessFn /*processBlock*/) {
    // Duplex lands in a later M80 task; failing here makes the engine send
    // realtime_unavailable and fall back to simulated mode.
    return false;
}

bool RtAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    if (running_) stop();

    std::string apiName;
    const RtAudio::Api api = select_api(apiName);
    if (api == RtAudio::UNSPECIFIED) return false;
    impl_ = std::make_unique<Impl>(api, apiName);

    const unsigned int deviceId = impl_->rt.getDefaultOutputDevice();
    if (deviceId == 0) { stop(); return false; }  // 0 = no output device
    const RtAudio::DeviceInfo info = impl_->rt.getDeviceInfo(deviceId);
    if (info.outputChannels == 0) { stop(); return false; }

    // Open at most two channels: stereo devices take L/R as-is, mono devices
    // get the left channel (adapted in OutputRenderer).
    RtAudio::StreamParameters out;
    out.deviceId     = deviceId;
    out.nChannels    = std::min(info.outputChannels, 2u);
    out.firstChannel = 0;

    RtAudio::StreamOptions opts;
    opts.flags      = RTAUDIO_SCHEDULE_REALTIME;
    opts.streamName = "daisy-emu";

    // Sized for the requested buffer before the stream exists; a driver that
    // picks a larger buffer is chunked down to this size in render().
    impl_->renderer.prepare(std::move(processBlock), sampleRate, bufferSize, out.nChannels);

    unsigned int frames = bufferSize;  // RtAudio writes back the size it opened with
    if (impl_->rt.openStream(&out, nullptr, RTAUDIO_FLOAT32, sampleRate, &frames,
                             &Impl::outputCallback, impl_.get(), &opts) != RTAUDIO_NO_ERROR) {
        stop(); return false;
    }
    if (impl_->rt.startStream() != RTAUDIO_NO_ERROR) { stop(); return false; }

    impl_->latencyMs.store(
        rtaudio_adapt::stream_latency_ms(impl_->apiName, impl_->rt.getStreamLatency(), frames,
                                         impl_->rt.getStreamSampleRate()),
        std::memory_order_relaxed);
    running_ = true;
    return true;
}

uint32_t RtAudioDevice::maxCallbackFrames(uint32_t requestedBufferSize) const {
    // OutputRenderer splits larger driver callbacks into requested-size chunks.
    return requestedBufferSize;
}

void RtAudioDevice::stop() {
    if (impl_) {
        // stopStream() joins the driver's callback thread before returning, so
        // the renderer's buffers are no longer in use when impl_ is destroyed.
        if (impl_->rt.isStreamRunning()) impl_->rt.stopStream();
        if (impl_->rt.isStreamOpen()) impl_->rt.closeStream();
        impl_.reset();
    }
    running_ = false;
}

uint32_t RtAudioDevice::drainXruns() {
    return impl_ ? impl_->renderer.drainXruns() : 0;
}

uint32_t RtAudioDevice::drainDriverOverruns() {
    return impl_ ? impl_->renderer.drainDriverOverruns() : 0;
}

float RtAudioDevice::lastLatencyMs() const {
    return impl_ ? impl_->latencyMs.load(std::memory_order_relaxed) : 0.f;
}

}  // namespace daisy_emu
