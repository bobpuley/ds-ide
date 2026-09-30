// Unit tests for ScopeCapture (FR-SCI-14a): full-rate ring + trigger scan.
// No framework dependency — CHECK macro, exit 0 on success.

#include "scope_capture.h"

#include <cmath>
#include <cstdio>
#include <vector>

static int g_failures = 0;
#define CHECK(cond, msg)                                                      \
    do {                                                                      \
        if (!(cond)) { std::printf("FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); ++g_failures; } \
    } while (0)

using Cap = ScopeCapture;

// Interleaved stereo block; in = left of `in_fn(n)`, out L = out_fn(n), out R = -out_fn(n).
template <class FIn, class FOut>
static bool push_range(Cap& c, size_t from, size_t frames, FIn in_fn, FOut out_fn, Cap::Window& w) {
    std::vector<float> in(frames * 2), out(frames * 2);
    for (size_t i = 0; i < frames; ++i) {
        in[2 * i] = in_fn(from + i);  in[2 * i + 1] = 0.f;
        out[2 * i] = out_fn(from + i); out[2 * i + 1] = -out_fn(from + i);
    }
    return c.push(in.data(), out.data(), frames, w);
}

// Ramp crossing 0.5 going up at n == 5000 (value = (n-5000)/1000 + 0.5 is overkill; use a step).
static float step_up(size_t n)   { return n < 5000 ? 0.f : 1.f; }
static float step_down(size_t n) { return n < 5000 ? 1.f : 0.f; }
static float zero(size_t) { return 0.f; }

static void test_rising_trigger() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    CHECK(c.armed(), "armed after arm()");
    bool done = false;
    // 64-frame blocks, so the window spans many pushes.
    for (size_t n = 0; n < 12000 && !done; n += 64)
        done = push_range(c, n, 64, step_up, zero, w);
    CHECK(done, "window completes");
    CHECK(!c.armed(), "disarmed after completion");
    CHECK(w.in.size() == Cap::kWindowFrames, "window length");
    CHECK(w.out.size() == Cap::kWindowFrames && w.out_r.size() == Cap::kWindowFrames, "all channels sized");
    CHECK(w.trigger == Cap::kPreFrames, "trigger index");
    CHECK(w.in[w.trigger] == 1.f && w.in[w.trigger - 1] == 0.f, "edge sits at trigger index");
    CHECK(w.in[0] == 0.f && w.in.back() == 1.f, "pre is low, post is high");
}

static void test_falling_trigger_on_out_l() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::OutL, Cap::Edge::Fall, 0.5f});
    bool done = false;
    for (size_t n = 0; n < 12000 && !done; n += 100)
        done = push_range(c, n, 100, zero, step_down, w);
    CHECK(done, "falling window completes");
    CHECK(w.out[w.trigger] == 0.f && w.out[w.trigger - 1] == 1.f, "falling edge at trigger");
    CHECK(w.out_r[w.trigger] == -0.f && w.out_r[w.trigger - 1] == -1.f, "right channel aligned");
}

static void test_no_crossing_never_completes() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    bool done = false;
    for (size_t n = 0; n < 40000; n += 256) done = done || push_range(c, n, 256, zero, zero, w);
    CHECK(!done, "no crossing, no window");
    CHECK(c.armed(), "stays armed");
}

static void test_incomplete_window_not_returned() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    // Crossing at 5000; push only up to 5000 + 100 frames of post-trigger data.
    bool done = false;
    for (size_t n = 0; n < 5100; n += 100) done = done || push_range(c, n, 100, step_up, zero, w);
    CHECK(!done, "post-trigger samples still missing");
    CHECK(c.armed(), "still armed while waiting");
}

static void test_cancel_and_clear() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    c.cancel();
    CHECK(!c.armed(), "cancel disarms");
    bool done = false;
    for (size_t n = 0; n < 12000; n += 128) done = done || push_range(c, n, 128, step_up, zero, w);
    CHECK(!done, "no window after cancel");

    // clear(): the pre-trigger history is dropped, so an edge right after it cannot complete
    // a window that would need pre-trigger samples from before the clear.
    Cap d;
    for (size_t n = 0; n < 4096; n += 128) push_range(d, n, 128, zero, zero, w);
    d.clear();
    d.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    bool early = false;
    // Edge 100 frames after clear — fewer than kPreFrames of history exist.
    for (size_t n = 0; n < 6000; n += 100)
        early = early || push_range(d, n, 100, [](size_t k) { return k < 100 ? 0.f : 1.f; }, zero, w);
    CHECK(!early, "edge with insufficient pre-trigger history is skipped");
}

static void test_rearm_replaces_request() {
    Cap c; Cap::Window w;
    c.arm({Cap::Source::In, Cap::Edge::Fall, 0.5f});   // would never fire on a rising step
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    bool done = false;
    for (size_t n = 0; n < 12000 && !done; n += 64)
        done = push_range(c, n, 64, step_up, zero, w);
    CHECK(done, "second request replaced the first");
}

static void test_ring_wraps() {
    Cap c; Cap::Window w;
    // Run long enough to wrap the ring several times before arming.
    for (size_t n = 0; n < 100000; n += 128) push_range(c, n, 128, zero, zero, w);
    c.arm({Cap::Source::In, Cap::Edge::Rise, 0.5f});
    auto sq = [](size_t n) { return (n / 3000) % 2 ? 1.f : 0.f; };   // edges every 6000 frames
    bool done = false;
    for (size_t n = 100000; n < 130000 && !done; n += 128) done = push_range(c, n, 128, sq, zero, w);
    CHECK(done, "window completes after ring wrapped");
    CHECK(w.in[w.trigger] == 1.f && w.in[w.trigger - 1] == 0.f, "edge at trigger after wrap");
}

int main() {
    test_rising_trigger();
    test_falling_trigger_on_out_l();
    test_no_crossing_never_completes();
    test_incomplete_window_not_returned();
    test_cancel_and_clear();
    test_rearm_replaces_request();
    test_ring_wraps();
    if (g_failures) { std::printf("%d check(s) failed\n", g_failures); return 1; }
    std::printf("All scope-capture tests passed\n");
    return 0;
}
