// Unit test for the Encoder shim (M44, FR-DEV-9).
//
// Exercises accumulated-position-to-delta derivation across Debounce() call
// boundaries, including wraparound, plus click rising/falling edges (which
// reuse the virtual button state directly). No IPC or audio thread. Plain
// asserts; exit 0 on success. Provides its own g_state definition (normally
// in main.cpp).

#include "daisy/encoder.h"
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
    for (auto& p : daisy_emu::g_state.encoder_positions) p.store(0);
    for (auto& b : daisy_emu::g_state.button_states) b.store(false);
}

static void test_default_increment_is_zero() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    enc.Debounce();
    CHECK(enc.Increment() == 0, "default increment is 0");
}

static void test_simple_forward_and_backward_delta() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    enc.Debounce();  // establish baseline (position 0)

    daisy_emu::g_state.encoder_positions[5].store(3);
    enc.Debounce();
    CHECK(enc.Increment() == 3, "forward delta of 3 detents");

    daisy_emu::g_state.encoder_positions[5].store(1);
    enc.Debounce();
    CHECK(enc.Increment() == -2, "backward delta of -2 detents");
}

static void test_zero_delta_across_unchanged_boundary() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    daisy_emu::g_state.encoder_positions[5].store(7);
    enc.Debounce();
    enc.Debounce();  // no change
    CHECK(enc.Increment() == 0, "unchanged position yields zero delta on the next callback");
}

static void test_forward_wraparound() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    daisy_emu::g_state.encoder_positions[5].store(1023);  // kEncoderPositionModulus - 1
    enc.Debounce();

    daisy_emu::g_state.encoder_positions[5].store(0);
    enc.Debounce();
    CHECK(enc.Increment() == 1, "1023 -> 0 is a forward delta of +1, not -1023");
}

static void test_backward_wraparound() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    daisy_emu::g_state.encoder_positions[5].store(0);
    enc.Debounce();

    daisy_emu::g_state.encoder_positions[5].store(1023);
    enc.Debounce();
    CHECK(enc.Increment() == -1, "0 -> 1023 is a backward delta of -1, not +1023");
}

static void test_click_edges_reuse_button_state() {
    reset_state();
    daisy::Encoder enc;
    enc.Init(pin(5), pin(6), pin(7));
    enc.Debounce();
    CHECK(!enc.Pressed(), "released: Pressed() false");
    CHECK(!enc.RisingEdge(), "released: no RisingEdge");

    daisy_emu::g_state.button_states[7].store(true);
    enc.Debounce();
    CHECK(enc.Pressed(), "click: Pressed() true");
    CHECK(enc.RisingEdge(), "click: RisingEdge() true on first sample");
    CHECK(!enc.FallingEdge(), "click: no FallingEdge");

    daisy_emu::g_state.button_states[7].store(false);
    enc.Debounce();
    CHECK(!enc.Pressed(), "release: Pressed() false");
    CHECK(enc.FallingEdge(), "release: FallingEdge() true");
}

static void test_two_encoders_independent() {
    reset_state();
    daisy::Encoder a, b;
    a.Init(pin(5), pin(6), pin(7));
    b.Init(pin(10), pin(11), pin(12));
    a.Debounce();
    b.Debounce();

    daisy_emu::g_state.encoder_positions[5].store(4);
    a.Debounce();
    b.Debounce();
    CHECK(a.Increment() == 4, "encoder A on pin 5 sees its own delta");
    CHECK(b.Increment() == 0, "encoder B on pin 10 unaffected");
}

static void test_uninitialized_is_safe() {
    reset_state();
    daisy::Encoder enc;  // never Init'd (pins = -1)
    enc.Debounce();
    CHECK(enc.Increment() == 0, "uninitialized encoder reads zero delta, no crash");
    CHECK(!enc.Pressed(), "uninitialized encoder reads released, no crash");
}

int main() {
    std::printf("=== Encoder shim unit tests (M44, FR-DEV-9) ===\n");
    test_default_increment_is_zero();
    test_simple_forward_and_backward_delta();
    test_zero_delta_across_unchanged_boundary();
    test_forward_wraparound();
    test_backward_wraparound();
    test_click_edges_reuse_button_state();
    test_two_encoders_independent();
    test_uninitialized_is_safe();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
