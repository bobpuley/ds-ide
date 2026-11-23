// Unit test for the IPC transport layer (M78, FR-WIN-IPC-1).
//
// Runs the same checks against both transports on POSIX: the Unix domain
// socket (macOS default, behaviour unchanged) and TCP loopback (Windows
// default, also built on POSIX so it can be exercised here). The client side
// uses raw POSIX sockets. Plain asserts; exit 0 on success.

#include "ipc_transport.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <thread>

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

using daisy_emu::IpcConnection;
using daisy_emu::IpcListener;

static std::string g_sock_path;

static int connect_unix(const std::string& path) {
    int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    sockaddr_un a{};
    a.sun_family = AF_UNIX;
    std::strncpy(a.sun_path, path.c_str(), sizeof(a.sun_path) - 1);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof(a)) != 0) { ::close(fd); return -1; }
    return fd;
}

static int connect_tcp(const std::string& hostport) {
    const auto colon = hostport.rfind(':');
    const std::string host = hostport.substr(0, colon);
    const int port = std::atoi(hostport.c_str() + colon + 1);
    int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(static_cast<uint16_t>(port));
    ::inet_pton(AF_INET, host.c_str(), &a.sin_addr);
    if (::connect(fd, reinterpret_cast<sockaddr*>(&a), sizeof(a)) != 0) { ::close(fd); return -1; }
    return fd;
}

