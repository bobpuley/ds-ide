// Unix domain socket listener (FR-WIN-IPC-1) — the macOS transport, with
// exactly the behaviour run_ipc_server() had before the extraction.
#include "ipc_transport.h"

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>

namespace daisy_emu {

std::unique_ptr<IpcListener> make_unix_listener(const char* path, std::string& err) {
    // Reject paths that would be silently truncated by strncpy (FR-QA-6).
    if (std::strlen(path) >= sizeof(sockaddr_un::sun_path)) {
        char buf[128];
        std::snprintf(buf, sizeof(buf), "socket path too long (max %zu bytes)",
                      sizeof(sockaddr_un::sun_path) - 1);
        err = std::string(buf) + ": " + path;
        return nullptr;
    }

    ::unlink(path);

    const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) { err = std::string("socket: ") + std::strerror(errno); return nullptr; }

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);

    if (::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        err = std::string("bind: ") + std::strerror(errno);
        ::close(fd);
        return nullptr;
    }
    ::listen(fd, 1);
    return std::make_unique<IpcListener>(IpcListener::Kind::Unix, fd, path);
}

}  // namespace daisy_emu
