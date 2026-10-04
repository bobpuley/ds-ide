// Socket I/O shared by both IPC transports (FR-WIN-IPC-1). The only
// platform split in the transport layer besides listener creation.
#include "ipc_transport.h"

#include <utility>

#ifdef _WIN32
#include <winsock2.h>
#include <climits>
#include <ws2tcpip.h>
#else
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace daisy_emu {

namespace {

#ifdef _WIN32
using sock_t = SOCKET;
constexpr int kSendFlags = 0;
void close_socket(sock_t s) { ::closesocket(s); }
int clamp_len(std::size_t n) { return n > static_cast<std::size_t>(INT_MAX) ? INT_MAX : static_cast<int>(n); }
#else
using sock_t = int;
#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;  // Linux; macOS uses SO_NOSIGPIPE
#else
constexpr int kSendFlags = 0;
#endif
void close_socket(sock_t s) { ::close(s); }
std::size_t clamp_len(std::size_t n) { return n; }
#endif

sock_t to_sock(std::intptr_t h) { return static_cast<sock_t>(h); }

void set_no_sigpipe(sock_t s) {
#ifdef SO_NOSIGPIPE
    int opt = 1;
    ::setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &opt, sizeof(opt));
#else
    (void)s;
#endif
}

int wait_readable(sock_t s, int timeout_ms) {
    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(s, &rfds);
    timeval tv{};
    tv.tv_sec = timeout_ms / 1000;
    tv.tv_usec = (timeout_ms % 1000) * 1000;
    // nfds is ignored by Winsock.
    const int r = ::select(static_cast<int>(s) + 1, &rfds, nullptr, nullptr, &tv);
    return r > 0 ? 1 : (r == 0 ? 0 : -1);
}

}  // namespace

// ---- IpcConnection ------------------------------------------------------------

IpcConnection::~IpcConnection() {
    close_socket(to_sock(handle_));
}

int IpcConnection::waitReadable(int timeout_ms) {
    return wait_readable(to_sock(handle_), timeout_ms);
}

long long IpcConnection::send(const char* data, std::size_t n) {
    return ::send(to_sock(handle_), data, clamp_len(n), kSendFlags);
}

long long IpcConnection::recv(char* buf, std::size_t n) {
    return ::recv(to_sock(handle_), buf, clamp_len(n), 0);
}

// ---- IpcListener --------------------------------------------------------------

IpcListener::IpcListener(Kind kind, std::intptr_t handle, std::string address)
    : kind_(kind), handle_(handle), address_(std::move(address)) {
    set_no_sigpipe(to_sock(handle_));
}

IpcListener::~IpcListener() {
    close_socket(to_sock(handle_));
#ifndef _WIN32
    if (kind_ == Kind::Unix) ::unlink(address_.c_str());
#endif
}

int IpcListener::waitAcceptable(int timeout_ms) {
    return wait_readable(to_sock(handle_), timeout_ms);
}

std::unique_ptr<IpcConnection> IpcListener::accept() {
    const sock_t c = ::accept(to_sock(handle_), nullptr, nullptr);
#ifdef _WIN32
    if (c == INVALID_SOCKET) return nullptr;
#else
    if (c < 0) return nullptr;
#endif
    set_no_sigpipe(c);
    if (kind_ == Kind::Tcp) {
        // Small JSON lines in both directions: don't let Nagle batch them.
        int one = 1;
        ::setsockopt(c, IPPROTO_TCP, TCP_NODELAY, reinterpret_cast<const char*>(&one), sizeof(one));
    }
    return std::make_unique<IpcConnection>(static_cast<std::intptr_t>(c));
}

}  // namespace daisy_emu
