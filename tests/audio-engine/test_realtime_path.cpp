// Real-time path regression tests (M79 / FR-WIN-AUD-4).
//
// Drives run_audio_engine() end to end against a fake audio backend
// (fake_core_audio_device.cpp) that the test thread plays "driver" for. Covers
// real-time mode, xruns, latency/render-error events, sample_rate_mismatch,
// the realtime_unavailable fallback, rt_buffer_size / audioDevice handling and
// mode switching. Written against the pre-refactor macOS implementation and
// kept green through the AudioDevice extraction.

#include "audio_engine.h"
#include "emulator_state.h"
#include "fake_audio_backend.h"

#include <chrono>
#include <cstdlib>
#include <new>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

using namespace daisy_emu;
using fake_audio::g_fake;

namespace daisy_emu { EmulatorState g_state; }

// Count heap allocations made while a thread is inside an RT section
// (FR-WIN-AUD-2). Replaces the global allocation functions for this binary.
void* operator new(std::size_t n) {
    if (fake_audio::t_rt_section) ++fake_audio::t_rt_allocs;
    if (void* p = std::malloc(n ? n : 1)) return p;
    throw std::bad_alloc();
}
void operator delete(void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

// ---- Effect callbacks (plain function pointers, as the shim stores them) -----

static std::atomic<int> g_cb_calls{0};
static std::atomic<size_t> g_cb_max_size{0};  // largest block seen, in frames
static void gain2_cb(const float* in, float* out, size_t size) {
    ++g_cb_calls;
    if (size / 2 > g_cb_max_size) g_cb_max_size = size / 2; 
    for (size_t i = 0; i < size; ++i) out[i] = in[i] * 2.f;
}

// ---- Harness -----------------------------------------------------------------

template <typename Pred>
static bool wait_for(Pred pred, int timeout_ms = 3000) {
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return pred();
}

class Harness {
public:
    explicit Harness(int audio_mode, size_t rt_buffer = 128, float rate = 48000.f,
                     uint32_t max_callback_frames = 0) {
        g_fake.reset();
        g_fake.max_callback_frames = max_callback_frames;
        g_cb_calls = 0;
        g_cb_max_size = 0;
        g_state.shutdown = false;
        g_state.transport_running = true;
        g_state.audio_mode = audio_mode;
        g_state.sample_rate = rate;
        g_state.block_size = 48;
        g_state.rt_buffer_size = rt_buffer;
        g_state.output_volume = 1.f;
        g_state.gen_kind = -1;
        g_state.block_cb = nullptr;
        g_state.interleaving_cb = gain2_cb;
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            g_state.send_ipc = [this](std::string m) {
                std::lock_guard<std::mutex> l(msg_m_);
                msgs_.push_back(std::move(m));
            };
        }
        {
            std::lock_guard<std::mutex> lk(g_state.callback_mutex);
            g_state.callback_set = true;
        }
        g_state.callback_cv.notify_all();
        thread_ = std::thread([] { run_audio_engine(); });
    }

    ~Harness() { finish(); }

    void finish() {
        if (!thread_.joinable()) return;
        g_state.shutdown = true;
        { std::lock_guard<std::mutex> lk(g_state.mode_mutex); }
        g_state.mode_cv.notify_all();
        g_state.callback_cv.notify_all();
        thread_.join();
        std::lock_guard<std::mutex> lk(g_state.send_mutex);
        g_state.send_ipc = nullptr;
    }

    // Wake the engine's mode loop after changing g_state.
    void poke() {
        { std::lock_guard<std::mutex> lk(g_state.mode_mutex); }
        g_state.mode_cv.notify_all();
    }

    bool has(const std::string& needle) {
        std::lock_guard<std::mutex> l(msg_m_);
        for (auto& m : msgs_) if (m.find(needle) != std::string::npos) return true;
        return false;
    }
    bool wait_msg(const std::string& needle, int timeout_ms = 3000) {
        return wait_for([&] { return has(needle); }, timeout_ms);
    }

    // Fire n blocks of `frames` frames.
    void fire_blocks(int n, size_t frames, float in_value = 0.25f) {
        for (int i = 0; i < n; ++i) g_fake.fire(frames, in_value);
    }

private:
    std::thread              thread_;
    std::mutex               msg_m_;
    std::vector<std::string> msgs_;
};

