#pragma once
#include "gpio.h"
#include <cstdint>

namespace daisy {

// Host Encoder shim (M44, FR-DEV-9). Backed by the virtual accumulated
// position in EmulatorState (written over IPC as enc<pin> ids, keyed by the
// A-channel pin) and the existing virtual button state (the click pin reuses
// button_states directly — a click is just a momentary button at that pin,
// no separate state needed). Debounce() derives this callback's delta by
// diffing the just-read position against the value it read last time
// (mirrors Switch's prev_/rising_edge_ pattern) — quadrature (A/B) isn't
// separately modeled since the resolved position arrives pre-computed over
// IPC (the same simplification Switch3 makes for its single-pin position).
class Encoder {
public:
    void Init(dsy_gpio_pin a, dsy_gpio_pin b, dsy_gpio_pin click);

    void Debounce();

    int32_t Increment()   const { return increment_; }
    bool    Pressed()     const { return click_pressed_; }
    bool    RisingEdge()  const { return click_rising_edge_; }
    bool    FallingEdge() const { return click_falling_edge_; }

private:
    int     a_pin_{-1};
    int     click_pin_{-1};
    int32_t prev_position_{0};
    int32_t increment_{0};
    bool    click_pressed_{false};
    bool    click_prev_{false};
    bool    click_rising_edge_{false};
    bool    click_falling_edge_{false};
};

} // namespace daisy
