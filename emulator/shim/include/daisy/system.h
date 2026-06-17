#pragma once
#include <cstdint>

namespace daisy {

class System {
public:
    // Block for approximately ms milliseconds.
    // In the emulator this maps to the host nanosleep (FR-SH-4).
    static void Delay(uint32_t ms);
};

} // namespace daisy