static constexpr int kScopeBlocks = 33;  // ScopeState::SCOPE_BLOCKS

// ---- Tests -------------------------------------------------------------------

static void test_realtime_start_params() {
    std::printf("\n-- real-time start: rate / buffer handling --\n");
    Harness h(1, 128, 48000.f);
    CHECK(wait_for([] { return g_fake.start_calls.load() == 1; }),
          "real-time mode opens the duplex stream (start())");
    CHECK(g_fake.last_rate == 48000, "start() receives the configured sample rate");
    CHECK(g_fake.last_buffer == 128, "start() receives rt_buffer_size as the buffer size");
    CHECK(g_fake.output_calls == 0, "real-time mode does not open an output-only stream");
}

static void test_audio_device_reconfig() {
    std::printf("\n-- audioDevice change restarts the stream --\n");
    Harness h(1, 128, 48000.f);
    wait_for([] { return g_fake.start_calls.load() == 1; });
    g_state.sample_rate = 44100.f;
    g_state.rt_buffer_size = 64;
    g_state.config_generation++;
    h.poke();
    CHECK(wait_for([] { return g_fake.start_calls.load() == 2; }),
          "a config change restarts the real-time stream");
    CHECK(g_fake.stop_calls >= 1, "the old stream is stopped first");
    CHECK(g_fake.last_rate == 44100, "restart uses the new sample rate");
    CHECK(g_fake.last_buffer == 64, "restart uses the new buffer size");
}

static void test_processing_and_transport() {
    std::printf("\n-- callback processing, volume, transport --\n");
    Harness h(1, 128);
    wait_for([] { return g_fake.running(); });
    std::vector<float> out(128 * 2, -1.f);

    g_fake.fire(128, 0.25f, out.data());
    CHECK(out[0] == 0.5f && out[255] == 0.5f, "effect output reaches the driver buffer (gain x2)");
    CHECK(g_cb_calls == 1, "the effect callback runs once per driver callback");

    g_state.output_volume = 0.5f;
    g_fake.fire(128, 0.25f, out.data());
    CHECK(out[0] == 0.25f, "master output volume is applied");
    g_state.output_volume = 1.f;

    g_state.transport_running = false;
    g_fake.fire(128, 0.25f, out.data());
    CHECK(out[0] == 0.f && out[255] == 0.f, "stopped transport (breakpoint mute) outputs silence");
    CHECK(g_cb_calls == 2, "the effect callback is not invoked while muted");

    g_state.transport_running = true;
    g_fake.fire(128, 0.25f, out.data());
    CHECK(out[0] == 0.5f, "audio resumes when the transport restarts");

    std::vector<float> small(37 * 2, -1.f);
    g_fake.fire(37, 0.25f, small.data());
    CHECK(small[0] == 0.5f && small[73] == 0.5f, "a callback smaller than rt_buffer_size is processed");
}

static bool all_equal(const std::vector<float>& v, size_t from, size_t to, float x) {
    for (size_t i = from; i < to; ++i) if (v[i] != x) return false;
    return true;
}