// Exercises a listener the same way run_ipc_server() does.
static void exercise(const char* label, IpcListener& listener, int (*connect_fn)(const std::string&)) {
    std::printf("--- %s ---\n", label);
    char msg[160];

    std::snprintf(msg, sizeof(msg), "%s: no pending connection → waitAcceptable times out", label);
    CHECK(listener.waitAcceptable(20) == 0, msg);

    const int client = connect_fn(listener.address());
    std::snprintf(msg, sizeof(msg), "%s: a client can connect to the announced address", label);
    CHECK(client >= 0, msg);
    if (client < 0) return;

    std::snprintf(msg, sizeof(msg), "%s: waitAcceptable reports the pending connection", label);
    CHECK(listener.waitAcceptable(1000) == 1, msg);
    std::unique_ptr<IpcConnection> conn = listener.accept();
    std::snprintf(msg, sizeof(msg), "%s: accept returns a connection", label);
    CHECK(conn != nullptr, msg);
    if (!conn) { ::close(client); return; }

    std::snprintf(msg, sizeof(msg), "%s: idle connection → waitReadable times out", label);
    CHECK(conn->waitReadable(20) == 0, msg);

    const char out[] = "{\"type\":\"status\"}\n";
    std::snprintf(msg, sizeof(msg), "%s: send writes the whole line", label);
    CHECK(conn->send(out, sizeof(out) - 1) == static_cast<long long>(sizeof(out) - 1), msg);
    char buf[64] = {};
    const ssize_t got = ::recv(client, buf, sizeof(buf), 0);
    std::snprintf(msg, sizeof(msg), "%s: client receives exactly what was sent", label);
    CHECK(got == static_cast<ssize_t>(sizeof(out) - 1) && std::memcmp(buf, out, sizeof(out) - 1) == 0, msg);

    const char in[] = "{\"type\":\"pot\"}\n";
    ::send(client, in, sizeof(in) - 1, 0);
    std::snprintf(msg, sizeof(msg), "%s: waitReadable reports incoming data", label);
    CHECK(conn->waitReadable(1000) == 1, msg);
    char rbuf[64] = {};
    const long long n = conn->recv(rbuf, sizeof(rbuf));
    std::snprintf(msg, sizeof(msg), "%s: recv returns the client's bytes", label);
    CHECK(n == static_cast<long long>(sizeof(in) - 1) && std::memcmp(rbuf, in, sizeof(in) - 1) == 0, msg);

    ::close(client);
    conn->waitReadable(1000);
    std::snprintf(msg, sizeof(msg), "%s: recv returns 0 after the peer closes", label);
    CHECK(conn->recv(rbuf, sizeof(rbuf)) == 0, msg);
    std::snprintf(msg, sizeof(msg), "%s: send to a closed peer fails without killing the process", label);
    // The first sends after the peer closed can still succeed (the kernel
    // buffers them); only once the peer's RST has been processed does send()
    // fail with EPIPE/ECONNRESET. Back-to-back sends could all beat the RST on
    // a loaded CI runner, so give it up to ~1 s to arrive.
    long long r = 1;
    for (int i = 0; i < 100 && r > 0; ++i) {
        r = conn->send(out, sizeof(out) - 1);
        if (r > 0) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    CHECK(r <= 0, msg);
}

static void test_unix() {
    // A stale socket file from a previous run must be replaced, as before.
    { std::FILE* f = std::fopen(g_sock_path.c_str(), "w"); if (f) std::fclose(f); }
    std::string err;
    auto l = daisy_emu::make_unix_listener(g_sock_path.c_str(), err);
    CHECK(l != nullptr, "unix: listener binds over a stale socket file");
    if (!l) { std::printf("    err: %s\n", err.c_str()); return; }
    CHECK(l->address() == g_sock_path, "unix: announce address is the socket path");
    exercise("unix", *l, connect_unix);
    l.reset();
    struct stat st{};
    CHECK(::stat(g_sock_path.c_str(), &st) != 0, "unix: socket file is removed when the listener is destroyed");
}

static void test_unix_path_too_long() {
    const std::string long_path = "/tmp/" + std::string(200, 'x') + ".sock";
    std::string err;
    auto l = daisy_emu::make_unix_listener(long_path.c_str(), err);
    CHECK(l == nullptr, "unix: a path longer than sun_path is rejected (FR-QA-6)");
    CHECK(err.find("too long") != std::string::npos, "unix: the error names the path-length problem");
}

static void test_tcp() {
    std::string err;
    auto l = daisy_emu::make_tcp_listener(err);
    CHECK(l != nullptr, "tcp: listener binds");
    if (!l) { std::printf("    err: %s\n", err.c_str()); return; }

    const std::string addr = l->address();
    CHECK(addr.rfind("127.0.0.1:", 0) == 0, "tcp: announce address is 127.0.0.1:<port>");
    const int port = std::atoi(addr.c_str() + std::strlen("127.0.0.1:"));
    CHECK(port > 0 && port < 65536, "tcp: an ephemeral port was assigned");

    sockaddr_in bound{};
    socklen_t blen = sizeof(bound);
    ::getsockname(static_cast<int>(l->nativeHandle()), reinterpret_cast<sockaddr*>(&bound), &blen);
    CHECK(bound.sin_addr.s_addr == htonl(INADDR_LOOPBACK), "tcp: bound to loopback only, never 0.0.0.0");

    const int client = connect_tcp(addr);
    l->waitAcceptable(1000);
    auto conn = l->accept();
    CHECK(conn != nullptr, "tcp: accept returns a connection");
    if (conn) {
        int nodelay = 0;
        socklen_t len = sizeof(nodelay);
        ::getsockopt(static_cast<int>(conn->nativeHandle()), IPPROTO_TCP, TCP_NODELAY, &nodelay, &len);
        CHECK(nodelay != 0, "tcp: accepted connection has TCP_NODELAY");
    }
    conn.reset();
    if (client >= 0) ::close(client);

    exercise("tcp", *l, connect_tcp);

    auto l2 = daisy_emu::make_tcp_listener(err);
    CHECK(l2 != nullptr && l2->address() != addr, "tcp: a second listener gets its own port");
}

int main() {
    std::printf("=== IPC transport tests (FR-WIN-IPC-1) ===\n");
    g_sock_path = "/tmp/daisy_emu_transport_test_" + std::to_string(::getpid()) + ".sock";
    test_unix();
    test_unix_path_too_long();
    test_tcp();
    if (failures) { std::printf("\nResult: %d failure(s)\n", failures); return 1; }
    std::printf("\nResult: all passed\n");
    return 0;
}
