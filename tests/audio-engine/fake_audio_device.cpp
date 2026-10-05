// AudioDevice test double
// (M79 / FR-WIN-AUD-4). See fake_audio_backend.h.

#include "fake_audio_device.h"

#include <vector>

namespace fake_audio {

FakeAudio g_fake;
thread_local bool          t_rt_section = false;
thread_local unsigned long t_rt_allocs  = 0;

void FakeAudio::reset() {
    std::lock_guard<std::mutex> lk(m);
    duplex_ok = true; output_ok = true;
    pending_xruns = 0; pending_render_errors = 0; pending_driver_overruns = 0;
    latency_ms = 0.f; queried_rate = 0.f; max_callback_frames = 0;
    start_calls = 0; output_calls = 0; stop_calls = 0;
    last_rate = 0; last_buffer = 0; last_fire_allocs = 0;
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
    t_rt_allocs  = 0;
    t_rt_section = true;
    fn(in.data(), out.data(), frames);
    t_rt_section = false;
    last_fire_allocs = t_rt_allocs;
    if (out_capture)
        for (size_t i = 0; i < frames * 2; ++i) out_capture[i] = out[i];
    return true;
}


bool FakeAudioDevice::begin(bool ok, uint32_t sampleRate, uint32_t bufferSize, ProcessFn fn,
                            bool output_only) {
    (output_only ? g_fake.output_calls : g_fake.start_calls)++;
    g_fake.last_rate   = sampleRate;
    g_fake.last_buffer = bufferSize;
    if (!ok) return false;
    {
        std::lock_guard<std::mutex> lk(g_fake.m);
        g_fake.cb = std::move(fn);
        g_fake.is_running = true;
    }
    running_ = true;
    return true;
}

bool FakeAudioDevice::start(uint32_t sampleRate, uint32_t bufferSize, ProcessFn processBlock) {
    return begin(g_fake.duplex_ok, sampleRate, bufferSize, std::move(processBlock), false);
}

bool FakeAudioDevice::start_output_only(uint32_t sampleRate, uint32_t bufferSize,
                                        ProcessFn processBlock) {
    return begin(g_fake.output_ok, sampleRate, bufferSize, std::move(processBlock), true);
}

void FakeAudioDevice::stop() {
    if (!running_) return;
    g_fake.stop_calls++;
    {
        std::lock_guard<std::mutex> lk(g_fake.m);
        g_fake.is_running = false;
        g_fake.cb = nullptr;
    }
    running_ = false;
}

uint32_t FakeAudioDevice::maxCallbackFrames(uint32_t requestedBufferSize) const {
    const uint32_t cap = g_fake.max_callback_frames.load();
    return cap > requestedBufferSize ? cap : requestedBufferSize;
}
uint32_t FakeAudioDevice::drainXruns() { return g_fake.pending_xruns.exchange(0); }
uint32_t FakeAudioDevice::drainRenderErrors() { return g_fake.pending_render_errors.exchange(0); }
uint32_t FakeAudioDevice::drainDriverOverruns() { return g_fake.pending_driver_overruns.exchange(0); }
float FakeAudioDevice::lastLatencyMs() const { return g_fake.latency_ms.load(); }
float FakeAudioDevice::queriedInputSampleRate() const { return g_fake.queried_rate.load(); }

}  // namespace fake_audio
