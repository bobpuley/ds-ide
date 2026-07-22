#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>

// OledDisplay host shim (SSD1306, M46/FR-DEV-14). Pixel primitives only —
// Fill()/DrawPixel()/Update() — no WriteString()/SetCursor()/font support.
// See 02_assumptions-and-risks.md (confirmed scope, 2026-07-22): real
// libDaisy's WriteString depends on font bitmap tables (Font_6x8,
// Font_11x18, etc.) this project has no vendored copy of, and porting them
// is its own task.
//
// Real libDaisy's OledDisplay is templated on a transport driver
// (OledDisplay<SSD130x4WireSpi128x64Driver> for 4-wire SPI — confirmed
// against daisy-seed-knowledge/examples/OLED/OLED.cpp, the one corpus
// example) so generated code's declared type varies with the selected bus
// (codegen/oled.ts's declLine(bus)). The emulator doesn't simulate real
// SPI/I2C bit-level transport, so both driver "tags" below are empty
// placeholders — the template parameter only needs to exist for the
// declared type to compile the same way real hardware code does; it has no
// effect on shim behavior, which is identical across buses.
namespace daisy {

struct SSD130x4WireSpi128x64Driver {};
// ⚠️ ASSUMPTION: this I2C driver type name follows real libDaisy's SPI
// driver naming convention but is unconfirmed against a real
// dev/oled_ssd130x.h header (not present in this project's corpus) — verify
// before a hardware build with I2C-mode OLED is attempted. Doesn't affect
// emulator behavior, only real-hardware source compatibility.
struct SSD130xI2c128x64Driver {};

// Emits an `oledFrame` IPC message carrying the current framebuffer, base64
// encoded (shim/src/oled_display.cpp). Free function rather than a template
// method since encoding doesn't depend on the driver type. Pushes into
// EmulatorState::oled_queue — a dedicated SPSC queue distinct from the audio
// engine's ipc_queue, because Update() is called from the effect's own
// while(1) loop (effect_main()'s thread, see runtime/main.cpp), not the
// audio engine's RT callback thread that owns ipc_queue; sharing that single
// instance would turn it into a two-producer queue and break its SPSC
// invariant.
void emit_oled_frame(const uint8_t* buffer, size_t len);

template <typename Driver>
class OledDisplay {
public:
    static constexpr uint8_t kWidth      = 128;
    static constexpr uint8_t kHeight     = 64;
    // SSD1306 GDDRAM layout: one byte per 8 vertically-stacked pixels
    // ("page"), kHeight/8 pages of kWidth bytes each.
    static constexpr size_t  kBufferSize = (static_cast<size_t>(kWidth) * kHeight) / 8;

    struct Config {
        void Defaults() {}
    };

    void Init(const Config& config = Config()) {
        (void)config;
        std::memset(buffer_, 0, sizeof(buffer_));
    }

    // Sets every pixel on (true) or off (false) — matches real libDaisy's
    // Fill(bool on).
    void Fill(bool on) {
        std::memset(buffer_, on ? 0xFF : 0x00, sizeof(buffer_));
    }

    // Sets a single pixel. Out-of-range coordinates are ignored rather than
    // indexing out of bounds — mirrors real hardware silently clipping.
    void DrawPixel(uint8_t x, uint8_t y, bool on) {
        if (x >= kWidth || y >= kHeight) return;
        size_t  byte_idx = static_cast<size_t>(x) + (static_cast<size_t>(y / 8) * kWidth);
        uint8_t bit      = static_cast<uint8_t>(1u << (y % 8));
        if (on) buffer_[byte_idx] = static_cast<uint8_t>(buffer_[byte_idx] | bit);
        else    buffer_[byte_idx] = static_cast<uint8_t>(buffer_[byte_idx] & ~bit);
    }

    // Captures the current framebuffer and hands it to the emulator's IPC
    // layer — matches real libDaisy's Update() (pushes the buffer over the
    // real transport); here it pushes to oled_queue instead (FR-DEV-14).
    void Update() {
        emit_oled_frame(buffer_, kBufferSize);
    }

    // Exposed for tests only — real libDaisy's OledDisplay has no such
    // accessor (the buffer is private, pushed over real hardware transport
    // instead), mirrors fatfs_host.h's sdcard_root() convention.
    const uint8_t* RawBuffer() const { return buffer_; }

private:
    uint8_t buffer_[kBufferSize]{};
};

}  // namespace daisy
