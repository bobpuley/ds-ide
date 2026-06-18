#pragma once
#include "gpio.h"

namespace daisy {

// Host Switch/button shim (M10, FR-CT-9/10). Backed by the virtual button state
// array in EmulatorState, written over IPC and sampled here at each Debounce()
// call — mirroring the v1 ADC shim pattern. Edge detection is relative to the
// previous Debounce() call, exactly the hardware contract (04 §4), so the
// effect's own call rate governs timing (no debounce thread; resolves R14).
class Switch {
public:
    // Records the Daisy pin number (pin.pin). update_rate is accepted for
    // source compatibility but unused — the effect's call cadence sets timing.
    void Init(dsy_gpio_pin pin, float update_rate = 1000.f);

    // Sample the virtual button state and recompute pressed/edge flags.
    void Debounce();

    bool Pressed()     const { return pressed_; }
    bool RisingEdge()  const { return rising_edge_; }
    bool FallingEdge() const { return falling_edge_; }

private:
    int  pin_{-1};
    bool pressed_{false};
    bool prev_{false};
    bool rising_edge_{false};
    bool falling_edge_{false};
};

} // namespace daisy
