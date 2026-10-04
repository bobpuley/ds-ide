// TCP loopback listener (FR-WIN-IPC-1) — the Windows transport. Binds
// 127.0.0.1 only (never 0.0.0.0) on an OS-assigned port. Builds on POSIX too
// so the transport is testable on macOS.
#include "ipc_transport.h"

#include <cstring>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <cerrno>
#endif

namespace daisy_emu {

namespace {

#ifdef _WIN32
using sock_t = SOCKET;
const sock_t kInvalid = INVALID_SOCKET;
void close_socket(sock_t s) { ::closesocket(s); }
std::string last_error(const char* what) {
    return std::string(what) + ": WSA error " + std::to_string(::WSAGetLastError());
}

// WSAStartup once per process. Never cleaned up explicitly: the emulator
// ends with std::_Exit (main.cpp), and the OS releases Winsock on exit.
bool ensure_winsock(std::string& err) {
    static const int rc = [] {
        WSADATA data;
        return ::WSAStartup(MAKEWORD(2, 2), &data);
    }();
    if (rc != 0) err = "WSAStartup failed: " + std::to_string(rc);
    return rc == 0;
}
#else
using sock_t = int;
const sock_t kInvalid = -1;
void close_socket(sock_t s) { ::close(s); }
std::string last_error(const char* what) {
    return std::string(what) + ": " + std::strerror(errno);
}
bool ensure_winsock(std::string&) { return true; }
#endif

}  // namespace

std::unique_ptr<IpcListener> make_tcp_listener(std::string& err) {
    if (!ensure_winsock(err)) return nullptr;

    const sock_t s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == kInvalid) { err = last_error("socket"); return nullptr; }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;  // ephemeral

    if (::bind(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
        err = last_error("bind");
        close_socket(s);
        return nullptr;
    }
    if (::listen(s, 1) != 0) {
        err = last_error("listen");
        close_socket(s);
        return nullptr;
    }

    sockaddr_in bound{};
    socklen_t len = sizeof(bound);
    if (::getsockname(s, reinterpret_cast<sockaddr*>(&bound), &len) != 0) {
        err = last_error("getsockname");
        close_socket(s);
        return nullptr;
    }

    const std::string address = "127.0.0.1:" + std::to_string(ntohs(bound.sin_port));
    return std::make_unique<IpcListener>(IpcListener::Kind::Tcp, static_cast<std::intptr_t>(s), address);
}

}  // namespace daisy_emu
