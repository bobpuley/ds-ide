#include "audio_engine.h"
#include "emulator_state.h"
#include "ipc_server.h"
#include <csignal>
#include <thread>

// The effect's main() is compiled with -Dmain=effect_main, renaming it here.
int effect_main();

// Global emulator state definition (declared extern in emulator_state.h).
namespace daisy_emu {
EmulatorState g_state;
}

int main(int argc, char* argv[]) {
    // Ignore SIGPIPE so writes to a disconnected socket return EPIPE, not crash.
    std::signal(SIGPIPE, SIG_IGN);

    const char* socket_path = (argc > 1) ? argv[1] : "/tmp/daisy_emu.sock";

    // IPC server runs in its own thread: binds socket, serves JSON messages.
    std::thread ipc_thread([socket_path] {
        daisy_emu::run_ipc_server(socket_path);
    });

    // Audio engine runs in its own thread: waits for StartAudio(), then loops.
    std::thread audio_thread([] {
        daisy_emu::run_audio_engine();
    });

    // Run the effect (blocks in its while(1){} loop until process is killed).
    effect_main();

    // Reached only if the effect's loop exits (e.g. via System::Delay + shutdown flag).
    daisy_emu::g_state.shutdown.store(true);
    ipc_thread.join();
    audio_thread.join();
    return 0;
}
