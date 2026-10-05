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
    rtaudio_adapt::StreamRenderer renderer;
    std::atomic<float> latencyMs{0.f};
    // Buffer size RtAudio opened the stream with (written back by openStream()).
    // ASIO may round the request; RtAudio's WASAPI API keeps it and buffers
    // internally, so the coarser device period shows up in latency instead.
    uint32_t openedBufferFrames{0};
    // The input hardware's own rate (duplex only). RtAudio's WASAPI API
    // resamples to the stream rate, but a differing hardware rate is still
    // surfaced as sample_rate_mismatch, as on macOS (FR-EMU-3).
    float inputSampleRate{0.f};

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

    // RtAudio callback (driver thread). Interleaved float32; inputBuffer is
    // null for an output-only stream.
    static int callback(void* outputBuffer, void* inputBuffer, unsigned int nFrames,
                        double /*streamTime*/, RtAudioStreamStatus status, void* userData) {
        auto* self = static_cast<Impl*>(userData);
        self->renderer.render(static_cast<const float*>(inputBuffer),
                              static_cast<float*>(outputBuffer), nFrames,
                              (status & RTAUDIO_OUTPUT_UNDERFLOW) != 0,
                              (status & RTAUDIO_INPUT_OVERFLOW) != 0);
        return 0;  // keep streaming
    }
};

RtAudioDevice::RtAudioDevice() = default;

RtAudioDevice::~RtAudioDevice() {
    stop();
}

bool RtAudioDevice::start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    return open_and_start(sampleRate, bufferSize, std::move(processBlock), /*duplex=*/true);
}

bool RtAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    return open_and_start(sampleRate, bufferSize, std::move(processBlock), /*duplex=*/false);
}

bool RtAudioDevice::open_and_start(uint32_t sampleRate, uint32_t bufferSize,
                                   ProcessFn processBlock, bool duplex) {
    if (running_) stop();

    std::string apiName;
    const RtAudio::Api api = select_api(apiName);
    if (api == RtAudio::UNSPECIFIED) return false;
    impl_ = std::make_unique<Impl>(api, apiName);

    // Default devices; 0 = none. Input and output may be different devices
    // with independent clocks — RtAudio's WASAPI API runs both from one thread
    // and resamples each side to the stream rate.
    const unsigned int outId = impl_->rt.getDefaultOutputDevice();
    if (outId == 0) { stop(); return false; }
    const RtAudio::DeviceInfo outInfo = impl_->rt.getDeviceInfo(outId);
    if (outInfo.outputChannels == 0) { stop(); return false; }

    // At most two channels each way: stereo hardware is used as-is, mono and
    // multichannel hardware are adapted in StreamRenderer.
    RtAudio::StreamParameters out;
    out.deviceId  = outId;
    out.nChannels = std::min(outInfo.outputChannels, 2u);

    RtAudio::StreamParameters in;
    if (duplex) {
        const unsigned int inId = impl_->rt.getDefaultInputDevice();
        if (inId == 0) { stop(); return false; }
        const RtAudio::DeviceInfo inInfo = impl_->rt.getDeviceInfo(inId);
        if (inInfo.inputChannels == 0) { stop(); return false; }
        in.deviceId  = inId;
        in.nChannels = std::min(inInfo.inputChannels, 2u);
        // WASAPI fills only preferredSampleRate (the shared-mode mix rate).
        const unsigned int hwRate = inInfo.currentSampleRate > 0 ? inInfo.currentSampleRate
                                                                 : inInfo.preferredSampleRate;
        impl_->inputSampleRate = static_cast<float>(hwRate);
    }

    RtAudio::StreamOptions opts;
    opts.flags      = RTAUDIO_SCHEDULE_REALTIME;
    opts.streamName = "daisy-emu";

    // Sized for the requested buffer before the stream exists; a driver that
    // picks a larger buffer is chunked down to this size in render().
    impl_->renderer.prepare(std::move(processBlock), sampleRate, bufferSize,
                            out.nChannels, duplex ? in.nChannels : 0);

    unsigned int frames = bufferSize;  // RtAudio writes back the size it opened with
    if (impl_->rt.openStream(&out, duplex ? &in : nullptr, RTAUDIO_FLOAT32, sampleRate, &frames,
                             &Impl::callback, impl_.get(), &opts) != RTAUDIO_NO_ERROR) {
        stop(); return false;
    }
    if (impl_->rt.startStream() != RTAUDIO_NO_ERROR) { stop(); return false; }
    impl_->openedBufferFrames = frames;

    // getStreamLatency() sums the output and (duplex) input sides; RtAudio
    // opens output first, so its WASAPI API's 64-bit write into each 32-bit
    // latency slot spills only into a field it reassigns right after.
    impl_->latencyMs.store(
        rtaudio_adapt::stream_latency_ms(impl_->apiName, impl_->rt.getStreamLatency(), frames,
                                         impl_->rt.getStreamSampleRate()),
        std::memory_order_relaxed);
    running_ = true;
    return true;
}

uint32_t RtAudioDevice::maxCallbackFrames(uint32_t requestedBufferSize) const {
    // StreamRenderer splits larger driver callbacks into requested-size chunks.
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

uint32_t RtAudioDevice::actualBufferFrames() const {
    return impl_ ? impl_->openedBufferFrames : 0;
}

float RtAudioDevice::queriedInputSampleRate() const {
    return impl_ ? impl_->inputSampleRate : 0.f;
}

}  // namespace daisy_emu
