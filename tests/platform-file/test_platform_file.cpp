// Unit test for the platform file shim (M77, FR-WIN-BLD-2).
//
// The session recorder/player do raw-fd I/O through platform_file so that no
// POSIX-only header is included outside the shim. These checks pin the
// behaviour macOS relied on before the extraction: 0644 creation mode,
// O_TRUNC on reopen, 64-bit seeks, EOF/short-read semantics. Runs in a temp
// dir (the runner cds there first). Plain asserts; exit 0 on success.

#include "platform_file.h"
#include "session_recorder.h"
#include "daisy/fatfs_host.h"

#include <sys/stat.h>

#include <cstdio>
#include <cstring>

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

namespace pf = daisy_emu::platform_file;

static void test_write_read_round_trip() {
    int fd = pf::open_write_trunc("rt.bin");
    CHECK(fd >= 0, "open_write_trunc creates a new file");
    const char msg[] = "daisy\0seed";  // embedded NUL: binary-safe
    CHECK(pf::write(fd, msg, sizeof(msg)) == static_cast<long long>(sizeof(msg)), "write reports full byte count");
    CHECK(pf::close(fd) == 0, "close succeeds");

    fd = pf::open_read("rt.bin");
    CHECK(fd >= 0, "open_read opens the written file");
    char buf[32] = {};
    CHECK(pf::read(fd, buf, sizeof(buf)) == static_cast<long long>(sizeof(msg)), "read returns the bytes available");
    CHECK(std::memcmp(buf, msg, sizeof(msg)) == 0, "read-back content matches, including the embedded NUL");
    CHECK(pf::read(fd, buf, sizeof(buf)) == 0, "read at EOF returns 0");
    pf::close(fd);
}

static void test_reopen_truncates() {
    int fd = pf::open_write_trunc("trunc.bin");
    pf::write(fd, "0123456789", 10);
    pf::close(fd);
    fd = pf::open_write_trunc("trunc.bin");
    pf::write(fd, "ab", 2);
    pf::close(fd);

    struct stat st{};
    CHECK(::stat("trunc.bin", &st) == 0 && st.st_size == 2, "open_write_trunc truncates an existing file");
}

static void test_seek() {
    int fd = pf::open_write_trunc("seek.bin");
    pf::write(fd, "0123456789", 10);
    pf::close(fd);

    fd = pf::open_read("seek.bin");
    CHECK(pf::seek(fd, 0, SEEK_CUR) == 0, "seek(0, SEEK_CUR) reports the current offset");
    CHECK(pf::seek(fd, 4, SEEK_SET) == 4, "seek SEEK_SET returns the new offset");
    CHECK(pf::seek(fd, 3, SEEK_CUR) == 7, "seek SEEK_CUR is relative");
    char c = 0;
    CHECK(pf::read(fd, &c, 1) == 1 && c == '7', "read after seek starts at the new offset");

    // 64-bit offsets: a long recording must not wrap at 2 GiB (Windows long is 32-bit).
    const long long big = 3LL * 1024 * 1024 * 1024;
    CHECK(pf::seek(fd, big, SEEK_SET) == big, "seek past 2 GiB returns the full 64-bit offset");
    CHECK(pf::seek(fd, -1, SEEK_SET) < 0, "seek to a negative offset fails");
    pf::close(fd);
}

static void test_missing_file() {
    CHECK(pf::open_read("does-not-exist.bin") < 0, "open_read of a missing file returns a negative fd");
}

static void test_recorder_file_mode() {
    ::umask(022);
    daisy_emu::SessionRecorder rec;
    CHECK(rec.start("mode.dsrec", 48000, 48), "recorder starts");
    rec.stop();
    struct stat st{};
    CHECK(::stat("mode.dsrec", &st) == 0, "recorder created its file");
    CHECK((st.st_mode & 0777) == 0644, "recorder file is created with mode 0644 (unchanged from POSIX open)");
}

static void test_sdcard_root_is_a_file() {
    using namespace daisy;
    std::FILE* f = std::fopen(sdcard_root(), "wb");
    if (f) std::fclose(f);
    FATFS fs{};
    CHECK(f_mount(&fs, "/", 1) == FR_DISK_ERR, "f_mount fails when the sdcard root exists as a regular file");
    std::remove(sdcard_root());
    CHECK(f_mount(&fs, "/", 1) == FR_OK, "f_mount creates the sdcard root once the file is gone");
    CHECK(f_mount(&fs, "/", 1) == FR_OK, "f_mount succeeds when the sdcard root already exists");
}

int main() {
    std::printf("=== platform_file shim tests (FR-WIN-BLD-2) ===\n");
    test_write_read_round_trip();
    test_reopen_truncates();
    test_seek();
    test_missing_file();
    test_recorder_file_mode();
    test_sdcard_root_is_a_file();
    if (failures) { std::printf("\nResult: %d failure(s)\n", failures); return 1; }
    std::printf("\nResult: all passed\n");
    return 0;
}
