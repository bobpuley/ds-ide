#include "daisy/rgb_led.h"
#include "emulator_state.h"
#include <cstdio>

namespace daisy {

void emit_rgb_led_change(int pin, float r, float g, float b) {
    if (pin < 0 || pin >= daisy_emu::EmulatorState::kNumGpioPins) return;

    // Suppress unchanged writes (mirrors emit_led_change's dedup — an effect
    // often calls Update() every loop iteration regardless of whether the
    // color actually changed).
    float prev_r = daisy_emu::g_state.rgb_r_last[pin].exchange(r);
    float prev_g = daisy_emu::g_state.rgb_g_last[pin].exchange(g);
    float prev_b = daisy_emu::g_state.rgb_b_last[pin].exchange(b);
    if (prev_r == r && prev_g == g && prev_b == b) return;

    char buf[128];
    std::snprintf(buf, sizeof(buf),
                  "{\"type\":\"rgbLed\",\"gpioPin\":%d,\"r\":%.4f,\"g\":%.4f,\"b\":%.4f}",
                  pin, r, g, b);

    daisy_emu::g_state.led_queue.push(buf);
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
