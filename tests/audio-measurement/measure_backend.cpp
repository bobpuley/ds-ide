// Measures the emulator's platform audio backend (M80 / FR-WIN-AUD-7).
//
// Opens the backend from make_audio_device() — CoreAudio on macOS (baseline),
// RtAudio on Windows (WASAPI shared; ASIO with DS_EMU_AUDIO_API=asio when
// compiled in) — exactly as the engine does, plays a quiet sine for a few
// seconds and prints one markdown table row: effective buffer, wakeup
// interval/jitter, xruns, driver overruns and the backend's reported latency.
//
// Usage: measure_backend <label> <requestedFrames> [seconds=10] [output|duplex] [sampleRate=48000]
// Exit code: 0 = measured, 2 = the backend could not start.

#include "audio_device.h"
#include "measure_stats.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

using namespace audio_measure;
using Clock = std::chrono::steady_clock;

int main(int argc, char** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: %s <label> <requestedFrames> [seconds] [output|duplex] [sampleRate]\n", argv[0]);
        return 1;
    }
    const std::string label   = argv[1];
    const uint32_t    request = static_cast<uint32_t>(std::strtoul(argv[2], nullptr, 10));
    const double      seconds = argc > 3 ? std::atof(argv[3]) : 10.0;
    const bool        duplex  = argc > 4 && std::strcmp(argv[4], "duplex") == 0;
    const uint32_t    rate    = argc > 5 ? static_cast<uint32_t>(std::strtoul(argv[5], nullptr, 10)) : 48000;

    // Preallocated: the callback only writes a slot and bumps an index.
    const size_t capacity = static_cast<size_t>(seconds * rate / std::max<uint32_t>(request / 4, 1)) + 1024;
    std::vector<CallbackSample> samples(capacity);
    std::atomic<size_t> count{0};
    const auto t0 = Clock::now();
    double phase = 0.0;

    auto process = [&](const float*, float* out, size_t frames) {
        const double t = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
        const size_t i = count.load(std::memory_order_relaxed);
        if (i < capacity) {
            samples[i] = {t, static_cast<uint32_t>(frames)};
            count.store(i + 1, std::memory_order_release);
        }
        const double step = 2.0 * 3.14159265358979 * 440.0 / rate;
        for (size_t f = 0; f < frames; ++f) {
            const float s = 0.02f * static_cast<float>(std::sin(phase));
            phase += step;
            out[2 * f] = out[2 * f + 1] = s;
        }
    };

    auto dev = daisy_emu::make_audio_device();
    const bool ok = duplex ? dev->start(rate, request, process)
                           : dev->start_output_only(rate, request, process);
    if (!ok) {
        std::fprintf(stderr, "[measure] %s: backend failed to start (%s, %u frames)\n",
                     label.c_str(), duplex ? "duplex" : "output-only", request);
        return 2;
    }
    // Let the stream settle before counting (first callbacks are often irregular).
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    dev->drainXruns();
    dev->drainDriverOverruns();
    const size_t first = count.load(std::memory_order_acquire);
    std::this_thread::sleep_for(std::chrono::duration<double>(seconds));

    RunInfo info{label, request, rate, dev->actualBufferFrames(), dev->lastLatencyMs(),
                 dev->drainXruns(), dev->drainDriverOverruns()};
    const size_t last = count.load(std::memory_order_acquire);
    dev->stop();

    const std::vector<CallbackSample> window(samples.begin() + static_cast<ptrdiff_t>(first),
                                             samples.begin() + static_cast<ptrdiff_t>(last));
    std::printf("%s\n", format_row(info, compute_stats(window, rate)).c_str());
    return 0;
}
