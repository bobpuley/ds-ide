#pragma once
#include "gpio.h"

namespace daisy {

// LED stub — not emulated in v1 (FR-SH-5).
// Provided so code referencing Led compiles and links without changes.
class Led {
public:
    void Init(dsy_gpio_pin /*pin*/, bool /*invert*/) {}
    void Set(float /*brightness*/) {}
    void Update() {}
};

} // namespace daisy