static void test_no_rt_allocation_and_oversize() {
    std::printf("\n-- no heap allocation on the RT callback; oversized callbacks (FR-WIN-AUD-2) --\n");
    {
        Harness h(1, 128);
        wait_for([] { return g_fake.running(); });
        std::vector<float> out(128 * 2, 0.f);
        g_fake.fire(128, 0.25f, out.data());   // warm-up
        g_fake.fire(128, 0.25f, out.data());
        CHECK(g_fake.last_fire_allocs == 0, "a normal real-time callback does not allocate");

        // Larger than the backend's reported maximum: clamped, tail zero-filled.
        std::vector<float> big(1000 * 2, -1.f);
        g_fake.fire(1000, 0.25f, big.data());
        CHECK(g_fake.last_fire_allocs == 0, "an oversized real-time callback does not allocate");
        CHECK(g_cb_max_size <= 128, "the effect never sees more frames than the buffers hold");
        CHECK(all_equal(big, 0, 128 * 2, 0.5f), "the in-capacity head of an oversized callback is processed");
        CHECK(all_equal(big, 128 * 2, 1000 * 2, 0.f), "the tail beyond capacity is zero-filled");
    }
    {
        // A backend reporting a larger maximum gets buffers sized for it up front.
        Harness h(1, 128, 48000.f, 512);
        wait_for([] { return g_fake.running(); });
        std::vector<float> out(400 * 2, -1.f);
        g_fake.fire(400, 0.25f, out.data());
        CHECK(g_fake.last_fire_allocs == 0, "a callback up to maxCallbackFrames() does not allocate");
        CHECK(g_cb_max_size == 400, "the full callback is processed when the backend reported room for it");
        CHECK(all_equal(out, 0, 400 * 2, 0.5f), "and its whole output is written");
    }
    {
        // Simulated (output-only) mode shares the guarantee.
        Harness h(0);
        wait_for([] { return g_fake.running(); });
        std::vector<float> out(2000 * 2, -1.f);
        g_fake.fire(256, 0.f, out.data());
        g_fake.fire(2000, 0.f, out.data());
        CHECK(g_fake.last_fire_allocs == 0, "an oversized simulated-mode callback does not allocate");
        CHECK(g_cb_max_size <= 256, "simulated mode clamps the effect block to the buffers it has");
        CHECK(all_equal(out, 256 * 2, 2000 * 2, 0.f), "simulated mode zero-fills the tail beyond capacity");
    }
}

static void test_xruns() {
    std::printf("\n-- xrun reporting --\n");
    {
        Harness h(1);
        wait_for([] { return g_fake.running(); });
        g_fake.pending_xruns = 3;
        h.fire_blocks(kScopeBlocks, 128);
        CHECK(h.wait_msg("{\"type\":\"xrun\",\"count\":3}"), "driver xruns are reported as an xrun message");
    }
    {
        Harness h(1);
        wait_for([] { return g_fake.running(); });
        h.fire_blocks(kScopeBlocks * 2, 128);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        CHECK(!h.has("\"type\":\"xrun\""), "no xrun message without xruns");
    }
}

static void test_latency_and_render_errors() {
    std::printf("\n-- latency and render_error events --\n");
    {
        Harness h(1);
        wait_for([] { return g_fake.running(); });
        g_fake.latency_ms = 4.5f;
        h.fire_blocks(kScopeBlocks, 128);
        CHECK(h.wait_msg("{\"type\":\"latency\",\"estimatedMs\":4.50}"), "latency event carries lastLatencyMs()");
    }
    {
        Harness h(1);
        wait_for([] { return g_fake.running(); });
        h.fire_blocks(kScopeBlocks, 128);
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        CHECK(!h.has("\"type\":\"latency\""), "no latency event while latency is unknown (0)");
        CHECK(!h.has("render_error"), "no render_error event without render errors");
    }
    {
        Harness h(1);
        wait_for([] { return g_fake.running(); });
        g_fake.pending_render_errors = 2;
        h.fire_blocks(kScopeBlocks, 128);
        CHECK(h.wait_msg("{\"type\":\"event\",\"kind\":\"render_error\",\"count\":2}"),
              "render errors surface as a render_error event");
    }
}

