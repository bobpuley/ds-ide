// Unit test for the C5 LED output shim (T10.3).
//
// Verifies that DaisySeed::SetLed and Led::Set/Update emit `led` IPC messages
// keyed to the right pin, with change-deduplication and invert handling.
// Captures emitted IPC lines via g_state.send_ipc. Plain asserts; exit 0 on pass.

#include "daisy/daisy_seed_class.h"
#include "daisy/led.h"
#include "emulator_state.h"

#include <cstdio>
#include <string>
#include <vector>

namespace daisy_emu {
EmulatorState g_state;  // single global, as defined in runtime/main.cpp
}

static std::vector<std::string> g_emitted;

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static void install_capture() {
    daisy_emu::g_state.send_ipc = [](std::string s) { g_emitted.push_back(s); };
    for (auto& l : daisy_emu::g_state.led_last_state) l.store(-1);
    g_emitted.clear();
}

static bool contains(const std::string& s, const std::string& sub) {
    return s.find(sub) != std::string::npos;
}

static void test_setled_onboard() {
    install_capture();
    daisy::DaisySeed hw;
    hw.SetLed(true);
    CHECK(g_emitted.size() == 1, "SetLed(true) emits one led message");
    CHECK(contains(g_emitted.back(), "\"gpioPin\":23"), "SetLed maps to onboard pin 23");
    CHECK(contains(g_emitted.back(), "\"lit\":true"), "SetLed(true) → lit true");

    hw.SetLed(false);
    CHECK(g_emitted.size() == 2, "SetLed(false) emits a change");
    CHECK(contains(g_emitted.back(), "\"lit\":false"), "SetLed(false) → lit false");
}

static void test_setled_dedup() {
    install_capture();
    daisy::DaisySeed hw;
    hw.SetLed(true);
    hw.SetLed(true);
    hw.SetLed(true);
    CHECK(g_emitted.size() == 1, "repeated SetLed(true) emits only once (dedup)");
}

static void test_led_external_pin() {
    install_capture();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, /*invert=*/false);
    led.Set(0.8f);
    led.Update();
    CHECK(g_emitted.size() == 1, "Led::Update emits after Set");
    CHECK(contains(g_emitted.back(), "\"gpioPin\":18"), "Led emits on its declared pin");
    CHECK(contains(g_emitted.back(), "\"lit\":true"), "brightness>0 → lit true");

    led.Set(0.f);
    led.Update();
    CHECK(contains(g_emitted.back(), "\"lit\":false"), "brightness 0 → lit false");
}

static void test_led_invert() {
    install_capture();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, /*invert=*/true);
    led.Set(0.f);
    led.Update();
    CHECK(contains(g_emitted.back(), "\"lit\":true"), "invert: brightness 0 → lit true");
}

static void test_set_without_update_is_silent() {
    install_capture();
    daisy::Led led;
    led.Init(dsy_gpio_pin{0, 18}, false);
    led.Set(1.0f);  // no Update()
    CHECK(g_emitted.empty(), "Set() without Update() emits nothing");
}

int main() {
    std::printf("=== LED shim unit tests (T10.3) ===\n");
    test_setled_onboard();
    test_setled_dedup();
    test_led_external_pin();
    test_led_invert();
    test_set_without_update_is_silent();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
