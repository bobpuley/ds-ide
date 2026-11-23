#pragma once
// FR-RTS-7: stop-and-acknowledge hand-off between the audio thread (the
// replay consumer, calling SessionPlayer::popBlock()) and the threads that
// change the player's lifecycle (IPC replayStart/replayStop, the engine when
// leaving simulated mode).
//
// The consumer publishes replay_in_use *before* re-checking replay_active;
// the stopper clears replay_active *before* checking replay_in_use. With
// seq_cst on all four operations at least one side sees the other: either the
// consumer sees the stop and backs out, or the stopper sees the consumer and
// waits for it to leave. Only then may close()/open() touch the player.

#include "emulator_state.h"

#include <thread>

namespace daisy_emu {

// Audio thread. True = replay is active and the consumer may call popBlock()
// until replay_consumer_exit(). RT-safe: atomics only.
inline bool replay_consumer_enter() {
    g_state.replay_in_use.store(true, std::memory_order_seq_cst);
    if (g_state.replay_active.load(std::memory_order_seq_cst)) return true;
    g_state.replay_in_use.store(false, std::memory_order_seq_cst);
    return false;
}

inline void replay_consumer_exit() {
    g_state.replay_in_use.store(false, std::memory_order_seq_cst);
}

// Non-RT threads only. Deactivates replay and returns once the consumer is
// guaranteed not to be inside popBlock(); the wait is at most one popBlock()
// call, which never blocks (FR-RTS-3).
inline void replay_stop_consumer() {
    g_state.replay_active.store(false, std::memory_order_seq_cst);
    while (g_state.replay_in_use.load(std::memory_order_seq_cst)) std::this_thread::yield();
}

}  // namespace daisy_emu
