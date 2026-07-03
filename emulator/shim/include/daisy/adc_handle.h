#pragma once
#include <cstdint>
#include "gpio.h"

namespace daisy {

// Mirrors libDaisy AdcChannelConfig / AdcHandle used by Knob, Osc, inout.
// Implementations live in emulator/shim/src/ (C5, M1).

class AdcChannelConfig {
public:
    // Configure a single-ended ADC channel on the given pin.
    void InitSingle(dsy_gpio_pin pin);

    dsy_gpio_pin pin_{};
};

class AdcHandle {
public:
    // Initialise the ADC with an array of channel configs (pointer form) —
    // matches real libDaisy's AdcHandle::Init signature exactly (FR-CODEGEN-1).
    // The emulator ignores cfg/num_channels; pot values are driven by IPC
    // messages, but the call shape must still compile against real hardware.
    void Init(AdcChannelConfig* cfg, uint8_t num_channels);

    // Begin continuous conversion.
    void Start();

    // Return the normalised (0..1) value of a configured channel.
    // Backed by the atomic pot-state array written by the IPC thread (C4 / §4).
    float GetFloat(uint8_t channel);
};

} // namespace daisy
