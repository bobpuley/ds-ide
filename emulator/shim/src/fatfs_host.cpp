#include "daisy/fatfs_host.h"

#include <cstring>
#include <filesystem>
#include <string>
#include <system_error>

namespace daisy {

namespace {

constexpr const char* kSdRoot = "sdcard";

// True when `path` is (now) a directory; false if it exists as something
// else or cannot be created. Default permissions (FR-WIN-BLD-2: no POSIX
// mode bits) — 0777 & ~umask, i.e. 0755 under the usual umask 022.
bool ensure_dir(const char* path) {
    std::error_code ec;
    if (std::filesystem::is_directory(path, ec)) return true;
    if (std::filesystem::exists(path, ec)) return false;
    return std::filesystem::create_directory(path, ec) && !ec;
}

// Rejects a path with a ".." segment — a legitimate SD-card-relative path
// from effect code never needs to leave the card root, so this is a flat
// refusal rather than attempting lexical normalization of a path that may
// not exist yet (e.g. FA_CREATE_ALWAYS).
bool path_escapes_root(const char* path) {
    const std::string s(path);
    size_t start = 0;
    while (start <= s.size()) {
        const size_t slash = s.find('/', start);
        const std::string segment =
            s.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
        if (segment == "..") return true;
        if (slash == std::string::npos) break;
        start = slash + 1;
    }
    return false;
}

std::string resolve(const char* path) {
    std::string p(path);
    if (!p.empty() && p.front() == '/') p.erase(0, 1);  // FatFs paths are card-root-relative
    return std::string(kSdRoot) + "/" + p;
}

const char* fopen_mode(uint8_t mode) {
    const bool read  = mode & FA_READ;
    const bool write = mode & FA_WRITE;
    if (mode & FA_CREATE_ALWAYS) return write ? "w+b" : "wb";
    if (mode & FA_OPEN_ALWAYS) return "a+b";
    if (read && write) return "r+b";
    if (write) return "r+b";  // open existing for write, no create
    return "rb";
}

}  // namespace

const char* sdcard_root() { return kSdRoot; }

FRESULT f_mount(FATFS* fs, const char* path, uint8_t opt) {
    (void)path;
    (void)opt;
    if (!fs) return FR_INVALID_PARAMETER;
    if (!ensure_dir(kSdRoot)) return FR_DISK_ERR;
    fs->mounted = true;
    return FR_OK;
}

FRESULT f_open(FIL* fp, const char* path, uint8_t mode) {
    if (!fp || !path) return FR_INVALID_PARAMETER;
    if (path_escapes_root(path)) return FR_INVALID_NAME;
    const std::string full = resolve(path);
    std::FILE* f = std::fopen(full.c_str(), fopen_mode(mode));
    if (!f) return (mode & (FA_CREATE_ALWAYS | FA_OPEN_ALWAYS)) ? FR_DISK_ERR : FR_NO_FILE;
    fp->handle = f;
    return FR_OK;
}

FRESULT f_read(FIL* fp, void* buff, unsigned int btr, unsigned int* br) {
    if (!fp || !fp->handle || !br) return FR_INVALID_PARAMETER;
    *br = static_cast<unsigned int>(std::fread(buff, 1, btr, fp->handle));
    return FR_OK;
}

FRESULT f_write(FIL* fp, const void* buff, unsigned int btw, unsigned int* bw) {
    if (!fp || !fp->handle || !bw) return FR_INVALID_PARAMETER;
    *bw = static_cast<unsigned int>(std::fwrite(buff, 1, btw, fp->handle));
    return FR_OK;
}

FRESULT f_lseek(FIL* fp, uint32_t ofs) {
    if (!fp || !fp->handle) return FR_INVALID_PARAMETER;
    return std::fseek(fp->handle, static_cast<long>(ofs), SEEK_SET) == 0 ? FR_OK : FR_DISK_ERR;
}

FRESULT f_sync(FIL* fp) {
    if (!fp || !fp->handle) return FR_INVALID_PARAMETER;
    return std::fflush(fp->handle) == 0 ? FR_OK : FR_DISK_ERR;
}

FRESULT f_close(FIL* fp) {
    if (!fp || !fp->handle) return FR_INVALID_PARAMETER;
    const int rc = std::fclose(fp->handle);
    fp->handle = nullptr;
    return rc == 0 ? FR_OK : FR_DISK_ERR;
}

FRESULT FatFSInterface::Init(Media media) {
    (void)media;
    return f_mount(&fs_, "/", 1);
}

}  // namespace daisy
