#include "daisy/encoder.h"
#include "emulator_state.h"
#include <cstdint>

namespace daisy {

namespace {
// Shortest-path delta from `previous` to `current` (both already wrapped
// into [0, modulus)), correctly handling the wraparound boundary — mirrors
// src/devices/codegen/encoder.ts's encoderDelta() exactly (both sides must
// agree, since a wire message only ever carries the accumulated position).
int32_t wrapped_delta(int32_t previous, int32_t current, int32_t modulus) {
    int32_t raw = current - previous;
    if (raw > modulus / 2) raw -= modulus;
    else if (raw < -modulus / 2) raw += modulus;
    return raw;
}
}  // namespace

void Encoder::Init(dsy_gpio_pin a, dsy_gpio_pin b, dsy_gpio_pin click) {
    (void)b;  // quadrature not separately modeled — position arrives pre-resolved over IPC
    a_pin_          = canonical_gpio_index(a);  // AC-48: port*32+pin to avoid aliasing
    click_pin_      = canonical_gpio_index(click);
    prev_position_  = 0;
    increment_      = 0;
    click_pressed_  = false;
    click_prev_     = false;
    click_rising_edge_  = false;
    click_falling_edge_ = false;
}

void Encoder::Debounce() {
    int32_t current = 0;
    if (a_pin_ >= 0 && a_pin_ < daisy_emu::EmulatorState::kNumGpioPins) {
        current = daisy_emu::g_state.encoder_positions[a_pin_].load();
    }
    increment_     = wrapped_delta(prev_position_, current, daisy_emu::EmulatorState::kEncoderPositionModulus);
    prev_position_ = current;

    bool raw = false;
    if (click_pin_ >= 0 && click_pin_ < daisy_emu::EmulatorState::kNumGpioPins) {
        raw = daisy_emu::g_state.button_states[click_pin_].load();
    }
    // Edge flags are valid only until the next Debounce() call (matches Switch's contract).
    click_rising_edge_  = raw && !click_prev_;
    click_falling_edge_ = !raw && click_prev_;
    click_pressed_      = raw;
    click_prev_         = raw;
}

}  // namespace daisy
