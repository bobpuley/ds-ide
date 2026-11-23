// FR-RTS-6: a WAV can be swapped or cleared during playback without
// use-after-free. run_tests.sh builds this twice — under ThreadSanitizer and
// under AddressSanitizer — so a race or a read of freed memory fails the run.
//
// Reader = the audio thread (wav_reader_acquire / wav_reader_release around
// each block); writer = the IPC thread (WavRetirer::publish on each wavFile).

#include "emulator_state.h"
#include "wav_handoff.h"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <thread>

namespace daisy_emu { EmulatorState g_state; }
using namespace daisy_emu;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static WavData* make_wav(float value, size_t frames = 2048) {
    auto* w = new WavData();
    w->sample_rate = 48000;
    w->channels = 2;
    w->samples.assign(frames * 2, value);
    return w;
}

// Every sample of a live buffer equals its fill value; reading a freed one is
// what ASAN reports.
static bool read_block(const WavData* w) {
    const float v = w->samples[0];
    float sum = 0.f;
    for (float s : w->samples) sum += s - v;
    return sum == 0.f;
}

static void test_swap_and_clear_stress() {
    std::printf("--- swap/clear in a tight loop while the reader plays (FR-RTS-6) ---\n");
    WavRetirer retirer(std::chrono::milliseconds(2));
    std::atomic<bool> stop{false};
    std::atomic<long> blocks{0}, bad{0};
    std::thread reader([&] {
        while (!stop.load()) {
            const WavData* w = wav_reader_acquire();
            if (w && !read_block(w)) bad.fetch_add(1);
            wav_reader_release();
            blocks.fetch_add(1);
        }
    });
    for (int i = 0; i < 3000; ++i) {
        retirer.publish(i % 5 == 4 ? nullptr : make_wav(static_cast<float>(i)));
    }
    retirer.publish(nullptr);
    stop = true;
    reader.join();
    retirer.reclaim(std::chrono::milliseconds(0));
    char msg[120];
    std::snprintf(msg, sizeof(msg), "reader rendered %ld blocks, all from intact buffers", blocks.load());
    CHECK(blocks.load() > 0 && bad.load() == 0, msg);
    CHECK(retirer.pending() == 0, "every retired buffer is freed once the reader has moved off it");
}

static void test_no_free_on_timeout() {
    std::printf("--- a buffer still in use is never freed, however long it is held (FR-RTS-6) ---\n");
    WavRetirer retirer(std::chrono::milliseconds(20));
    retirer.publish(make_wav(1.f));
    const WavData* held = wav_reader_acquire();   // the reader is inside a block...
    retirer.publish(make_wav(2.f));               // ...when a new WAV arrives
    CHECK(retirer.pending() == 1, "after the wait budget the old buffer is kept on the retire list, not deleted");
    CHECK(held && read_block(held) && held->samples[0] == 1.f, "the reader can still read the buffer it holds");
    wav_reader_release();
    retirer.publish(nullptr);                     // next retire reclaims what is no longer in use
    CHECK(retirer.pending() == 0, "the next retire frees it once the reader has released it");
    retirer.reclaim_all_after_reader_stopped();
}

int main() {
    test_no_free_on_timeout();
    test_swap_and_clear_stress();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
