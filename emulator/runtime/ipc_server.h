#pragma once
#include <memory>
#include <string>

namespace daisy_emu {

// FR-DEV-6: exchanged with the extension as the first message on every new
// connection (see run_ipc_server()). Bump whenever the wire protocol changes
// incompatibly — keep in sync with src/ipc/protocol-version.ts's
// PROTOCOL_VERSION on the extension side.
constexpr int kProtocolVersion = 1;

class IpcListener;

// Print "DAISY_EMU_SOCKET:<listener->address()>" to stdout (a socket path or
// "127.0.0.1:<port>", FR-WIN-IPC-1), then accept and serve one client at a
// time until g_state.shutdown is set. Takes ownership and destroys the
// listener before returning (closing it and removing a Unix socket file):
// the process ends with std::_Exit, so no destructor would run later.
//
// FR-WIN-IPC-2: on the TCP transport each client must first send
// {"type":"hello","token":"<session_token>"}; anything else — or nothing
// within kHelloTimeoutMs — closes the connection before a single byte is
// sent back. The Unix-socket transport ignores the token (filesystem
// permissions protect it).
constexpr int kHelloTimeoutMs = 2000;
void run_ipc_server(std::unique_ptr<IpcListener> listener, std::string session_token);

// Exposed (non-static) for unit testing (FR-WIN-IPC-2). True only for a
// hello message whose token equals `expected` (compared in constant time);
// an empty `expected` never matches.
bool check_session_hello(const std::string& line, const std::string& expected);

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

// Exposed (non-static) for unit testing (FR-DEV-1) — otherwise only used
// internally by dispatch()'s controlValue/controlSnapshot handlers.
//
// Decodes a controlValue/controlSnapshot id (e.g. "pot3", "btn17") into a
// device kind ('P' pot, 'B' button) plus its numeric index. Returns false
// for an unrecognized prefix, non-numeric suffix, or an index outside that
// kind's valid range.
bool decode_control_id(const std::string& id, char& kind, int& index);

// Exposed (non-static) for unit testing (FR-QA-EMU-5) — otherwise only
// called internally, once per received line, by run_ipc_server()'s client
// loop. Parses one JSON line and applies its effect to g_state.
void dispatch(const std::string& line);
}  // namespace daisy_emu
