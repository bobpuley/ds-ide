#include "daisy/led.h"
#include "emulator_state.h"
#include <cstdio>
#include <mutex>

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

    std::lock_guard<std::mutex> lk(daisy_emu::g_state.send_mutex);
    if (daisy_emu::g_state.send_ipc) daisy_emu::g_state.send_ipc(buf);
}

void Led::Init(dsy_gpio_pin pin, bool invert) {
    pin_        = static_cast<int>(pin.pin);
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
