#include "daisy/switch.h"
#include "emulator_state.h"

namespace daisy {

void Switch::Init(dsy_gpio_pin pin, float /*update_rate*/) {
    pin_          = static_cast<int>(pin.pin);
    pressed_      = false;
    prev_         = false;
    rising_edge_  = false;
    falling_edge_ = false;
}

void Switch::Debounce() {
    bool raw = false;
    if (pin_ >= 0 && pin_ < daisy_emu::EmulatorState::kNumGpioPins) {
        raw = daisy_emu::g_state.button_states[pin_].load();
    }
    // Edge flags are valid only until the next Debounce() call (hardware contract).
    rising_edge_  = raw && !prev_;
    falling_edge_ = !raw && prev_;
    pressed_      = raw;
    prev_         = raw;
}

}  // namespace daisy
