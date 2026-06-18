#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

namespace daisy_emu {

// ---- .dsrec binary format ---------------------------------------------------
//
// Header (16 bytes):
//   [0..5]   magic:       "DSREC\0"  (6 bytes)
//   [6]      version:     0x01
//   [7]      reserved:    0x00
//   [8..11]  sample_rate: uint32 LE
//   [12..15] block_size:  uint32 LE
//
// Records (variable-length, repeat until EOF):
//   [0]      type: uint8
//     0x01  AUDIO_BLOCK   payload: float32[block_size*2] (stereo interleaved input, LE)
//     0x02  POT_EVENT     payload: uint8 channel + float32 value LE         (5 bytes)
//     0x03  BUTTON_EVENT  payload: uint8 gpio_pin + uint8 pressed (0|1)     (2 bytes)
//     0xFF  END           payload: none (marks clean end-of-file)
//
// Events that occur between block N and block N+1 are stored immediately
// before the block N+1 record, so replay fires them before processing that block.

static constexpr uint8_t kRecMagicVersion = 0x01;
static constexpr uint8_t kRecTypeAudioBlock  = 0x01;
static constexpr uint8_t kRecTypePotEvent    = 0x02;
static constexpr uint8_t kRecTypeButtonEvent = 0x03;
static constexpr uint8_t kRecTypeEnd         = 0xFF;

// Pending event queued by IPC thread; flushed to file by audio engine.
struct PendingEvent {
    uint8_t type;
    uint8_t channel_or_pin;
    float   value;      // used for POT_EVENT
    uint8_t pressed;    // used for BUTTON_EVENT
};

class SessionRecorder {
public:
    // Open file and write header. Returns true on success.
    bool start(const std::string& path, uint32_t sample_rate, uint32_t block_size);

    // Enqueue a pot or button event (called from IPC thread).
    void enqueuePot(uint8_t channel, float value);
    void enqueueButton(uint8_t gpio_pin, bool pressed);

    // Flush queued events then write one audio block (called from audio thread).
    // Returns false on write error.
    bool writeBlock(const float* in_buf, size_t frames);

    // Close the file cleanly (writes END record).
    void stop();

    bool active() const { return active_.load(std::memory_order_relaxed); }
    uint32_t blockCount() const { return block_count_.load(std::memory_order_relaxed); }

private:
    int      fd_{-1};
    uint32_t block_size_{0};
    std::atomic<bool>     active_{false};
    std::atomic<uint32_t> block_count_{0};

    std::mutex               queue_mutex_;
    std::vector<PendingEvent> pending_;

    bool writeBytes(const void* data, size_t n);
    void flushPending();
};

}  // namespace daisy_emu
