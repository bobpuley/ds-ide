#include "daisy/system.h"
#include "emulator_state.h"
#include <algorithm>
#include <chrono>
#include <thread>

namespace daisy {

void System::Delay(uint32_t ms) {
    // FR-QA-EMU-4: compute the deadline once up front and sleep to
    // min(deadline, now + 1ms) each pass, instead of a fixed 1ms-per-iteration
    // loop — a fixed loop's per-call scheduler overshoot compounds once per
    // iteration, so the total delay drifts further past the requested
    // duration the longer it runs. Sleeping to an absolute deadline bounds
    // the total by construction. Shutdown is still checked every pass so
    // effects with busy loops can exit cleanly.
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(ms);
    while (true) {
        if (daisy_emu::g_state.shutdown.load()) return;
        const auto now = std::chrono::steady_clock::now();
        if (now >= deadline) return;
        std::this_thread::sleep_for(std::min(deadline, now + std::chrono::milliseconds(1)) - now);
    }
}

}  // namespace daisy
