#pragma once

namespace daisy_emu {
// Bind a UNIX domain socket at socket_path, print
// "DAISY_EMU_SOCKET:<path>" to stdout when ready, then accept and serve
// one client at a time until g_state.shutdown is set.
void run_ipc_server(const char* socket_path);
}  // namespace daisy_emu
