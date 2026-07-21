#include "daisy/switch3.h"
#include "emulator_state.h"

namespace daisy {

void Switch3::Init(dsy_gpio_pin pin) {
    pin_      = canonical_gpio_index(pin);  // AC-48: port*32+pin to avoid aliasing
    position_ = 0;
}

void Switch3::Debounce() {
    int raw = 0;
    if (pin_ >= 0 && pin_ < daisy_emu::EmulatorState::kNumGpioPins) {
        raw = daisy_emu::g_state.toggle_states[pin_].load();
    }
    position_ = raw;
}

}  // namespace daisy
