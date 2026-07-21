#pragma once
#include "gpio.h"

namespace daisy {

// Host Switch3 (toggle switch) shim (M44, FR-DEV-7). Backed by the virtual
// toggle-position state in EmulatorState, written over IPC (tgl<N> ids) and
// sampled here at each Debounce() call — mirrors the Switch shim's pattern
// but reports an integer position (0, 1, 2) rather than a boolean.
class Switch3 {
public:
    // Records the Daisy pin number (pin.pin). Single-pin attachment
    // (FR-DEV-7) — unlike real hardware's two-pin wiring, this shim's
    // multi-position value arrives pre-resolved over IPC.
    void Init(dsy_gpio_pin pin);

    // Sample the virtual toggle-position state.
    void Debounce();

    int32_t Read() const { return position_; }

private:
    int     pin_{-1};
    int32_t position_{0};
};

} // namespace daisy
