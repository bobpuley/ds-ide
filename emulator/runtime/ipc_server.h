#pragma once
#include <string>

namespace daisy_emu {
// Bind a UNIX domain socket at socket_path, print
// "DAISY_EMU_SOCKET:<path>" to stdout when ready, then accept and serve
// one client at a time until g_state.shutdown is set.
void run_ipc_server(const char* socket_path);

// Exposed (non-static) for unit testing (FR-EMU-6) — otherwise only used
// internally by ipc_server.cpp's message dispatch.
//
// Extracts the value for `key` from a flat JSON object (or a "" if absent),
// walking the top-level structure — including string values' escapes — so a
// key literal appearing inside an unrelated field's *value* can never be
// mistaken for a real key.
std::string json_get(const std::string& json, const std::string& key);

// Escapes a string for embedding inside a JSON string literal (quotes,
// backslashes, and control characters).
std::string json_escape(const std::string& s);

// Exposed (non-static) for unit testing (FR-QA-EMU-5) — otherwise only
// called internally, once per received line, by run_ipc_server()'s client
// loop. Parses one JSON line and applies its effect to g_state.
void dispatch(const std::string& line);
}  // namespace daisy_emu
