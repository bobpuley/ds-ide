#include "daisy/led.h"
#include "emulator_state.h"
#include <cstdio>

namespace daisy {

void emit_led_change(int pin, bool lit) {
    if (pin < 0 || pin >= daisy_emu::EmulatorState::kNumGpioPins) return;

    // Suppress unchanged writes (effects often call SetLed every loop iteration).
    int8_t want = lit ? 1 : 0;
    int8_t prev = daisy_emu::g_state.led_last_state[pin].exchange(want);
    if (prev == want) return;

    char buf[96];
    std::snprintf(buf, sizeof(buf),
                  "{\"type\":\"led\",\"gpioPin\":%d,\"lit\":%s}",
                  pin, lit ? "true" : "false");

    daisy_emu::g_state.ipc_queue.push(buf);
}

void Led::Init(dsy_gpio_pin pin, bool invert) {
    pin_        = canonical_gpio_index(pin);  // AC-48: port*32+pin to avoid aliasing
    invert_     = invert;
    brightness_ = 0.f;
}

void Led::Set(float brightness) {
    brightness_ = brightness;
}

void Led::Update() {
    bool lit = (brightness_ > 0.f) != invert_;  // XOR invert
    emit_led_change(pin_, lit);
}

}  // namespace daisy
