#pragma once
#include <cstdint>

// Minimal GPIO pin representation matching libDaisy's dsy_gpio_pin.
// Port 0 holds digital pins D0–D30 (and analog-capable A0–A5 which alias D15–D20).
// Port 1 holds analog-only pins A6–A11. The canonical_gpio_index() function below
// maps {port, pin} to a unique slot so that A6–A11 (port=1) do not alias D0–D5
// (port=0) in the emulator's button_states / led_last_state arrays (AC-48).

struct dsy_gpio_pin {
    uint8_t port;
    uint8_t pin;

    bool operator==(const dsy_gpio_pin& o) const {
        return port == o.port && pin == o.pin;
    }
};

// Map a dsy_gpio_pin to a unique index for use with the emulator's state arrays.
// Port 0 → indices 0–30; port 1 → indices 32–37 (A6–A11).
// Arrays must be sized to kNumGpioPins = 64.
static inline int canonical_gpio_index(dsy_gpio_pin p) {
    return static_cast<int>(p.port) * 32 + static_cast<int>(p.pin);
}

namespace daisy {
namespace seed {
    // Daisy Seed analogue input pin constants (ADC0-ADC11 / A0-A11).
    // Numeric values match libDaisy seed.h so code using seed::A0 etc. compiles
    // unchanged.
    static constexpr dsy_gpio_pin A0  = {0, 15};
    static constexpr dsy_gpio_pin A1  = {0, 16};
    static constexpr dsy_gpio_pin A2  = {0, 17};
    static constexpr dsy_gpio_pin A3  = {0, 18};
    static constexpr dsy_gpio_pin A4  = {0, 19};
    static constexpr dsy_gpio_pin A5  = {0, 20};
    static constexpr dsy_gpio_pin A6  = {1,  0};
    static constexpr dsy_gpio_pin A7  = {1,  1};
    static constexpr dsy_gpio_pin A8  = {1,  2};
    static constexpr dsy_gpio_pin A9  = {1,  3};
    static constexpr dsy_gpio_pin A10 = {1,  4};
    static constexpr dsy_gpio_pin A11 = {1,  5};

    // Digital pin constants D0-D30. port=0, pin=n mirrors libDaisy seed.h.
    // The emulator uses canonical_gpio_index(pin) as the GPIO/Switch channel index.
    static constexpr dsy_gpio_pin D0  = {0,  0};
    static constexpr dsy_gpio_pin D1  = {0,  1};
    static constexpr dsy_gpio_pin D2  = {0,  2};
    static constexpr dsy_gpio_pin D3  = {0,  3};
    static constexpr dsy_gpio_pin D4  = {0,  4};
    static constexpr dsy_gpio_pin D5  = {0,  5};
    static constexpr dsy_gpio_pin D6  = {0,  6};
    static constexpr dsy_gpio_pin D7  = {0,  7};
    static constexpr dsy_gpio_pin D8  = {0,  8};
    static constexpr dsy_gpio_pin D9  = {0,  9};
    static constexpr dsy_gpio_pin D10 = {0, 10};
    static constexpr dsy_gpio_pin D11 = {0, 11};
    static constexpr dsy_gpio_pin D12 = {0, 12};
    static constexpr dsy_gpio_pin D13 = {0, 13};
    static constexpr dsy_gpio_pin D14 = {0, 14};
    static constexpr dsy_gpio_pin D15 = {0, 15};
    static constexpr dsy_gpio_pin D16 = {0, 16};
    static constexpr dsy_gpio_pin D17 = {0, 17};
    static constexpr dsy_gpio_pin D18 = {0, 18};
    static constexpr dsy_gpio_pin D19 = {0, 19};
    static constexpr dsy_gpio_pin D20 = {0, 20};
    static constexpr dsy_gpio_pin D21 = {0, 21};
    static constexpr dsy_gpio_pin D22 = {0, 22};
    static constexpr dsy_gpio_pin D23 = {0, 23};
    static constexpr dsy_gpio_pin D24 = {0, 24};
    static constexpr dsy_gpio_pin D25 = {0, 25};
    static constexpr dsy_gpio_pin D26 = {0, 26};
    static constexpr dsy_gpio_pin D27 = {0, 27};
    static constexpr dsy_gpio_pin D28 = {0, 28};
    static constexpr dsy_gpio_pin D29 = {0, 29};
    static constexpr dsy_gpio_pin D30 = {0, 30};
} // namespace seed
} // namespace daisy
