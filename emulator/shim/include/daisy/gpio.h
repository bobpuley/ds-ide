#pragma once
#include <cstdint>

// Minimal GPIO pin representation matching libDaisy's dsy_gpio_pin.
// The emulator ignores port/pin values — potentiometer state is driven via
// IPC (see architecture §7). Providing a real-looking type preserves
// source-level compatibility with bare-libDaisy projects.

struct dsy_gpio_pin {
    uint8_t port;
    uint8_t pin;

    bool operator==(const dsy_gpio_pin& o) const {
        return port == o.port && pin == o.pin;
    }
};

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
} // namespace seed
} // namespace daisy
