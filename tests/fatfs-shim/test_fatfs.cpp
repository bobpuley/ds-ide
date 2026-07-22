// Unit test for the FatFS host shim (M45, FR-DEV-10).
//
// Exercises f_mount/f_open/f_read/f_write/f_lseek/f_close against a real,
// disposable host directory (the test runner cds into a temp dir first, so
// "sdcard/" lands there, never in the repo). No IPC, no EmulatorState — this
// shim has no runtime controlValue traffic at all, unlike every other
// wired-control shim. Plain asserts; exit 0 on success.

#include "daisy/fatfs_host.h"

#include <sys/stat.h>

#include <cstdio>
#include <cstring>

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

using namespace daisy;

static bool dir_exists(const char* path) {
    struct stat st{};
    return ::stat(path, &st) == 0 && S_ISDIR(st.st_mode);
}

static void test_mount_creates_directory() {
    FATFS fs{};
    const FRESULT r = f_mount(&fs, "/", 1);
    CHECK(r == FR_OK, "f_mount returns FR_OK");
    CHECK(fs.mounted, "FATFS.mounted is set");
    CHECK(dir_exists(sdcard_root()), "sdcard_root() directory now exists");
}

static void test_write_read_round_trip() {
    FATFS fs{};
    f_mount(&fs, "/", 1);

    FIL fw{};
    CHECK(f_open(&fw, "notes.txt", FA_WRITE | FA_CREATE_ALWAYS) == FR_OK, "opens for write+create");
    const char* msg = "hello daisy";
    unsigned int bw = 0;
    CHECK(f_write(&fw, msg, static_cast<unsigned int>(std::strlen(msg)), &bw) == FR_OK, "f_write succeeds");
    CHECK(bw == std::strlen(msg), "f_write reports full byte count");
    CHECK(f_close(&fw) == FR_OK, "f_close succeeds");

    FIL fr{};
    CHECK(f_open(&fr, "notes.txt", FA_READ) == FR_OK, "reopens for read");
    char buf[64] = {};
    unsigned int br = 0;
    CHECK(f_read(&fr, buf, sizeof(buf) - 1, &br) == FR_OK, "f_read succeeds");
    CHECK(br == std::strlen(msg), "f_read reports full byte count");
    CHECK(std::strncmp(buf, msg, br) == 0, "read-back content matches what was written");
    f_close(&fr);
}

static void test_seek() {
    FATFS fs{};
    f_mount(&fs, "/", 1);

    FIL fw{};
    f_open(&fw, "seekme.txt", FA_WRITE | FA_CREATE_ALWAYS);
    const char* msg = "0123456789";
    unsigned int bw = 0;
    f_write(&fw, msg, static_cast<unsigned int>(std::strlen(msg)), &bw);
    f_close(&fw);

    FIL fr{};
    f_open(&fr, "seekme.txt", FA_READ);
    CHECK(f_lseek(&fr, 5) == FR_OK, "f_lseek to offset 5 succeeds");
    char buf[8] = {};
    unsigned int br = 0;
    f_read(&fr, buf, 4, &br);
    CHECK(br == 4, "reads 4 bytes after seek");
    CHECK(std::strncmp(buf, "5678", 4) == 0, "seek lands at the expected offset");
    f_close(&fr);
}

static void test_missing_file_error() {
    FATFS fs{};
    f_mount(&fs, "/", 1);

    FIL fr{};
    CHECK(f_open(&fr, "does-not-exist.txt", FA_READ) == FR_NO_FILE, "opening a missing file for read returns FR_NO_FILE");
}

static void test_path_escape_rejected() {
    FATFS fs{};
    f_mount(&fs, "/", 1);

    FIL fw{};
    const FRESULT r = f_open(&fw, "../escaped.txt", FA_WRITE | FA_CREATE_ALWAYS);
    CHECK(r == FR_INVALID_NAME, "a path with a \"..\" segment is refused with FR_INVALID_NAME");
    CHECK(!dir_exists("../escaped.txt"), "no file was created outside the card root");
}

int main() {
    std::printf("=== FatFS host shim unit tests (M45, FR-DEV-10) ===\n");
    test_mount_creates_directory();
    test_write_read_round_trip();
    test_seek();
    test_missing_file_error();
    test_path_escape_rejected();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
