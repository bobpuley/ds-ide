// Unit test for the Switch3 (toggle switch) shim (M44, FR-DEV-7).
//
// Exercises position read/round-trip logic against the virtual toggle-state
// array in EmulatorState, with no IPC or audio thread. Plain asserts; exit 0
// on success. Provides its own g_state definition (normally in main.cpp).

#include "daisy/switch3.h"
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
    for (auto& t : daisy_emu::g_state.toggle_states) t.store(0);
}

static void test_default_position_is_zero() {
    reset_state();
    daisy::Switch3 sw;
    sw.Init(pin(5));
    sw.Debounce();
    CHECK(sw.Read() == 0, "default position reads 0");
}

static void test_position_round_trip() {
    reset_state();
    daisy::Switch3 sw;
    sw.Init(pin(5));

    daisy_emu::g_state.toggle_states[5].store(1);
    sw.Debounce();
    CHECK(sw.Read() == 1, "position 1 round-trips");

    daisy_emu::g_state.toggle_states[5].store(2);
    sw.Debounce();
    CHECK(sw.Read() == 2, "position 2 round-trips");

    daisy_emu::g_state.toggle_states[5].store(0);
    sw.Debounce();
    CHECK(sw.Read() == 0, "position back to 0 round-trips");
}

static void test_two_switches_independent() {
    reset_state();
    daisy::Switch3 a, b;
    a.Init(pin(5));
    b.Init(pin(6));

    daisy_emu::g_state.toggle_states[5].store(2);
    a.Debounce();
    b.Debounce();
    CHECK(a.Read() == 2, "switch A on pin 5 reads 2");
    CHECK(b.Read() == 0, "switch B on pin 6 unaffected");
}

static void test_uninitialized_is_safe() {
    reset_state();
    daisy::Switch3 sw;  // never Init'd (pin_ = -1)
    sw.Debounce();
    CHECK(sw.Read() == 0, "uninitialized switch reads 0, no crash");
}

int main() {
    std::printf("=== Switch3 shim unit tests (M44, FR-DEV-7) ===\n");
    test_default_position_is_zero();
    test_position_round_trip();
    test_two_switches_independent();
    test_uninitialized_is_safe();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
