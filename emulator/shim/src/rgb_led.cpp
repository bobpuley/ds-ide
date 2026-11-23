#include "daisy/rgb_led.h"
#include "emulator_state.h"
#include "led_telemetry.h"

namespace daisy {

void emit_rgb_led_change(int pin, float r, float g, float b) {
    if (pin < 0 || pin >= daisy_emu::EmulatorState::kNumGpioPins) return;

    // FR-EMU-13: the colour is state — one packed atomic store, so the drain
    // thread (LedSampler) never sees channels from two different writes and
    // only sends `rgbLed` when the colour changed.
    daisy_emu::g_state.rgb_state[pin].store(daisy_emu::pack_rgb(r, g, b), std::memory_order_relaxed);
}

void RgbLed::Init(dsy_gpio_pin r, dsy_gpio_pin g, dsy_gpio_pin b, bool invert) {
    r_pin_  = canonical_gpio_index(r);  // AC-48: port*32+pin to avoid aliasing
    g_pin_  = canonical_gpio_index(g);
    b_pin_  = canonical_gpio_index(b);
    invert_ = invert;
    r_ = g_ = b_ = 0.f;
}

void RgbLed::Set(float r, float g, float b) {
    r_ = r;
    g_ = g;
    b_ = b;
}

void RgbLed::SetRed(float r)   { r_ = r; }
void RgbLed::SetGreen(float g) { g_ = g; }
void RgbLed::SetBlue(float b)  { b_ = b; }

void RgbLed::Update() {
    emit_rgb_led_change(r_pin_, r_, g_, b_);
}

}  // namespace daisy
