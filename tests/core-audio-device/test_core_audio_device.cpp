// Unit test for FR-QA-EMU-2: CoreAudioDevice cannot be double-freed via
// accidental copy.
//
// Impl* had no deleted copy/move; copying a started device would yield two
// owners of the same heap-allocated Impl and a double `delete` at scope
// exit. Impl is now owned via std::unique_ptr<Impl> and the copy
// constructor/assignment are explicitly deleted, so an accidental copy is a
// compile error instead of a runtime double-free.
//
// No audio hardware is started here — CoreAudio interaction stays untested
// by this harness (see tests/emulator-safety, which avoids linking this
// file for the same reason). This test only exercises type traits and
// construct/destruct safety.

#include "core_audio_device.h"

#include <cstdio>
#include <type_traits>

using daisy_emu::CoreAudioDevice;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

int main() {
    std::printf("=== CoreAudioDevice unit tests (M41 / FR-QA-EMU-2) ===\n\n");

    CHECK(!std::is_copy_constructible<CoreAudioDevice>::value,
          "CoreAudioDevice is not copy-constructible");
    CHECK(!std::is_copy_assignable<CoreAudioDevice>::value,
          "CoreAudioDevice is not copy-assignable");

    // Never-started device: impl_ is null; construct/destruct must not crash.
    {
        CoreAudioDevice dev;
        CHECK(!dev.isRunning(), "a freshly constructed device is not running");
        CHECK(dev.lastLatencyMs() == 0.f, "lastLatencyMs() is 0 before start");
        CHECK(dev.drainXruns() == 0, "drainXruns() is 0 before start");
    }
    CHECK(true, "never-started device destructs cleanly");

    // stop() on a never-started device must be a safe no-op (exercises the
    // unique_ptr-based reset() path with a null impl_).
    {
        CoreAudioDevice dev;
        dev.stop();
        dev.stop();
    }
    CHECK(true, "repeated stop() on a never-started device does not crash");

    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
