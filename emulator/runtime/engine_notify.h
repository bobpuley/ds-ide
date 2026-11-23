#pragma once
// FR-RTS-8: wake-ups of the audio engine are never lost.
//
// The engine thread waits on mode_cv (mode / config_generation / shutdown) and
// callback_cv (callback_set / shutdown). A writer that changes a predicate's
// input without holding the condition variable's mutex can land between the
// waiter's predicate check and its wait, and its notify is then lost. Every
// change goes through these helpers instead: the change is made (or, for an
// atomic flag set elsewhere, followed by a lock/unlock) under the mutex, and
// the notify comes after.

#include "emulator_state.h"

#include <chrono>
#include <mutex>
#include <thread>

namespace daisy_emu {

// Applies `mutate` under mode_mutex, then wakes the mode loop.
template <typename Mutate>
void notify_engine(Mutate&& mutate) {
    {
        std::lock_guard<std::mutex> lk(g_state.mode_mutex);
        mutate();
    }
    g_state.mode_cv.notify_all();
}

// Wakes both waits after a change made without their mutexes (e.g. the
// shutdown flag stored by a signal handler, which cannot lock).
inline void wake_engine() {
    { std::lock_guard<std::mutex> lk(g_state.mode_mutex); }
    g_state.mode_cv.notify_all();
    { std::lock_guard<std::mutex> lk(g_state.callback_mutex); }
    g_state.callback_cv.notify_all();
}

// The IPC `shutdown` message.
inline void request_engine_shutdown() {
    notify_engine([] { g_state.shutdown.store(true); });
    wake_engine();
}

// Shutdown watcher: keeps waking the engine until run_audio_engine() has
// returned, so even a wake-up lost to an unlucky interleaving is repeated.
inline void wake_engine_until_exited() {
    while (!g_state.engine_exited.load()) {
        wake_engine();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
}

}  // namespace daisy_emu
