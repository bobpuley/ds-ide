// Unit tests for FR-QA-EMU-3: DaisySeed::StartAudio() registration reflects
// the most recent call.
//
// Previously each overload set its own callback pointer without clearing the
// other, so calling StartAudio(interleaving) then StartAudio(block) left both
// pointers non-null — the audio engine's use_block flag was latched once at
// startup, so the "real" active overload depended on evaluation order rather
// than which one was called last. Now each overload nulls the other, and a
// repeated call emits a warning event.

#include "daisy/daisy_seed_class.h"
#include "emulator_state.h"

#include <cstdio>
#include <string>
#include <vector>

namespace daisy_emu { EmulatorState g_state; }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static void interleaving_cb_a(daisy::AudioHandle::InterleavingInputBuffer,
                              daisy::AudioHandle::InterleavingOutputBuffer, size_t) {}
static void interleaving_cb_b(daisy::AudioHandle::InterleavingInputBuffer,
                              daisy::AudioHandle::InterleavingOutputBuffer, size_t) {}
static void block_cb_a(daisy::AudioHandle::InputBuffer,
                       daisy::AudioHandle::OutputBuffer, size_t) {}

static void reset_state() {
    daisy_emu::g_state.interleaving_cb.store(nullptr);
    daisy_emu::g_state.block_cb.store(nullptr);
    daisy_emu::g_state.callback_set = false;
}

int main() {
    std::printf("=== DaisySeed::StartAudio unit tests (M41 / FR-QA-EMU-3) ===\n\n");

    // ---- First StartAudio(interleaving) call sets exactly one pointer -----
    reset_state();
    daisy::DaisySeed hw;
    hw.StartAudio(interleaving_cb_a);
    CHECK(daisy_emu::g_state.interleaving_cb.load() == interleaving_cb_a,
          "interleaving_cb set to the registered callback");
    CHECK(daisy_emu::g_state.block_cb.load() == nullptr,
          "block_cb stays null after an interleaving StartAudio()");
    CHECK(daisy_emu::g_state.callback_set, "callback_set becomes true");

    // ---- Switching overloads nulls the previous one ------------------------
    reset_state();
    hw.StartAudio(interleaving_cb_a);
    hw.StartAudio(block_cb_a);
    CHECK(daisy_emu::g_state.block_cb.load() == block_cb_a,
          "block_cb set after a subsequent block-form StartAudio()");
    CHECK(daisy_emu::g_state.interleaving_cb.load() == nullptr,
          "interleaving_cb is nulled once the block-form overload is registered");

    // Reverse direction: block then interleaving.
    reset_state();
    hw.StartAudio(block_cb_a);
    hw.StartAudio(interleaving_cb_a);
    CHECK(daisy_emu::g_state.interleaving_cb.load() == interleaving_cb_a,
          "interleaving_cb set after a subsequent interleaving-form StartAudio()");
    CHECK(daisy_emu::g_state.block_cb.load() == nullptr,
          "block_cb is nulled once the interleaving-form overload is registered");

    // ---- A repeated StartAudio() call fires a warning event ----------------
    reset_state();
    std::vector<std::string> sent;
    {
        std::lock_guard<std::mutex> lk(daisy_emu::g_state.send_mutex);
        daisy_emu::g_state.send_ipc = [&sent](std::string msg) { sent.push_back(std::move(msg)); };
    }
    hw.StartAudio(interleaving_cb_a);
    CHECK(sent.empty(), "the first StartAudio() call does not emit a warning");
    hw.StartAudio(interleaving_cb_b);
    CHECK(sent.size() == 1, "a second StartAudio() call emits exactly one warning event");
    if (!sent.empty()) {
        CHECK(sent[0].find("start_audio_repeated") != std::string::npos,
              "the warning event names the repeated-StartAudio condition");
    }
    CHECK(daisy_emu::g_state.interleaving_cb.load() == interleaving_cb_b,
          "the second call's callback still takes effect despite the warning");

    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
