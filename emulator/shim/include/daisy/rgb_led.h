#pragma once
#include "gpio.h"

namespace daisy {

// Emit an `rgbLed {gpioPin, r, g, b}` IPC message when any channel's value
// changes (deduplicated, mirroring led.h's emit_led_change). Keyed by the
// instance's primary (red-channel) pin — the extension host recovers the
// other two pins from the parsed code annotation, not from this message
// (M44, FR-DEV-8). Implemented in shim/src/rgb_led.cpp.
void emit_rgb_led_change(int pin, float r, float g, float b);

// Host RgbLed shim (M44, FR-DEV-8). Three output channels addressed as one
// named device — the first registry entry owning multiple pins. `invert`
// mirrors real libDaisy's constructor parameter for source compatibility
// (a common-anode RGB LED is driven inverted) but is not applied to the
// emitted display color: the Controls Editor renders the *intended*
// perceptual color the effect sets, not the inverted electrical signal.
class RgbLed {
public:
    void Init(dsy_gpio_pin r, dsy_gpio_pin g, dsy_gpio_pin b, bool invert = true);
    void Set(float r, float g, float b);
    void SetRed(float r);
    void SetGreen(float g);
    void SetBlue(float b);
    void Update();

private:
    int   r_pin_{-1};
    int   g_pin_{-1};
    int   b_pin_{-1};
    bool  invert_{true};
    float r_{0.f};
    float g_{0.f};
    float b_{0.f};
};

} // namespace daisy
