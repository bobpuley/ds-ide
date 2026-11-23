#pragma once
// FR-EMU-13: LED telemetry as state ("latest value wins").
//
// Producers — the LED shims, called from the effect's main loop and/or the
// audio callback — only store the latest value into g_state.led_state /
// g_state.rgb_state (one atomic store, no lock, no allocation, safe from any
// thread). The drain thread owns a LedSampler and calls collect() each loop:
// it emits a `led` / `rgbLed` message for every pin whose current value
// differs from the last one it sent. Values set between two samples may be
// skipped, but the latest one is always delivered, and nothing is lost to a
// full queue.

#include "emulator_state.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>

namespace daisy_emu {

// One RGB colour in a single 64-bit word: bit 63 = "set", then three 20-bit
// channels (r: bits 40–59, g: 20–39, b: 0–19), each 0..1 quantised to
// 1/(2^20 - 1) — far below the 4 decimals the `rgbLed` message carries.
constexpr uint64_t kRgbSetBit = uint64_t(1) << 63;
constexpr uint32_t kRgbChannelMax = (1u << 20) - 1;

inline uint32_t quantise_channel(float v) {
    if (!(v > 0.f)) return 0;  // also maps NaN to 0
    if (v >= 1.f) return kRgbChannelMax;
    return static_cast<uint32_t>(std::lround(static_cast<double>(v) * kRgbChannelMax));
}

inline uint64_t pack_rgb(float r, float g, float b) {
    return kRgbSetBit
         | (uint64_t(quantise_channel(r)) << 40)
         | (uint64_t(quantise_channel(g)) << 20)
         |  uint64_t(quantise_channel(b));
}

inline float unpack_channel(uint64_t packed, int shift) {
    return static_cast<float>((packed >> shift) & kRgbChannelMax) / static_cast<float>(kRgbChannelMax);
}

// Drain-thread only: not thread-safe, by design (one consumer).
class LedSampler {
public:
    LedSampler() {
        std::fill(std::begin(led_sent_), std::end(led_sent_), int8_t(-1));
        std::fill(std::begin(rgb_sent_), std::end(rgb_sent_), uint64_t(0));
    }

    // Calls emit(const char* json) for each changed LED; returns how many.
    template <typename Emit>
    size_t collect(Emit&& emit) {
        size_t sent = 0;
        char buf[128];
        for (int pin = 0; pin < EmulatorState::kNumGpioPins; ++pin) {
            const int8_t lit = g_state.led_state[pin].load(std::memory_order_relaxed);
            if (lit >= 0 && lit != led_sent_[pin]) {
                led_sent_[pin] = lit;
                std::snprintf(buf, sizeof(buf), "{\"type\":\"led\",\"gpioPin\":%d,\"lit\":%s}",
                              pin, lit ? "true" : "false");
                emit(static_cast<const char*>(buf));
                ++sent;
            }
            const uint64_t rgb = g_state.rgb_state[pin].load(std::memory_order_relaxed);
            if ((rgb & kRgbSetBit) && rgb != rgb_sent_[pin]) {
                rgb_sent_[pin] = rgb;
                std::snprintf(buf, sizeof(buf),
                              "{\"type\":\"rgbLed\",\"gpioPin\":%d,\"r\":%.4f,\"g\":%.4f,\"b\":%.4f}",
                              pin, static_cast<double>(unpack_channel(rgb, 40)),
                              static_cast<double>(unpack_channel(rgb, 20)),
                              static_cast<double>(unpack_channel(rgb, 0)));
                emit(static_cast<const char*>(buf));
                ++sent;
            }
        }
        return sent;
    }

private:
    int8_t   led_sent_[EmulatorState::kNumGpioPins];
    uint64_t rgb_sent_[EmulatorState::kNumGpioPins];
};

}  // namespace daisy_emu
