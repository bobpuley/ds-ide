#pragma once
#include "gpio.h"

namespace daisy {

// Switch/button stub — not emulated in v1 (FR-SH-5, CR-4).
// Keeps button-referencing code compilable.
class Switch {
public:
    void Init(dsy_gpio_pin /*pin*/, float /*update_rate*/ = 1.f) {}
    void Debounce() {}
    bool RisingEdge()  const { return false; }
    bool FallingEdge() const { return false; }
    bool Pressed()     const { return false; }
};

} // namespace daisy
