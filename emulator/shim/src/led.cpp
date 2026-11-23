#include "daisy/led.h"
#include "emulator_state.h"

namespace daisy {

void emit_led_change(int pin, bool lit) {
    if (pin < 0 || pin >= daisy_emu::EmulatorState::kNumGpioPins) return;

    // FR-EMU-13: LED output is state — store the latest level; the drain
    // thread samples it and sends a `led` message only when it changed
    // (LedSampler, led_telemetry.h). Safe from the effect loop and the audio
    // callback at once: one atomic store, no queue, no allocation.
    daisy_emu::g_state.led_state[pin].store(lit ? 1 : 0, std::memory_order_relaxed);
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
