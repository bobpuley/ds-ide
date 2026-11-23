// FR-RTS-8: engine state changes are never missed.
//
// Drives the real IPC handlers (dispatch()) against run_audio_engine() on the
// fake audio backend from tests/audio-engine:
//   - an `audioDevice` change always reaches the device, whether it arrives
//     while real-time audio is running or right after `audioMode`, in either
//     order;
//   - a `shutdown` message alone wakes and ends the engine;
//   - the shutdown watcher's loop (wake_engine_until_exited) ends the engine
//     when only the flag is set (signal handler / effect_main() return).
// Each wait has a timeout, so a lost wake-up is a FAIL, not a hang.

#include "audio_engine.h"
#include "emulator_state.h"
#include "engine_notify.h"
#include "fake_audio_backend.h"
#include "ipc_server.h"

#include <chrono>
#include <cstdio>
#include <string>
#include <thread>

using namespace daisy_emu;
using fake_audio::g_fake;

namespace daisy_emu { EmulatorState g_state; }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

template <typename Pred>
static bool wait_for(Pred pred, int timeout_ms = 2000) {
    auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return pred();
}

static void passthrough(const float* in, float* out, size_t size) {
    for (size_t i = 0; i < size; ++i) out[i] = in[i];
}

static std::thread g_engine;

static void start_engine(int mode, float rate = 48000.f, size_t rt_buffer = 128) {
    g_fake.reset();
    g_state.shutdown = false;
    g_state.engine_exited = false;
    g_state.transport_running = true;
    g_state.audio_mode = mode;
    g_state.sample_rate = rate;
    g_state.block_size = 48;
    g_state.rt_buffer_size = rt_buffer;
    g_state.interleaving_cb = passthrough;
    {
        std::lock_guard<std::mutex> lk(g_state.callback_mutex);
        g_state.callback_set = true;
    }
    g_state.callback_cv.notify_all();
    g_engine = std::thread([] { run_audio_engine(); });
}

// Ends the engine whatever state it is in (test cleanup, not under test).
static void force_stop_engine() {
    g_state.shutdown = true;
    while (!g_state.engine_exited.load()) {
        { std::lock_guard<std::mutex> lk(g_state.mode_mutex); }
        g_state.mode_cv.notify_all();
        { std::lock_guard<std::mutex> lk(g_state.callback_mutex); }
        g_state.callback_cv.notify_all();
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    g_engine.join();
}

static void test_audio_device_while_running() {
    std::printf("--- audioDevice while real-time audio runs restarts the device (FR-RTS-8) ---\n");
    start_engine(1, 48000.f, 128);
    wait_for([] { return g_fake.start_calls.load() == 1; });
    dispatch(R"({"type":"audioDevice","sampleRate":44100,"bufferSize":64})");
    CHECK(wait_for([] { return g_fake.start_calls.load() >= 2 && g_fake.last_rate == 44100 && g_fake.last_buffer == 64; }),
          "the running stream is reopened with the new sample rate and buffer size");
    force_stop_engine();
}

static void test_mode_and_device_back_to_back() {
    std::printf("--- audioMode + audioDevice back to back, both orders (FR-RTS-8) ---\n");
    int ok_mode_first = 0, ok_device_first = 0;
    constexpr int kRounds = 25;
    for (int i = 0; i < kRounds; ++i) {
        start_engine(0, 48000.f, 128);
        wait_for([] { return g_fake.output_calls.load() >= 1; });
        dispatch(R"({"type":"audioMode","mode":"realtime"})");
        dispatch(R"({"type":"audioDevice","sampleRate":44100,"bufferSize":64})");
        if (wait_for([] { return g_fake.running() && g_fake.start_calls.load() >= 1 &&
                                 g_fake.last_rate == 44100 && g_fake.last_buffer == 64; }))
            ++ok_mode_first;
        force_stop_engine();

        start_engine(0, 48000.f, 128);
        wait_for([] { return g_fake.output_calls.load() >= 1; });
        dispatch(R"({"type":"audioDevice","sampleRate":96000,"bufferSize":256})");
        dispatch(R"({"type":"audioMode","mode":"realtime"})");
        if (wait_for([] { return g_fake.running() && g_fake.start_calls.load() >= 1 &&
                                 g_fake.last_rate == 96000 && g_fake.last_buffer == 256; }))
            ++ok_device_first;
        force_stop_engine();
    }
    char msg[120];
    std::snprintf(msg, sizeof(msg), "audioMode then audioDevice: new values applied %d/%d times", ok_mode_first, kRounds);
    CHECK(ok_mode_first == kRounds, msg);
    std::snprintf(msg, sizeof(msg), "audioDevice then audioMode: new values applied %d/%d times", ok_device_first, kRounds);
    CHECK(ok_device_first == kRounds, msg);
}

static void test_shutdown_message_ends_engine() {
    std::printf("--- a shutdown message alone ends the engine, every time (FR-RTS-8) ---\n");
    int exited = 0;
    constexpr int kRounds = 100;
    for (int i = 0; i < kRounds; ++i) {
        start_engine(i % 2, 48000.f, 128);   // alternate simulated / real-time
        wait_for([] { return g_fake.running(); });
        dispatch(R"({"type":"shutdown"})");
        if (wait_for([] { return g_state.engine_exited.load(); }, 1000)) ++exited;
        force_stop_engine();
    }
    char msg[120];
    std::snprintf(msg, sizeof(msg), "engine exited on its own %d/%d times", exited, kRounds);
    CHECK(exited == kRounds, msg);
}

static void test_watcher_ends_engine() {
    std::printf("--- the shutdown watcher ends the engine when only the flag is set (FR-RTS-8) ---\n");
    int exited = 0;
    constexpr int kRounds = 100;
    for (int i = 0; i < kRounds; ++i) {
        start_engine(i % 2, 48000.f, 128);
        wait_for([] { return g_fake.running(); });
        g_state.shutdown.store(true, std::memory_order_relaxed);   // as the signal handler does
        std::thread watcher([] { wake_engine_until_exited(); });
        if (wait_for([] { return g_state.engine_exited.load(); }, 1000)) ++exited;
        force_stop_engine();
        watcher.join();
    }
    char msg[120];
    std::snprintf(msg, sizeof(msg), "engine exited %d/%d times", exited, kRounds);
    CHECK(exited == kRounds, msg);
}

int main() {
    std::printf("=== Engine wake-ups (FR-RTS-8) ===\n");
    test_audio_device_while_running();
    test_mode_and_device_back_to_back();
    test_shutdown_message_ends_engine();
    test_watcher_ends_engine();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
