#include "daisy/adc_handle.h"
#include "emulator_state.h"

namespace daisy {

void AdcChannelConfig::InitSingle(dsy_gpio_pin pin) {
    pin_ = pin;
}

void AdcHandle::Init(AdcChannelConfig* /*cfg*/, uint8_t /*num_channels*/) {
    // Pot values are driven by the IPC `pot`/`potSnapshot` messages.
}

void AdcHandle::Start() {
    // No-op: ADC "conversion" is always running (values come from IPC).
}

float AdcHandle::GetFloat(uint8_t channel) {
    if (channel >= 12) return 0.f;
    return daisy_emu::g_state.pot_values[channel].load();
}

}  // namespace daisy
