// Unit test for the C5 Switch shim + button state (T10.2).
//
// Exercises the edge/press logic of daisy::Switch against the virtual button
// state in EmulatorState, with no IPC or audio thread. Plain asserts; exit 0
// on success. Provides its own g_state definition (normally in main.cpp).

#include "daisy/switch.h"
#include "emulator_state.h"

#include <cstdio>

namespace daisy_emu {
EmulatorState g_state;  // single global, as defined in runtime/main.cpp
}

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static dsy_gpio_pin pin(uint8_t n) { return dsy_gpio_pin{0, n}; }

static void reset_state() {
    for (auto& b : daisy_emu::g_state.button_states) b.store(false);
}

static void test_press_and_edges() {
    reset_state();
    daisy::Switch sw;
    sw.Init(pin(28));

    sw.Debounce();
    CHECK(!sw.Pressed(), "released: Pressed() false");
    CHECK(!sw.RisingEdge(), "released: no RisingEdge");
    CHECK(!sw.FallingEdge(), "released: no FallingEdge");

    daisy_emu::g_state.button_states[28].store(true);
    sw.Debounce();
    CHECK(sw.Pressed(), "press: Pressed() true");
    CHECK(sw.RisingEdge(), "press: RisingEdge() true on first sample");
    CHECK(!sw.FallingEdge(), "press: no FallingEdge");

    sw.Debounce();  // still held
    CHECK(sw.Pressed(), "hold: Pressed() stays true");
    CHECK(!sw.RisingEdge(), "hold: RisingEdge() clears after one call");

    daisy_emu::g_state.button_states[28].store(false);
    sw.Debounce();
    CHECK(!sw.Pressed(), "release: Pressed() false");
    CHECK(sw.FallingEdge(), "release: FallingEdge() true");
    CHECK(!sw.RisingEdge(), "release: no RisingEdge");
}

static void test_two_switches_independent() {
    reset_state();
    daisy::Switch a, b;
    a.Init(pin(28));
    b.Init(pin(25));

    daisy_emu::g_state.button_states[28].store(true);
    a.Debounce();
    b.Debounce();
    CHECK(a.Pressed(), "switch A on pin 28 pressed");
    CHECK(!b.Pressed(), "switch B on pin 25 unaffected");
}

static void test_uninitialized_is_safe() {
    reset_state();
    daisy::Switch sw;  // never Init'd (pin_ = -1)
    sw.Debounce();
    CHECK(!sw.Pressed(), "uninitialized switch reads released, no crash");
}

int main() {
    std::printf("=== Switch shim unit tests (T10.2) ===\n");
    test_press_and_edges();
    test_two_switches_independent();
    test_uninitialized_is_safe();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
