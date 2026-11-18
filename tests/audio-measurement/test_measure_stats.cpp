// Unit tests for the audio measurement statistics (M80 / FR-WIN-AUD-7).

#include "measure_stats.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace audio_measure;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static bool near(double a, double b, double eps = 1e-6) { return std::fabs(a - b) < eps; }

static void test_regular_callbacks() {
    std::printf("-- regular callbacks --\n");
    // 256 frames at 48 kHz every 5.333 ms, perfectly regular.
    std::vector<CallbackSample> s;
    const double period = 256.0 / 48.0;
    for (int i = 0; i < 100; ++i) s.push_back({i * period, 256});
    const Stats st = compute_stats(s, 48000);
    CHECK(st.wakeups == 100, "every callback is its own wakeup");
    CHECK(st.effectiveBufferFrames == 256, "effective buffer = frames per wakeup");
    CHECK(near(st.meanIntervalMs, period), "mean interval = buffer duration");
    CHECK(near(st.jitterMs, 0.0), "no jitter for a perfectly regular stream");
    CHECK(near(st.p99DeviationMs, 0.0), "no p99 deviation for a perfectly regular stream");
}

static void test_bursts_reveal_device_period() {
    std::printf("-- bursts (driver period coarser than the request) --\n");
    // WASAPI shared: a 10 ms (480-frame) device period, the backend hands the
    // effect requested-size 64-frame chunks back to back within each wakeup.
    std::vector<CallbackSample> s;
    for (int w = 0; w < 50; ++w) {
        double t = w * 10.0;
        for (int c = 0; c < 7; ++c) s.push_back({t + c * 0.01, 64});
        s.push_back({t + 0.07, 32});  // 7*64 + 32 = 480
    }
    const Stats st = compute_stats(s, 48000);
    CHECK(st.callbacks == 400, "every callback is counted");
    CHECK(st.wakeups == 50, "back-to-back callbacks are grouped into one wakeup");
    CHECK(st.effectiveBufferFrames == 480, "effective buffer is the device period, not the request");
    CHECK(near(st.meanIntervalMs, 10.0), "mean wakeup interval is the device period");
}

static void test_jitter() {
    std::printf("-- jitter --\n");
    // Intervals alternate 4 ms / 6 ms around a 5 ms mean.
    std::vector<CallbackSample> s;
    double t = 0;
    for (int i = 0; i < 101; ++i) { s.push_back({t, 240}); t += (i % 2 == 0) ? 4.0 : 6.0; }
    const Stats st = compute_stats(s, 48000);
    CHECK(near(st.meanIntervalMs, 5.0), "mean interval is 5 ms");
    CHECK(near(st.jitterMs, 1.0), "jitter is the interval standard deviation");
    CHECK(near(st.p99DeviationMs, 1.0), "p99 deviation from the mean interval");
    CHECK(near(st.maxIntervalMs, 6.0), "max interval is reported");
}

static void test_empty() {
    std::printf("-- degenerate input --\n");
    const Stats st = compute_stats({}, 48000);
    CHECK(st.callbacks == 0 && st.wakeups == 0 && st.effectiveBufferFrames == 0,
          "no callbacks yields an all-zero result");
    const Stats one = compute_stats({{0.0, 128}}, 48000);
    CHECK(one.wakeups == 1 && one.effectiveBufferFrames == 128 && one.meanIntervalMs == 0.0,
          "a single callback has no interval");
}

static void test_format_row() {
    std::printf("-- markdown row --\n");
    Stats st;
    st.callbacks = 10; st.wakeups = 5; st.effectiveBufferFrames = 480;
    st.meanIntervalMs = 10.0; st.jitterMs = 0.25; st.p99DeviationMs = 0.5; st.maxIntervalMs = 11.0;
    RunInfo info{"WASAPI shared (RtAudio)", 64, 48000, 480, 21.3f, 2, 1};
    const std::string row = format_row(info, st);
    CHECK(row == "| WASAPI shared (RtAudio) | 64 | 480 | 480 | 10.00 | 0.25 | 0.50 | 11.00 | 21.3 | 2 | 1 |",
          "a run formats as one markdown table row");
}

int main() {
    std::printf("=== Audio measurement stats (M80 / FR-WIN-AUD-7) ===\n\n");
    test_regular_callbacks();
    test_bursts_reveal_device_period();
    test_jitter();
    test_empty();
    test_format_row();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
