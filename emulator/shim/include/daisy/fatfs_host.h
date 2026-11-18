#pragma once
#include <cstdint>
#include <cstdio>

// FatFS host shim (M45, FR-DEV-10). SD card access maps onto a
// workspace-relative host directory ("sdcard/") rather than real SD/FatFs
// hardware — the emulation is genuinely cheap because the file-shaped API
// surface a sampler/looper effect actually calls (f_open/f_read/f_write/
// f_lseek/f_close) maps directly onto host stdio (02_assumptions-and-risks.md).
// f_findfirst/f_mkfs/raw disk I/O are out of scope until a real project needs
// them.
namespace daisy {

// Subset of ChaN FatFs's FRESULT codes — same names/ordering as real FatFs's
// ff.h, so effect code branching on these reads identically on host and
// hardware.
enum FRESULT : int {
    FR_OK = 0,
    FR_DISK_ERR,
    FR_NOT_READY,
    FR_NO_FILE,
    FR_NO_PATH,
    FR_INVALID_NAME,
    FR_DENIED,
    FR_INVALID_PARAMETER,
};

// f_open() mode flags — same bit values as real FatFs's ff.h.
constexpr uint8_t FA_READ          = 0x01;
constexpr uint8_t FA_WRITE         = 0x02;
constexpr uint8_t FA_OPEN_EXISTING = 0x00;
constexpr uint8_t FA_CREATE_NEW    = 0x04;
constexpr uint8_t FA_CREATE_ALWAYS = 0x08;
constexpr uint8_t FA_OPEN_ALWAYS   = 0x10;

// Mount handle — real FatFs's FATFS carries volume work area state; the host
// shim only needs to know whether f_mount succeeded.
struct FATFS {
    bool mounted{false};
};

// Open file handle, backed by a host FILE* rather than real FatFs's cluster
// chain state.
struct FIL {
    std::FILE* handle{nullptr};
};

// Returns the workspace-relative root directory FatFS calls are mapped onto
// (creating it if absent on first f_mount). Exposed for tests.
const char* sdcard_root();

// Mounts `sdcard_root()`, creating it if it doesn't already exist. `path` and
// `opt` are accepted for call-shape compatibility with real FatFs (real
// callers pass "/" or "0:", and a mount-now/mount-later option) but do not
// affect which host directory is used — v1 always roots at sdcard_root().
FRESULT f_mount(FATFS* fs, const char* path, uint8_t opt);

// Opens `path` (resolved against sdcard_root()) with FatFs-style mode flags.
// A path that would resolve outside sdcard_root() (any ".." path segment) is
// refused with FR_INVALID_NAME before touching the host filesystem.
FRESULT f_open(FIL* fp, const char* path, uint8_t mode);
FRESULT f_read(FIL* fp, void* buff, unsigned int btr, unsigned int* br);
FRESULT f_write(FIL* fp, const void* buff, unsigned int btw, unsigned int* bw);
FRESULT f_lseek(FIL* fp, uint32_t ofs);
FRESULT f_close(FIL* fp);

// Flushes buffered writes to the host file, like FatFs's f_sync: data written
// with f_write is on the "card" (and visible to the SD viewer) without closing.
FRESULT f_sync(FIL* fp);

// Minimal libDaisy-shaped wrappers so generated Init() code
// (devices/codegen/sdcard.ts) has a real SdmmcHandler/FatFSInterface pair to
// declare and call, matching the real API's shape. There is no SD hardware
// to configure on the host, so SdmmcHandler::Init() is a no-op; mounting
// happens in FatFSInterface::Init(), which calls f_mount() above.
class SdmmcHandler {
public:
    struct Config {
        void Defaults() {}
    };
    void Init(const Config& cfg = Config()) { (void)cfg; }
};

class FatFSInterface {
public:
    enum class Media { SD };

    FRESULT Init(Media media = Media::SD);
    FATFS& GetSDFileSystem() { return fs_; }

private:
    FATFS fs_{};
};

}  // namespace daisy
