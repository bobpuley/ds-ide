// Unit test for InputGenerator (M76 / FR-GEN-2, FR-GEN-3).
// No framework: a CHECK macro counts failures; exit 0 on success.

#include "input_generators.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace daisy_emu;

static int g_failures = 0;
#define CHECK(cond, msg)                                                          \
    do {                                                                          \
        if (!(cond)) {                                                            \
            std::fprintf(stderr, "FAIL %s:%d  %s  [%s]\n", __FILE__, __LINE__, msg, #cond); \
            ++g_failures;                                                         \
        }                                                                         \
    } while (0)

static constexpr float kSr = 48000.f;

// Render n frames in blocks of `block`, returning channel 0 and checking L == R.
static std::vector<float> render(InputGenerator& g, size_t n, size_t block = 128) {
    std::vector<float> out, buf;
    bool lr_equal = true;
    for (size_t done = 0; done < n;) {
        const size_t f = std::min(block, n - done);
        buf.assign(f * 2, 9.f);
        g.render(buf.data(), f);
        for (size_t i = 0; i < f; ++i) {
            lr_equal = lr_equal && buf[2 * i] == buf[2 * i + 1];
            out.push_back(buf[2 * i]);
        }
        done += f;
    }
    CHECK(lr_equal, "both input channels carry the same signal");
    return out;
}

static GenParams params(float amp = 0.5f) {
    GenParams p;
    p.amp = amp;
    return p;
}

static float peak(const std::vector<float>& v) {
    float m = 0.f;
    for (float s : v) m = std::max(m, std::fabs(s));
    return m;
}

static void test_silence() {
    InputGenerator g;
    g.configure(GenKind::Silence, params(1.f), kSr);
    for (float s : render(g, 5000)) CHECK(s == 0.f, "silence is exactly zero");
}

static void test_noise_bounded(bool pink) {
    InputGenerator g;
    GenParams p = params(0.3f);
    p.pink = pink;
    g.configure(GenKind::Noise, p, kSr);
    auto v = render(g, 200000);
    CHECK(peak(v) <= 0.3f, "noise never exceeds +/-Amp");
    CHECK(peak(v) > 0.1f, "noise actually uses its range");
    double sum = 0, sq = 0;
    for (float s : v) { sum += s; sq += static_cast<double>(s) * s; }
    CHECK(std::fabs(sum / static_cast<double>(v.size())) < 0.01, "noise is zero-mean");
    CHECK(sq > 0.0, "noise is not silent");
}

static void test_pink_is_darker_than_white() {
    auto hf_ratio = [](bool pink) {
        InputGenerator g;
        GenParams p = params(0.5f);
        p.pink = pink;
        g.configure(GenKind::Noise, p, kSr);
        auto v = render(g, 100000);
        double diff = 0, tot = 0;
        for (size_t i = 1; i < v.size(); ++i) {
            const double d = v[i] - v[i - 1];
            diff += d * d;
            tot += static_cast<double>(v[i]) * v[i];
        }
        return diff / tot;
    };
    CHECK(hf_ratio(true) < 0.6 * hf_ratio(false), "pink noise has less high-frequency energy than white");
}

static void test_two_tone() {
    InputGenerator g;
    g.configure(GenKind::TwoTone, params(0.8f), kSr);
    auto v = render(g, 48000);
    CHECK(peak(v) <= 0.8f + 1e-6f, "two-tone never exceeds Amp");
    CHECK(peak(v) > 0.4f, "two-tone reaches a substantial level");
    // 60 Hz component dominates: correlate with a 60 Hz sine over exactly 1 s.
    double c60 = 0, c7k = 0;
    for (size_t i = 0; i < v.size(); ++i) {
        const double t = static_cast<double>(i) / kSr;
        c60 += v[i] * std::sin(2.0 * M_PI * 60.0 * t);
        c7k += v[i] * std::sin(2.0 * M_PI * 7000.0 * t);
    }
    const double a60 = 2.0 * c60 / static_cast<double>(v.size());
    const double a7k = 2.0 * c7k / static_cast<double>(v.size());
    CHECK(std::fabs(a60 - 0.8 * 0.8) < 0.01, "60 Hz at 0.8 x Amp");
    CHECK(std::fabs(a7k - 0.2 * 0.8) < 0.01, "7 kHz at 0.2 x Amp");
}

static void test_impulse() {
    InputGenerator g;
    GenParams p = params(0.7f);
    p.period_ms = 10.f;  // 480 samples
    g.configure(GenKind::Impulse, p, kSr);
    auto v = render(g, 480 * 5 + 37, 100);  // block size does not divide the period
    for (size_t i = 0; i < v.size(); ++i) {
        if (i % 480 == 0) CHECK(v[i] == 0.7f, "impulse of value Amp on the period boundary");
        else CHECK(v[i] == 0.f, "zero between impulses");
    }
}

static void test_step() {
    InputGenerator g;
    GenParams p = params(0.6f);
    p.period_ms = 10.f;
    g.configure(GenKind::Step, p, kSr);
    auto v = render(g, 480 * 4, 77);
    for (size_t i = 0; i < v.size(); ++i) {
        const float want = ((i / 480) % 2 == 0) ? 0.f : 0.6f;
        CHECK(v[i] == want, "step switches between 0 and Amp exactly on the period boundary");
    }
}

static void test_sweep() {
    InputGenerator g;
    GenParams p = params(0.5f);
    p.from = 100.f;
    p.to = 2000.f;
    p.time = 0.5f;  // 24000 samples
    g.configure(GenKind::Sweep, p, kSr);
    const size_t N = 24000;
    auto v = render(g, 3 * N, 100);
    CHECK(peak(v) <= 0.5f + 1e-6f, "sweep never exceeds Amp");
    const float max_step = 0.5f * 2.f * static_cast<float>(M_PI) * 2000.f / kSr * 1.01f;
    for (size_t i = 1; i < v.size(); ++i) {
        if (i % N == 0) continue;  // the restart is the one permitted discontinuity
        CHECK(std::fabs(v[i] - v[i - 1]) <= max_step, "phase-continuous within a sweep");
    }
    for (size_t i = 0; i < N; ++i) {
        CHECK(v[i + N] == v[i] && v[i + 2 * N] == v[i], "the sweep restarts identically after Time");
    }
    auto crossings = [&](size_t a, size_t b) {
        int c = 0;
        for (size_t i = a + 1; i < b; ++i) c += (v[i - 1] < 0.f) != (v[i] < 0.f);
        return c;
    };
    CHECK(crossings(N - 4000, N) > 3 * crossings(0, 4000), "frequency rises over the sweep");
}

static void test_determinism_and_reset() {
    auto run = [](size_t block) {
        InputGenerator g;
        GenParams p = params(0.4f);
        p.pink = true;
        g.configure(GenKind::Noise, p, kSr);
        return render(g, 5000, block);
    };
    CHECK(run(64) == run(100), "block size does not change the samples");
    InputGenerator g;
    g.configure(GenKind::Noise, params(0.4f), kSr);
    auto a = render(g, 1000);
    g.configure(GenKind::Noise, params(0.4f), kSr);
    auto b = render(g, 1000);
    CHECK(a == b, "re-selecting a generator restarts the same stream (fixed seed)");
    g.configure(GenKind::Sweep, params(0.4f), kSr);
    auto s1 = render(g, 2000);
    g.configure(GenKind::Sweep, params(0.4f), kSr);
    CHECK(render(g, 2000) == s1, "sweep resets on selection");
}

static void test_param_change_keeps_phase() {
    InputGenerator g;
    GenParams p = params(0.5f);
    p.freq = 440.f;
    g.configure(GenKind::Sine, p, kSr);
    auto a = render(g, 1000);
    p.freq = 880.f;
    g.setParams(p);
    auto b = render(g, 1000);
    const float max_step = 0.5f * 2.f * static_cast<float>(M_PI) * 880.f / kSr * 1.01f;
    CHECK(std::fabs(b[0] - a.back()) <= max_step, "frequency change keeps the sine phase continuous");
    CHECK(peak(b) <= 0.5f + 1e-6f, "sine bounded by Amp");
}

static void test_clamping() {
    InputGenerator g;
    GenParams p;
    p.amp = 5.f;
    p.period_ms = 0.f;
    g.configure(GenKind::Impulse, p, kSr);
    auto v = render(g, 480 * 2);
    CHECK(peak(v) == 1.f, "Amp is clamped to 1");
    CHECK(v[0] == 1.f && v[480] == 1.f, "Period is clamped to 10 ms");
    GenParams q;
    q.amp = std::nanf("");
    g.configure(GenKind::Sine, q, kSr);
    CHECK(peak(render(g, 1000)) <= 1.f, "NaN Amp falls back to the default");
    GenParams r;
    r.from = 5000.f;
    r.to = 100.f;  // To must stay above From
    g.configure(GenKind::Sweep, r, kSr);
    CHECK(peak(render(g, 1000)) <= r.amp + 1e-6f, "an inverted sweep range is repaired, not crashed on");
}

int main() {
    test_silence();
    test_noise_bounded(false);
    test_noise_bounded(true);
    test_pink_is_darker_than_white();
    test_two_tone();
    test_impulse();
    test_step();
    test_sweep();
    test_determinism_and_reset();
    test_param_change_keeps_phase();
    test_clamping();
    if (g_failures) { std::fprintf(stderr, "%d check(s) failed\n", g_failures); return 1; }
    std::puts("input generator tests passed");
    return 0;
}
