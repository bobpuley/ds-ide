// RtAudio backend tests (M80 / FR-WIN-AUD-5).
//
// The pure parts of the Windows backend — API selection, stereo -> hardware
// channel adaptation, latency conversion and the output-only render path
// (chunking, xrun and driver-underflow accounting) — are exercised here on any
// host with a fake ProcessFn. Off Windows RtAudioDevice is built against
// RtAudio's dummy API (no devices), so start_output_only() must fail cleanly
// and leave the engine to take its silent-loop fallback; on Windows it uses
// WASAPI and either opens the default output or fails the same way.

#include "audio_device_rtaudio.h"
#include "rtaudio_adapt.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

using namespace daisy_emu;
using namespace daisy_emu::rtaudio_adapt;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static void test_choose_api_name() {
    std::printf("-- choose_api_name --\n");
    const std::vector<std::string> both{"asio", "wasapi"};
    const std::vector<std::string> wasapi_only{"wasapi"};
    CHECK(choose_api_name(nullptr, both) == "wasapi", "WASAPI is the default when no API is requested");
    CHECK(choose_api_name("", both) == "wasapi", "an empty request falls back to WASAPI");
    CHECK(choose_api_name("asio", both) == "asio", "DS_EMU_AUDIO_API=asio picks ASIO when compiled in");
    CHECK(choose_api_name("ASIO", both) == "asio", "the request is case-insensitive");
    CHECK(choose_api_name("asio", wasapi_only) == "wasapi", "ASIO not compiled in falls back to WASAPI");
    CHECK(choose_api_name("bogus", wasapi_only) == "wasapi", "an unknown request falls back to WASAPI");
    CHECK(choose_api_name(nullptr, {"dummy"}) == "dummy", "without WASAPI the first compiled API is used");
    CHECK(choose_api_name(nullptr, {}).empty(), "no compiled API yields an empty name");
}

static void test_write_output() {
    std::printf("-- write_output --\n");
    const float stereo[] = {0.1f, 0.2f, 0.3f, 0.4f};

    float out2[4] = {9, 9, 9, 9};
    write_output(stereo, 2, out2, 2);
    CHECK(out2[0] == 0.1f && out2[1] == 0.2f && out2[2] == 0.3f && out2[3] == 0.4f,
          "stereo hardware receives the interleaved block unchanged");

    float out1[2] = {9, 9};
    write_output(stereo, 2, out1, 1);
    CHECK(out1[0] == 0.1f && out1[1] == 0.3f, "mono hardware receives the left channel (as CoreAudio)");

    float out4[8];
    for (float& s : out4) s = 9.f;
    write_output(stereo, 2, out4, 4);
    CHECK(out4[0] == 0.1f && out4[1] == 0.2f && out4[2] == 0.f && out4[3] == 0.f &&
          out4[4] == 0.3f && out4[5] == 0.4f && out4[6] == 0.f && out4[7] == 0.f,
          "multichannel hardware gets L/R on the first two channels and silence elsewhere");
}

static void test_latency_ms() {
    std::printf("-- stream_latency_ms --\n");
    // WASAPI reports REFERENCE_TIME (100 ns units): 100000 -> 10 ms; plus a
    // 480-frame buffer at 48 kHz -> 10 ms.
    CHECK(std::fabs(stream_latency_ms("wasapi", 100000, 480, 48000) - 20.f) < 1e-3f,
          "WASAPI driver latency is converted from 100 ns units and added to the buffer");
    // Other APIs report frames: 96 frames + 48-frame buffer at 48 kHz -> 3 ms.
    CHECK(std::fabs(stream_latency_ms("asio", 96, 48, 48000) - 3.f) < 1e-3f,
          "ASIO driver latency is converted from frames and added to the buffer");
    CHECK(stream_latency_ms("wasapi", 0, 0, 48000) == 0.f, "nothing known reports 0 (unknown)");
    CHECK(stream_latency_ms("wasapi", 100000, 480, 0) == 0.f, "a zero sample rate reports 0");
}

