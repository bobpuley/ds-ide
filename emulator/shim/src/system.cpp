#include "daisy/system.h"
#include "emulator_state.h"
#include <chrono>
#include <thread>

namespace daisy {

void System::Delay(uint32_t ms) {
    // Check shutdown flag each ms so effects with busy loops can exit cleanly.
    for (uint32_t i = 0; i < ms; ++i) {
        if (daisy_emu::g_state.shutdown.load()) return;
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
}

}  // namespace daisy
