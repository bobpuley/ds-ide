// Test double standing in for emulator/runtime/core_audio_device.cpp
// (M79 / FR-WIN-AUD-4). See fake_audio_backend.h.

#include "core_audio_device.h"
#include "fake_audio_backend.h"

#include <vector>

namespace fake_audio {

FakeAudio g_fake;

void FakeAudio::reset() {
    std::lock_guard<std::mutex> lk(m);
    duplex_ok = true; output_ok = true;
    pending_xruns = 0; pending_render_errors = 0;
    latency_ms = 0.f; queried_rate = 0.f;
    start_calls = 0; output_calls = 0; stop_calls = 0;
    last_rate = 0; last_buffer = 0;
    cb = nullptr; is_running = false;
}

bool FakeAudio::running() {
    std::lock_guard<std::mutex> lk(m);
    return is_running;
}

bool FakeAudio::fire(size_t frames, float in_value, float* out_capture) {
    ProcessFn fn;
    {
        std::lock_guard<std::mutex> lk(m);
        if (!is_running || !cb) return false;
        fn = cb;
    }
    std::vector<float> in(frames * 2, in_value);
    std::vector<float> out(frames * 2, 0.f);
    fn(in.data(), out.data(), frames);
    if (out_capture)
        for (size_t i = 0; i < frames * 2; ++i) out_capture[i] = out[i];
    return true;
}

}  // namespace fake_audio

namespace daisy_emu {

#ifdef __APPLE__
struct CoreAudioDevice::Impl {};
#endif

CoreAudioDevice::CoreAudioDevice() = default;
CoreAudioDevice::~CoreAudioDevice() { stop(); }

bool CoreAudioDevice::start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    using fake_audio::g_fake;
    g_fake.start_calls++;
    g_fake.last_rate   = sampleRate;
    g_fake.last_buffer = bufferSize;
    if (!g_fake.duplex_ok) return false;
    {
        std::lock_guard<std::mutex> lk(g_fake.m);
        g_fake.cb = std::move(processBlock);
        g_fake.is_running = true;
    }
    running_ = true;
    return true;
}

bool CoreAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize,
                                        ProcessFn processBlock) {
    using fake_audio::g_fake;
    g_fake.output_calls++;
    g_fake.last_rate   = sampleRate;
    g_fake.last_buffer = bufferSize;
    if (!g_fake.output_ok) return false;
    {
        std::lock_guard<std::mutex> lk(g_fake.m);
        g_fake.cb = std::move(processBlock);
        g_fake.is_running = true;
    }
    running_ = true;
    return true;
}

void CoreAudioDevice::stop() {
    if (!running_) return;
    using fake_audio::g_fake;
    g_fake.stop_calls++;
    {
        std::lock_guard<std::mutex> lk(g_fake.m);
        g_fake.is_running = false;
        g_fake.cb = nullptr;
    }
    running_ = false;
}

uint32_t CoreAudioDevice::drainXruns() {
    return fake_audio::g_fake.pending_xruns.exchange(0);
}
uint32_t CoreAudioDevice::drainRenderErrors() {
    return fake_audio::g_fake.pending_render_errors.exchange(0);
}
float CoreAudioDevice::lastLatencyMs() const { return fake_audio::g_fake.latency_ms.load(); }
float CoreAudioDevice::queriedInputSampleRate() const {
    return fake_audio::g_fake.queried_rate.load();
}

}  // namespace daisy_emu
