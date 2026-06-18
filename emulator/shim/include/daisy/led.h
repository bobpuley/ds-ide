#pragma once
#include "gpio.h"

namespace daisy {

// Emit a `led {gpioPin, lit}` IPC message when the pin's level changes
// (deduplicated in C5). Shared by Led::Update() and DaisySeed::SetLed().
// Implemented in shim/src/led.cpp.
void emit_led_change(int pin, bool lit);

// Host LED output shim (M10, FR-CT-14). libDaisy stages brightness on Set()
// and writes on Update(); the shim captures the lit state on Update() and
// emits an IPC `led` message for the declared pin (lit = brightness>0 XOR invert).
class Led {
public:
    void Init(dsy_gpio_pin pin, bool invert = false);
    void Set(float brightness);
    void Update();

private:
    int   pin_{-1};
    bool  invert_{false};
    float brightness_{0.f};
};

} // namespace daisy
