#include "audio_engine.h"
#include "emulator_state.h"
#include "ipc_server.h"
#include "ipc_transport.h"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <csignal>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
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

// First stdin line, without its line ending; "" if stdin is closed/empty.
std::string read_session_token() {
    char buf[256];
    if (!std::fgets(buf, sizeof(buf), stdin)) return "";
    std::string token(buf);
    while (!token.empty() && (token.back() == '\n' || token.back() == '\r')) token.pop_back();
    return token;
}

}  // namespace

int main(int argc, char* argv[]) {
#ifndef _WIN32
    // Ignore SIGPIPE so writes to a disconnected socket return EPIPE, not crash.
    // Windows has no SIGPIPE: a send() on a closed socket returns an error.
    std::signal(SIGPIPE, SIG_IGN);
#endif
    // SIGTERM/SIGINT exist in the Windows CRT too (SIGINT on Ctrl+C); the
    // graceful cross-platform stop is the IPC shutdown message (FR-WIN-IPC-3).
    std::signal(SIGTERM, handle_shutdown_signal);
    std::signal(SIGINT, handle_shutdown_signal);

    // FR-WIN-IPC-1: `effect_emu <socket-path>` serves a Unix domain socket
    // (macOS, as before); `effect_emu --tcp` serves TCP loopback on an
    // ephemeral port. Windows has no Unix-socket transport and always uses TCP.
    const char* arg = (argc > 1) ? argv[1] : nullptr;
    std::string err;
    std::unique_ptr<daisy_emu::IpcListener> listener;
#ifdef _WIN32
    (void)arg;
    listener = daisy_emu::make_tcp_listener(err);
#else
    if (arg && std::strcmp(arg, "--tcp") == 0) {
        listener = daisy_emu::make_tcp_listener(err);
    } else {
        listener = daisy_emu::make_unix_listener(arg ? arg : "/tmp/daisy_emu.sock", err);
    }
#endif
    if (!listener) {
        std::fprintf(stderr, "[daisy-emu] IPC listener: %s\n", err.c_str());
        return 1;
    }

    // FR-WIN-IPC-2: on TCP any local process could connect, so the extension
    // passes a per-session token as the first line of stdin — never on the
    // command line, where other processes can read it.
    std::string session_token;
    if (listener->kind() == daisy_emu::IpcListener::Kind::Tcp) {
        session_token = read_session_token();
        if (session_token.empty()) {
            std::fprintf(stderr, "[daisy-emu] TCP transport requires a session token on stdin\n");
            return 1;
        }
    }

    // IPC server runs in its own thread and owns the listener from here on.
    std::thread ipc_thread([l = std::move(listener), t = std::move(session_token)]() mutable {
        daisy_emu::run_ipc_server(std::move(l), std::move(t));
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
    // needs no wakeup. The process is ended with std::_Exit() *after* the
    // joins and flush above — this thread is detached, and in the (common)
    // signal-driven case main()'s own thread never reaches its `return 0`
    // below. std::exit() must NOT be used here: it runs static destructors,
    // destroying g_state's mutexes and condition variables while the effect
    // thread (still inside effect_main()) and the CoreAudio callback thread
    // keep locking them, which aborts with "mutex lock failed: Invalid
    // argument" (seen when stopping the emulator from the Daisy view).
    // Everything that needs an orderly shutdown (recorder, worker threads,
    // telemetry) has already completed, so skipping the destructors loses
    // nothing; stdio is flushed explicitly because _Exit does not.
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
        std::fflush(nullptr);
        std::_Exit(0);
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
