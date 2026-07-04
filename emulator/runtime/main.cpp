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

    // FR-EMU-8: effect_main() (below) blocks in the effect's while(1) loop
    // and is not expected to return under a signal-driven shutdown, so it
    // alone can never finalize an in-progress recording. This thread polls
    // for g_state.shutdown (set by the signal handler above, or by
    // effect_main() returning on its own) off the signal handler entirely —
    // stop() does file I/O and thread joins, neither of which is safe to
    // call directly from a signal handler — flushes/closes any active
    // recording with a proper END marker, then terminates the process, since
    // effect_main() may never return on its own to reach the normal `return
    // 0` path below.
    std::thread shutdown_watcher([] {
        while (!daisy_emu::g_state.shutdown.load(std::memory_order_relaxed)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        {
            std::lock_guard<std::mutex> lk(daisy_emu::g_state.recorder_mutex);
            daisy_emu::g_state.recorder.stop();
        }
        std::_Exit(0);
    });
    shutdown_watcher.detach();

    // Run the effect (blocks in its while(1){} loop until process is killed).
    effect_main();

    // Reached only if the effect's loop exits on its own (e.g. via
    // System::Delay + shutdown flag) rather than via the signal path above.
    daisy_emu::g_state.shutdown.store(true);
    {
        std::lock_guard<std::mutex> lk(daisy_emu::g_state.recorder_mutex);
        daisy_emu::g_state.recorder.stop();
    }
    ipc_thread.join();
    audio_thread.join();
    return 0;
}
