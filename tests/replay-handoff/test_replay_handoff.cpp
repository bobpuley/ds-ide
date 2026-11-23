// FR-RTS-7: restarting or stopping a replay never races the audio thread.
// Built under ThreadSanitizer by run_tests.sh: any data race on the
// SessionPlayer (stream_, ring indices) fails the run.
//
// Reader = the audio thread: replay_consumer_enter() / popBlock() /
// replay_consumer_exit(). Writer = the IPC thread: replay_stop_consumer(),
// then close()/open() under player_mutex, as replayStart/replayStop do.

#include "emulator_state.h"
#include "replay_handoff.h"
#include "session_recorder.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <string>
#include <thread>
#include <unistd.h>

namespace daisy_emu { EmulatorState g_state; }
using namespace daisy_emu;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static constexpr uint32_t kBlock  = 48;
static constexpr int      kBlocks = 400;

// A recording whose block k holds the value k in every sample.
static std::string make_recording() {
    const std::string path = "/tmp/ds_ide_replay_handoff_" + std::to_string(::getpid()) + ".dsr";
    SessionRecorder rec;
    if (!rec.start(path, 48000, kBlock)) return "";
    float buf[kBlock * 2];
    for (int k = 0; k < kBlocks; ++k) {
        for (float& s : buf) s = static_cast<float>(k);
        while (!rec.enqueueBlock(buf, kBlock)) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    rec.stop();
    return path;
}

// The audio thread's side, as process_one_block() does it.
struct Reader {
    std::atomic<bool> stop{false};
    std::atomic<uint64_t> gen_seen{0};
    std::atomic<int> first_bad{0}, firsts{0}, pops{0};
    void run() {
        float buf[kBlock * 2];
        ReplayEvent ev[SessionPlayer::kMaxEventsPerSlot];
        uint64_t last_gen = 0;
        while (!stop.load()) {
            if (!replay_consumer_enter()) { std::this_thread::yield(); continue; }
            const uint64_t gen = g_state.replay_generation.load();
            size_t n = 0;
            const bool got = g_state.player.popBlock(buf, kBlock, ev, SessionPlayer::kMaxEventsPerSlot, n);
            replay_consumer_exit();
            if (!got) continue;
            pops.fetch_add(1);
            if (gen != last_gen) {          // first block of a (re)started replay
                last_gen = gen;
                firsts.fetch_add(1);
                if (buf[0] != 0.f || buf[kBlock * 2 - 1] != 0.f) first_bad.fetch_add(1);
            }
        }
    }
};

// The IPC thread's side of replayStart (also used while a replay runs).
static void replay_start(const std::string& path) {
    replay_stop_consumer();
    uint32_t sr = 0, bs = 0;
    {
        std::lock_guard<std::mutex> lk(g_state.player_mutex);
        g_state.player.close();
        g_state.player.open(path, sr, bs);
    }
    g_state.replay_generation.fetch_add(1);
    g_state.replay_active.store(true);
}

static void replay_stop() {
    replay_stop_consumer();
    std::lock_guard<std::mutex> lk(g_state.player_mutex);
    g_state.player.close();
}

static void test_restart_and_stop_during_playback(const std::string& path) {
    std::printf("--- replayStart twice / replayStart then replayStop during playback (FR-RTS-7) ---\n");
    Reader reader;
    std::thread rt([&] { reader.run(); });
    for (int i = 0; i < 150; ++i) {
        replay_start(path);
        std::this_thread::sleep_for(std::chrono::microseconds(300));
        replay_start(path);                       // restart while running
        std::this_thread::sleep_for(std::chrono::microseconds(300));
        if (i % 3 == 0) replay_stop();            // stop while running
    }
    replay_stop();
    reader.stop = true;
    rt.join();
    char msg[160];
    std::snprintf(msg, sizeof(msg), "%d restarts observed by the reader (%d blocks popped)",
                  reader.firsts.load(), reader.pops.load());
    CHECK(reader.firsts.load() > 0, msg);
    CHECK(reader.first_bad.load() == 0, "every restarted replay plays from block 0, with nothing from the previous session");
}

static void test_stop_waits_for_consumer() {
    std::printf("--- replay_stop_consumer() waits until the audio thread is out of popBlock (FR-RTS-7) ---\n");
    g_state.replay_active.store(true);
    CHECK(replay_consumer_enter(), "the consumer may enter while replay is active");
    std::atomic<bool> returned{false};
    std::thread ipc([&] { replay_stop_consumer(); returned = true; });
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    CHECK(!returned.load(), "stop does not return while the consumer is inside");
    replay_consumer_exit();
    ipc.join();
    CHECK(returned.load(), "stop returns once the consumer has left");
    CHECK(!replay_consumer_enter(), "after stop the consumer can no longer enter");
}

int main() {
    const std::string path = make_recording();
    CHECK(!path.empty(), "test recording written");
    if (path.empty()) return 1;
    test_stop_waits_for_consumer();
    test_restart_and_stop_during_playback(path);
    std::remove(path.c_str());
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
