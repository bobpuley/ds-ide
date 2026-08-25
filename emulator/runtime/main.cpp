#include "audio_engine.h"
#include "emulator_state.h"
#include "ipc_server.h"
#include <chrono>
#include <cstdlib>
#include <csignal>
#include <mutex>
#include <thread>

// The effect's main() is compiled with -Dmain=effect_main, renaming it here.
int effect_main();

// Global emulator state definition (declared extern in emulator_state.h).
namespace daisy_emu {
EmulatorState g_state;
}

namespace {

// FR-EMU-8: async-signal-safe — only an atomic store, no I/O or locking.
// effect_main()'s while(1) loop (user/generated Daisy code) is not expected
// to ever return, so this signal is the only reliable point a normal IDE
// stop (SIGTERM, escalating to SIGKILL after a grace period — see
// EmulatorManager.killStalePid) has to trigger a clean shutdown.
extern "C" void handle_shutdown_signal(int /*sig*/) {
    daisy_emu::g_state.shutdown.store(true, std::memory_order_relaxed);
}

}  // namespace

int main(int argc, char* argv[]) {
    // Ignore SIGPIPE so writes to a disconnected socket return EPIPE, not crash.
    std::signal(SIGPIPE, SIG_IGN);
    std::signal(SIGTERM, handle_shutdown_signal);
    std::signal(SIGINT, handle_shutdown_signal);

    const char* socket_path = (argc > 1) ? argv[1] : "/tmp/daisy_emu.sock";

    // IPC server runs in its own thread: binds socket, serves JSON messages.
    std::thread ipc_thread([socket_path] {
        daisy_emu::run_ipc_server(socket_path);
    });

    // Audio engine runs in its own thread: waits for StartAudio(), then loops.
    std::thread audio_thread([] {
        daisy_emu::run_audio_engine();
    });

    // FR-EMU-8/FR-EMU-11: effect_main() (below) blocks in the effect's
    // while(1) loop and is not expected to return under a signal-driven
    // shutdown, so it alone can never finalize an in-progress recording or
    // join the worker threads. This thread polls for g_state.shutdown (set
    // by the signal handler above, or by effect_main() returning on its own)
    // off the signal handler entirely — stop() does file I/O and thread
    // joins, neither of which is safe to call directly from a signal
    // handler — and is the single authoritative process-termination path in
    // both cases (FR-EMU-11): previously this thread raced main()'s own
    // post-effect_main() cleanup via std::_Exit(0), which nearly always won
    // and skipped both the join()s below and mode_cv/callback_cv's missing
    // wakeups, discarding whatever ipc_queue/oled_queue/midi_queue telemetry
    // the drain thread hadn't flushed yet — on every shutdown, not just the
    // signal-driven one.
    //
    // notify_all() on mode_cv/callback_cv wakes audio_thread if it's parked
    // in run_audio_engine()'s initial "wait for StartAudio()" or
    // run_simulated()/run_realtime()'s mode-change wait — both predicates
    // already check g_state.shutdown, but nothing was notifying them, so
    // audio_thread could otherwise block indefinitely past a shutdown
    // request and this join() would hang forever. run_ipc_server() (joined
    // via ipc_thread) already polls g_state.shutdown itself (~100 ms) and
    // needs no wakeup. std::exit() (not std::_Exit()) is used so the process
    // actually terminates instead of returning here — this thread is
    // detached, and in the (common) signal-driven case main()'s own thread
    // never reaches its `return 0` below.
    std::thread shutdown_watcher([&ipc_thread, &audio_thread] {
        while (!daisy_emu::g_state.shutdown.load(std::memory_order_relaxed)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        daisy_emu::g_state.mode_cv.notify_all();
        daisy_emu::g_state.callback_cv.notify_all();
        {
            std::lock_guard<std::mutex> lk(daisy_emu::g_state.recorder_mutex);
            daisy_emu::g_state.recorder.stop();
        }
        // Joining audio_thread here (rather than detaching this thread) is
        // what lets the drain thread's shutdown-flush logic
        // (audio_engine.cpp) actually run and complete before the process
        // exits (FR-EMU-11) — a clean shutdown now flushes
        // ipc_queue/oled_queue/led_queue/midi_tx_queue/midi_rx_queue instead
        // of discarding whatever hadn't been sent yet.
        //
        // audio_thread MUST be joined (i.e. telemetry flushed) BEFORE
        // telemetry_drained is set: run_ipc_server()'s per-client read loop
        // (ipc_server.cpp) waits on that flag before closing the socket /
        // nulling send_ipc, specifically so it can't race ahead of and cut
        // off this flush — it otherwise reacted to `shutdown` alone on its
        // own ~50ms select() timeline, independent of (and often faster
        // than) this thread's wake-notify-join sequence, closing the
        // client's connection before the flush below ever reached it.
        audio_thread.join();
        daisy_emu::g_state.telemetry_drained.store(true);
        ipc_thread.join();
        std::exit(0);
    });
    shutdown_watcher.detach();

    // Run the effect (blocks in its while(1){} loop until process is killed).
    effect_main();

    // Reached only if the effect's loop exits on its own (e.g. via
    // System::Delay + shutdown flag) rather than via the signal path above.
    // FR-EMU-11: don't duplicate shutdown_watcher's cleanup sequence here —
    // just request it and let shutdown_watcher (still running) perform it,
    // so there is exactly one code path that joins the worker threads and
    // terminates the process.
    daisy_emu::g_state.shutdown.store(true);
    for (;;) std::this_thread::sleep_for(std::chrono::seconds(1));
}
