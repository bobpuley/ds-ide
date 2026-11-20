#pragma once
#include <cstddef>

// Raw binary file I/O behind one small seam (FR-WIN-BLD-2), so the session
// recorder/player include no POSIX-only header. On POSIX each call is the
// exact open/read/write/lseek/close the callers used before; on Windows it is
// the CRT's _wopen (UTF-8 path, always _O_BINARY)/_read/_write/_lseeki64.
//
// Descriptors are plain ints; a negative value means failure. Offsets are
// 64-bit on every platform. `whence` takes SEEK_SET/SEEK_CUR/SEEK_END from
// <cstdio>.
namespace daisy_emu::platform_file {

// Read-only. Returns a descriptor, or -1.
int open_read(const char* path);

// Write-only, create or truncate. New files get mode 0644 on POSIX.
// Returns a descriptor, or -1.
int open_write_trunc(const char* path);

// Bytes transferred; 0 at EOF (read); negative on error. May be short.
long long read(int fd, void* buf, std::size_t n);
long long write(int fd, const void* buf, std::size_t n);

// Returns the resulting offset, or a negative value on error.
long long seek(int fd, long long offset, int whence);

// 0 on success.
int close(int fd);

}  // namespace daisy_emu::platform_file