static void test_output_renderer_chunks() {
    std::printf("-- OutputRenderer: chunking --\n");
    std::vector<size_t> calls;
    OutputRenderer r;
    r.prepare([&](const float* in, float* out, size_t frames) {
                  calls.push_back(frames);
                  bool silent = true;
                  for (size_t i = 0; i < frames * 2; ++i) silent = silent && in[i] == 0.f;
                  for (size_t i = 0; i < frames; ++i) {
                      out[2 * i]     = silent ? 0.5f : -1.f;
                      out[2 * i + 1] = -0.5f;
                  }
              },
              48000, 256, 2);
    std::vector<float> hw(600 * 2, 9.f);
    r.render(hw.data(), 600, false);
    CHECK(calls.size() == 3 && calls[0] == 256 && calls[1] == 256 && calls[2] == 88,
          "a 600-frame callback is split into chunks of at most the requested size");
    bool ok = true;
    for (size_t i = 0; i < 600; ++i) ok = ok && hw[2 * i] == 0.5f && hw[2 * i + 1] == -0.5f;
    CHECK(ok, "every chunk's output lands at its offset and the effect sees zeroed input");
    CHECK(r.maxChunkFrames() == 256, "the chunk size is the requested buffer size");
}

static void test_output_renderer_mono() {
    std::printf("-- OutputRenderer: mono hardware --\n");
    OutputRenderer r;
    r.prepare([](const float*, float* out, size_t frames) {
                  for (size_t i = 0; i < frames; ++i) { out[2 * i] = 0.25f; out[2 * i + 1] = 0.75f; }
              },
              48000, 64, 1);
    std::vector<float> hw(64, 9.f);
    r.render(hw.data(), 64, false);
    bool ok = true;
    for (float s : hw) ok = ok && s == 0.25f;
    CHECK(ok, "a mono device receives the left channel of each frame");
}

static void test_output_renderer_counters() {
    std::printf("-- OutputRenderer: xruns and driver underflows --\n");
    OutputRenderer r;
    bool slow = false;
    r.prepare([&](const float*, float* out, size_t frames) {
                  if (slow) std::this_thread::sleep_for(std::chrono::milliseconds(5));
                  for (size_t i = 0; i < frames * 2; ++i) out[i] = 0.f;
              },
              48000, 48, 2);  // 48 frames @ 48 kHz = 1 ms budget
    std::vector<float> hw(48 * 2);
    r.render(hw.data(), 48, false);
    CHECK(r.drainXruns() == 0, "a fast callback is not an xrun");
    slow = true;
    r.render(hw.data(), 48, false);
    r.render(hw.data(), 48, false);
    CHECK(r.drainXruns() == 2, "callbacks slower than the buffer duration count as xruns");
    CHECK(r.drainXruns() == 0, "drainXruns() resets the counter");
    slow = false;
    r.render(hw.data(), 48, true);
    r.render(hw.data(), 48, true);
    CHECK(r.drainDriverOverruns() == 2, "driver output-underflow status is counted separately");
    CHECK(r.drainDriverOverruns() == 0, "drainDriverOverruns() resets the counter");
    CHECK(r.drainXruns() == 0, "a driver underflow is not an xrun");
}

static void test_device_start_output_only() {
    std::printf("-- RtAudioDevice: start_output_only --\n");
    RtAudioDevice dev;
    CHECK(dev.maxCallbackFrames(256) == 256, "processBlock never sees more than the requested frames");
    const bool started = dev.start_output_only(48000, 256, [](const float*, float* out, size_t frames) {
        for (size_t i = 0; i < frames * 2; ++i) out[i] = 0.f;
    });
#ifdef DS_TEST_RTAUDIO_DUMMY
    CHECK(!started, "start_output_only() fails when the API has no output device");
#endif
    if (started) {
        // Windows with an output endpoint: a real WASAPI stream is running.
        CHECK(dev.isRunning(), "a started device reports running");
        CHECK(dev.lastLatencyMs() > 0.f, "a started device reports a measured latency");
    } else {
        CHECK(!dev.isRunning(), "a failed start leaves the device stopped");
        CHECK(dev.lastLatencyMs() == 0.f, "a failed start reports no latency");
    }
    dev.stop();
    CHECK(!dev.isRunning(), "stop() leaves the device stopped");
    dev.stop();
    CHECK(!dev.isRunning(), "a second stop() is a safe no-op");
}

int main() {
    std::printf("=== RtAudio backend tests (M80 / FR-WIN-AUD-5) ===\n\n");
    test_choose_api_name();
    test_write_output();
    test_latency_ms();
    test_output_renderer_chunks();
    test_output_renderer_mono();
    test_output_renderer_counters();
    test_device_start_output_only();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
