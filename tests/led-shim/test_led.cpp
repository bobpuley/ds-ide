// Unit test for the C5 LED output shim (T10.3 / FR-RTS-3).
//
// Verifies that DaisySeed::SetLed and Led::Set/Update emit `led` IPC messages
// keyed to the right pin, with change-deduplication and invert handling.
// After FR-RTS-3: messages are enqueued via an SPSC queue, not send_ipc.
// FR-EMU-9: that queue is led_queue, a dedicated instance separate from
// ipc_queue (which the audio RT thread also produces into).
// Plain asserts; exit 0 on pass.

#include "daisy/daisy_seed_class.h"
#include "daisy/led.h"
#include "emulator_state.h"

#include <cstdio>
#include <string>
#include <vector>

namespace daisy_emu {
EmulatorState g_state;  // single global, as defined in runtime/main.cpp
}

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

// Drain all messages from the SPSC queue into a vector.
static std::vector<std::string> drain_queue() {
    std::vector<std::string> result;
    std::string msg;
    while (daisy_emu::g_state.led_queue.pop(msg))
        result.push_back(msg);
    return result;
}

static void reset_state() {
    // Drain any leftover messages from the queue.
    drain_queue();
    for (auto& l : daisy_emu::g_state.led_last_state) l.store(-1);
}

static bool contains(const std::string& s, const std::string& sub) {
    return s.find(sub) != std::string::npos;
}

static void test_setled_onboard() {
    std::printf("--- test_setled_onboard ---\n");
    reset_state();
    daisy::DaisySeed hw;
    hw.SetLed(true);
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "SetLed(true) enqueues one led message");
    CHECK(contains(msgs.back(), "\"gpioPin\":23"), "SetLed maps to onboard pin 23");
    CHECK(contains(msgs.back(), "\"lit\":true"), "SetLed(true) → lit true");

    hw.SetLed(false);
    msgs = drain_queue();
    CHECK(msgs.size() == 1, "SetLed(false) enqueues a change");
    CHECK(contains(msgs.back(), "\"lit\":false"), "SetLed(false) → lit false");
}

static void test_setled_dedup() {
    std::printf("--- test_setled_dedup ---\n");
    reset_state();
    daisy::DaisySeed hw;
    hw.SetLed(true);
    hw.SetLed(true);
    hw.SetLed(true);
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "repeated SetLed(true) enqueues only once (dedup)");
}

static void test_led_external_pin() {
    std::printf("--- test_led_external_pin ---\n");
    reset_state();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, /*invert=*/false);
    led.Set(0.8f);
    led.Update();
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "Led::Update enqueues after Set");
    CHECK(contains(msgs.back(), "\"gpioPin\":18"), "Led enqueues on its declared pin");
    CHECK(contains(msgs.back(), "\"lit\":true"), "brightness>0 → lit true");

    led.Set(0.f);
    led.Update();
    msgs = drain_queue();
    CHECK(contains(msgs.back(), "\"lit\":false"), "brightness 0 → lit false");
}

static void test_led_invert() {
    std::printf("--- test_led_invert ---\n");
    reset_state();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, /*invert=*/true);
    led.Set(0.f);
    led.Update();
    auto msgs = drain_queue();
    CHECK(contains(msgs.back(), "\"lit\":true"), "invert: brightness 0 → lit true");
}

static void test_set_without_update_is_silent() {
    std::printf("--- test_set_without_update_is_silent ---\n");
    reset_state();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, false);
    led.Set(1.0f);  // no Update()
    auto msgs = drain_queue();
    CHECK(msgs.empty(), "Set() without Update() enqueues nothing");
}

// FR-RTS-3 specific: verify no mutex path is taken (send_ipc is never called).
static void test_led_does_not_use_send_ipc() {
    std::printf("--- FR-RTS-3: LED bypasses send_ipc ---\n");
    reset_state();
    bool send_ipc_called = false;
    daisy_emu::g_state.send_ipc = [&](std::string) { send_ipc_called = true; };

    daisy::DaisySeed hw;
    hw.SetLed(true);

    CHECK(!send_ipc_called, "emit_led_change does not invoke send_ipc (FR-RTS-3)");
    // Message should be in the SPSC queue instead.
    auto msgs = drain_queue();
    CHECK(msgs.size() == 1, "led message is in SPSC queue (FR-RTS-3)");

    // Clear send_ipc
    daisy_emu::g_state.send_ipc = nullptr;
}

int main() {
    std::printf("=== LED shim unit tests (T10.3 / FR-RTS-3) ===\n");
    test_setled_onboard();
    test_setled_dedup();
    test_led_external_pin();
    test_led_invert();
    test_set_without_update_is_silent();
    test_led_does_not_use_send_ipc();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
