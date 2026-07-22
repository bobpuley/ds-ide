#include "daisy/oled_display.h"
#include "emulator_state.h"

#include <cstdio>

namespace daisy {

namespace {

constexpr char kB64Table[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Encodes `len` bytes of `data` into `out` (NUL-terminated, capped at
// `out_cap`). No heap allocation — every byte written stays within the
// caller-provided buffer, matching the RT-safe convention every other
// IPC-emitting shim in this tree follows (led.cpp, rgb_led.cpp: fixed stack
// buffers, no std::string growth). Returns the number of characters written
// (excluding the NUL terminator).
size_t base64_encode(const uint8_t* data, size_t len, char* out, size_t out_cap) {
    size_t oi = 0;
    size_t i  = 0;
    for (; i + 3 <= len && oi + 4 <= out_cap; i += 3) {
        uint32_t n = (static_cast<uint32_t>(data[i]) << 16)
                   | (static_cast<uint32_t>(data[i + 1]) << 8)
                   |  static_cast<uint32_t>(data[i + 2]);
        out[oi++] = kB64Table[(n >> 18) & 0x3F];
        out[oi++] = kB64Table[(n >> 12) & 0x3F];
        out[oi++] = kB64Table[(n >> 6) & 0x3F];
        out[oi++] = kB64Table[n & 0x3F];
    }
    size_t rem = len - i;
    if (rem == 1 && oi + 4 <= out_cap) {
        uint32_t n = static_cast<uint32_t>(data[i]) << 16;
        out[oi++] = kB64Table[(n >> 18) & 0x3F];
        out[oi++] = kB64Table[(n >> 12) & 0x3F];
        out[oi++] = '=';
        out[oi++] = '=';
    } else if (rem == 2 && oi + 4 <= out_cap) {
        uint32_t n = (static_cast<uint32_t>(data[i]) << 16) | (static_cast<uint32_t>(data[i + 1]) << 8);
        out[oi++] = kB64Table[(n >> 18) & 0x3F];
        out[oi++] = kB64Table[(n >> 12) & 0x3F];
        out[oi++] = kB64Table[(n >> 6) & 0x3F];
        out[oi++] = '=';
    }
    if (oi < out_cap) out[oi] = '\0';
    return oi;
}

}  // namespace

void emit_oled_frame(const uint8_t* buffer, size_t len) {
    // 128x64x1bpp = 1024 bytes -> ceil(1024/3)*4 = 1368 base64 chars. Sized
    // generously (2 KB) so a future larger panel doesn't silently truncate;
    // well within oled_queue's per-slot MAX_MSG (80 KB).
    static constexpr size_t kB64Cap = 2048;
    char b64[kB64Cap];
    base64_encode(buffer, len, b64, kB64Cap);

    static constexpr size_t kMsgCap = kB64Cap + 64;
    char msg[kMsgCap];
    std::snprintf(msg, sizeof(msg), "{\"type\":\"oledFrame\",\"data\":\"%s\"}", b64);

    if (!daisy_emu::g_state.oled_queue.push(msg)) {
        daisy_emu::g_state.oled_queue_drops.fetch_add(1, std::memory_order_relaxed);
    }
}

}  // namespace daisy
