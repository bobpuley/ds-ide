#include "platform_file.h"

#include <cstdio>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <climits>
#include <sys/stat.h>
#include <filesystem>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace daisy_emu::platform_file {

#ifdef _WIN32

namespace {
// The CRT's narrow _open uses the ANSI code page; paths arrive as UTF-8.
std::filesystem::path widen(const char* path) {
    return std::filesystem::u8path(path);
}
// _read/_write take an unsigned int count; callers already loop on short I/O.
unsigned int clamp_count(std::size_t n) {
    return n > static_cast<std::size_t>(INT_MAX) ? static_cast<unsigned int>(INT_MAX)
                                                 : static_cast<unsigned int>(n);
}
}  // namespace

int open_read(const char* path) {
    return ::_wopen(widen(path).c_str(), _O_RDONLY | _O_BINARY);
}

int open_write_trunc(const char* path) {
    return ::_wopen(widen(path).c_str(), _O_WRONLY | _O_CREAT | _O_TRUNC | _O_BINARY,
                    _S_IREAD | _S_IWRITE);
}

long long read(int fd, void* buf, std::size_t n) {
    return ::_read(fd, buf, clamp_count(n));
}

long long write(int fd, const void* buf, std::size_t n) {
    return ::_write(fd, buf, clamp_count(n));
}

long long seek(int fd, long long offset, int whence) {
    return ::_lseeki64(fd, offset, whence);
}

int close(int fd) {
    return ::_close(fd);
}

#else

static_assert(sizeof(off_t) >= 8, "platform_file needs 64-bit off_t");

int open_read(const char* path) {
    return ::open(path, O_RDONLY);
}

int open_write_trunc(const char* path) {
    return ::open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
}

long long read(int fd, void* buf, std::size_t n) {
    return ::read(fd, buf, n);
}

long long write(int fd, const void* buf, std::size_t n) {
    return ::write(fd, buf, n);
}

long long seek(int fd, long long offset, int whence) {
    return ::lseek(fd, static_cast<off_t>(offset), whence);
}

int close(int fd) {
    return ::close(fd);
}

#endif

}  // namespace daisy_emu::platform_file