static void test_sample_rate_mismatch() {
    std::printf("\n-- sample_rate_mismatch --\n");
    {
        Harness h(1, 128, 48000.f);
        // The engine reads queriedInputSampleRate() right after start(); the
        // knob must be set before that, so restart the stream via a config bump.
        wait_for([] { return g_fake.start_calls.load() == 1; });
        g_fake.queried_rate = 44100.f;
        g_state.config_generation++;
        h.poke();
        CHECK(h.wait_msg("\"kind\":\"sample_rate_mismatch\",\"engineSampleRate\":48000.0,\"deviceSampleRate\":44100.0"),
              "a device rate different from the engine rate raises sample_rate_mismatch");
    }
    {
        Harness h(1, 128, 48000.f);
        wait_for([] { return g_fake.start_calls.load() == 1; });
        g_fake.queried_rate = 48000.f;
        g_state.config_generation++;
        h.poke();
        wait_for([] { return g_fake.start_calls.load() == 2; });
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        CHECK(!h.has("sample_rate_mismatch"), "matching rates raise no sample_rate_mismatch");
    }
}

static void test_realtime_unavailable_fallback() {
    std::printf("\n-- realtime_unavailable fallback --\n");
    Harness h(1);
    // start() failure must be injected before the engine thread reaches it.
    // Harness resets the fake in its ctor, so poke a restart with the knob set.
    wait_for([] { return g_fake.start_calls.load() == 1; });
    g_fake.duplex_ok = false;
    g_state.config_generation++;
    h.poke();
    CHECK(h.wait_msg("{\"type\":\"event\",\"kind\":\"realtime_unavailable\"}"),
          "a failed duplex start() emits realtime_unavailable");
    CHECK(wait_for([] { return g_state.audio_mode.load() == 0; }),
          "the engine falls back to simulated mode");
    CHECK(wait_for([] { return g_fake.output_calls.load() >= 1; }),
          "simulated mode opens an output-only stream after the fallback");
}

static void test_mode_switching() {
    std::printf("\n-- mode switching --\n");
    Harness h(1, 128, 48000.f);
    wait_for([] { return g_fake.start_calls.load() == 1; });

    g_state.audio_mode = 0;
    h.poke();
    CHECK(wait_for([] { return g_fake.output_calls.load() == 1; }),
          "switching to simulated mode opens an output-only stream");
    CHECK(g_fake.stop_calls >= 1, "the real-time stream is stopped on the switch");
    CHECK(g_fake.last_buffer == 256, "simulated mode never requests fewer than 256 frames");
    CHECK(g_fake.last_rate == 48000, "simulated mode uses the configured sample rate");

    std::vector<float> out(256 * 2, 0.f);
    CHECK(wait_for([] { return g_fake.running(); }), "output-only stream is running");
    g_fake.fire(256, 0.f, out.data());
    bool nonzero = false;
    for (float s : out) if (s != 0.f) { nonzero = true; break; }
    CHECK(nonzero, "simulated mode feeds the generated input through the effect to the driver");

    g_state.audio_mode = 1;
    h.poke();
    CHECK(wait_for([] { return g_fake.start_calls.load() == 2; }),
          "switching back to real-time reopens the duplex stream");
}

static void test_simulated_silent_fallback() {
    std::printf("\n-- output-only failure: silent software loop --\n");
    Harness h(0);
    wait_for([] { return g_fake.output_calls.load() >= 1; });
    // output_ok defaulted to true in the ctor; force the failure path by
    // restarting with the knob cleared.
    g_fake.output_ok = false;
    g_state.config_generation++;
    h.poke();
    CHECK(wait_for([] { return g_fake.output_calls.load() == 2; }),
          "a config change retries the output-only stream");
    CHECK(wait_for([] { return g_cb_calls.load() > 10; }),
          "without an output device the software loop still drives the effect callback");
    h.finish();
    CHECK(true, "the silent loop exits cleanly on shutdown");
}

int main() {
    std::printf("=== Real-time path regression tests (M79 / FR-WIN-AUD-4) ===\n");
    test_realtime_start_params();
    test_audio_device_reconfig();
    test_processing_and_transport();
    test_no_rt_allocation_and_oversize();
    test_xruns();
    test_latency_and_render_errors();
    test_sample_rate_mismatch();
    test_realtime_unavailable_fallback();
    test_mode_switching();
    test_simulated_silent_fallback();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
