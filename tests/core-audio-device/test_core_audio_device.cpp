// AudioDevice contract tests (M41 / FR-QA-EMU-2, generalised in M79 / FR-WIN-AUD-1).
//
// The same contract is asserted for every backend: the platform backend from
// make_audio_device() (CoreAudio on macOS, RtAudio on Windows), the RtAudio
// backend built on every host (RtAudio's dummy API off Windows, M80 /
// FR-WIN-AUD-5) and the fake used by the engine tests. A device cannot be copied or moved (double-free
// of the driver handle), reports defaults before start, and stop() is
// idempotent.
//
// No audio hardware is started here — the real CoreAudio stream stays untested
// by this harness; the engine's use of it is covered by tests/audio-engine.

#include "audio_device.h"
#include "fake_audio_device.h"
#include "audio_device_rtaudio.h"

#include <cstdio>
#include <memory>
#include <type_traits>

using daisy_emu::AudioDevice;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

template <typename T>
static void check_type_traits(const char* name) {
    std::printf("-- %s: type traits --\n", name);
    CHECK(!std::is_copy_constructible<T>::value, "is not copy-constructible");
    CHECK(!std::is_copy_assignable<T>::value, "is not copy-assignable");
    CHECK(!std::is_move_constructible<T>::value, "is not move-constructible");
    CHECK(!std::is_move_assignable<T>::value, "is not move-assignable");
}

static void check_contract(const char* name, std::unique_ptr<AudioDevice> dev) {
    std::printf("-- %s: lifecycle contract --\n", name);
    CHECK(dev != nullptr, "the factory returns a device");
    CHECK(!dev->isRunning(), "a freshly constructed device is not running");
    CHECK(dev->lastLatencyMs() == 0.f, "lastLatencyMs() is 0 before start");
    CHECK(dev->drainXruns() == 0, "drainXruns() is 0 before start");
    CHECK(dev->drainRenderErrors() == 0, "drainRenderErrors() is 0 before start");
    CHECK(dev->drainDriverOverruns() == 0, "drainDriverOverruns() is 0 before start");
    CHECK(dev->queriedInputSampleRate() == 0.f, "queriedInputSampleRate() is 0 before start");
    CHECK(dev->actualBufferFrames() == 0, "actualBufferFrames() is 0 before start");
    CHECK(dev->maxCallbackFrames(256) >= 256, "maxCallbackFrames() is at least the requested size");
    CHECK(dev->maxCallbackFrames(1) >= 1, "maxCallbackFrames() honours a tiny requested size");
    dev->stop();
    dev->stop();
    CHECK(!dev->isRunning(), "repeated stop() on a never-started device is a safe no-op");
    dev.reset();
    CHECK(true, "never-started device destructs cleanly");
}

int main() {
    std::printf("=== AudioDevice contract tests (M41 / FR-QA-EMU-2, M79 / FR-WIN-AUD-1) ===\n\n");

    check_type_traits<AudioDevice>("AudioDevice");
    check_type_traits<fake_audio::FakeAudioDevice>("FakeAudioDevice");
    check_type_traits<daisy_emu::RtAudioDevice>("RtAudioDevice");

    check_contract("platform backend (make_audio_device)", daisy_emu::make_audio_device());
    check_contract("fake backend", std::make_unique<fake_audio::FakeAudioDevice>());
    check_contract("RtAudio backend", std::make_unique<daisy_emu::RtAudioDevice>());

    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
