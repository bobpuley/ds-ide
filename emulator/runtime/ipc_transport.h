#pragma once
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

// IPC transport seam (FR-WIN-IPC-1): run_ipc_server() speaks the line
// protocol over an IpcConnection and never touches socket APIs itself.
// Two listeners exist — a Unix domain socket (POSIX; the macOS default,
// behaviour unchanged) and TCP loopback on 127.0.0.1 (the Windows default;
// also built on POSIX so it can be tested there). Socket handles are carried
// as intptr_t so the same type holds a POSIX fd or a Winsock SOCKET.
namespace daisy_emu {

class IpcConnection {
public:
    explicit IpcConnection(std::intptr_t handle) : handle_(handle) {}
    ~IpcConnection();
    IpcConnection(const IpcConnection&) = delete;
    IpcConnection& operator=(const IpcConnection&) = delete;

    // 1 = readable (data or EOF), 0 = timeout, -1 = error.
    int waitReadable(int timeout_ms);
    // Bytes transferred; 0 = peer closed (recv); negative = error. Never
    // raises SIGPIPE. May be short.
    long long send(const char* data, std::size_t n);
    long long recv(char* buf, std::size_t n);

    std::intptr_t nativeHandle() const { return handle_; }

private:
    std::intptr_t handle_;
};

class IpcListener {
public:
    enum class Kind { Unix, Tcp };

    IpcListener(Kind kind, std::intptr_t handle, std::string address);
    // Closes the socket; the Unix listener also removes its socket file.
    ~IpcListener();
    IpcListener(const IpcListener&) = delete;
    IpcListener& operator=(const IpcListener&) = delete;

    // The value announced as DAISY_EMU_SOCKET:<address> — a filesystem path
    // (Unix) or "127.0.0.1:<port>" (TCP).
    const std::string& address() const { return address_; }
    Kind kind() const { return kind_; }

    // 1 = a connection is pending, 0 = timeout, -1 = error.
    int waitAcceptable(int timeout_ms);
    // nullptr on failure. TCP connections get TCP_NODELAY.
    std::unique_ptr<IpcConnection> accept();

    std::intptr_t nativeHandle() const { return handle_; }

private:
    Kind kind_;
    std::intptr_t handle_;
    std::string address_;
};

#ifndef _WIN32
// Binds a Unix domain socket at `path` (replacing a stale file). nullptr +
// `err` on failure, including a path longer than sockaddr_un::sun_path.
std::unique_ptr<IpcListener> make_unix_listener(const char* path, std::string& err);
#endif

// Binds 127.0.0.1 on an ephemeral port (initialising Winsock on Windows).
// nullptr + `err` on failure.
std::unique_ptr<IpcListener> make_tcp_listener(std::string& err);

}  // namespace daisy_emu
