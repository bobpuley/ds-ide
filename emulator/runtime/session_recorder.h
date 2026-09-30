#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace daisy_emu {

// ---- .dsrec binary format ---------------------------------------------------
//
// Header (16 bytes):
//   [0..5]   magic:       "DSREC\0"  (6 bytes)
//   [6]      version:     0x02 (0x01 files are still read; see below)
//   [7]      reserved:    0x00
//   [8..11]  sample_rate: uint32 LE
//   [12..15] block_size:  uint32 LE   (the effect's configured block size —
//                                      informational; audio records carry
//                                      their own frame count in v2)
//
// Records (variable-length, repeat until EOF):
//   [0]      type: uint8
//     0x01  AUDIO_BLOCK   v2 payload: uint32 LE frames + float32[frames*2]
//                         (stereo interleaved input, LE)
//                         v1 payload: float32[block_size*2] — every block was
//                         assumed to be exactly block_size frames, which is
//                         wrong whenever the audio device delivers a different
//                         (or varying) callback size, so replay of such a
//                         recording was misaligned. v2 fixes that.
//     0x02  POT_EVENT     payload: uint8 channel + float32 value LE         (5 bytes)
//     0x03  BUTTON_EVENT  payload: uint8 gpio_pin + uint8 pressed (0|1)     (2 bytes)
//     0xFF  END           payload: none (marks clean end-of-file)
//
// Events that occur between block N and block N+1 are stored immediately
// before the block N+1 record, so replay fires them before processing that block.

static constexpr uint8_t kRecMagicVersion  = 0x02;  // version this build writes
static constexpr uint8_t kRecVersionLegacy = 0x01;  // still accepted by SessionPlayer
static constexpr uint8_t kRecTypeAudioBlock  = 0x01;
static constexpr uint8_t kRecTypePotEvent    = 0x02;
static constexpr uint8_t kRecTypeButtonEvent = 0x03;
static constexpr uint8_t kRecTypeEnd         = 0xFF;

// Pending event queued by IPC thread; flushed to file by drain thread (FR-RTS-1).
struct PendingEvent {
    uint8_t type;
    uint8_t channel_or_pin;
    float   value;      // used for POT_EVENT
    uint8_t pressed;    // used for BUTTON_EVENT
};

class SessionRecorder {
public:
    // Pre-allocates the audio ring buffer once, for the lifetime of the
    // object (FR-RTS-4) — start() never resizes it.
    SessionRecorder();

    // FR-EMU-8: calls stop() so a joinable drain_thread_ is always joined
    // (never std::terminate()s) and any in-progress recording is flushed
    // with a proper END marker before the object is destroyed.
    ~SessionRecorder();

    // Open file and write header, then start the drain thread. Returns true
    // on success.
    bool start(const std::string& path, uint32_t sample_rate, uint32_t block_size);

    // Enqueue a pot or button event (called from IPC thread).
    void enqueuePot(uint8_t channel, float value);
    void enqueueButton(uint8_t gpio_pin, bool pressed);

    // RT-safe: enqueue one stereo audio block into the SPSC ring buffer.
    // Returns false if the ring buffer is full (block is dropped) or
    // if the slot capacity is exceeded by the given frame count.
    // Does NOT call ::write() or acquire any mutex — safe for the RT thread (FR-RTS-1).
    bool enqueueBlock(const float* in_buf, size_t frames);

    // Signal the drain thread to finish flushing and close the file.
    // Blocks until the drain thread has written all remaining data.
    void stop();

    bool active() const { return active_.load(std::memory_order_relaxed); }
    uint32_t blockCount() const { return block_count_.load(std::memory_order_relaxed); }

    // FR-EMU-4: true once a writeBytes() failure (ENOSPC, EIO, ...) has been
    // observed in flushPending()/drainLoop() for the current (or most recent)
    // session. Reset to false at the start of each start().
    bool hasWriteError() const { return write_error_.load(std::memory_order_relaxed); }

private:
    // Maximum frames per audio slot. Pre-allocated at start() time so
    // the RT thread never calls resize(). 8192 frames covers all practical
    // hardware buffer sizes (typical max is 4096).
    static constexpr size_t kMaxFramesPerSlot = 8192;
    // Number of SPSC ring-buffer slots. 64 slots at 8192 frames × 2 ch × 4 B = 4 MB.
    static constexpr size_t kAudioSlotCount   = 64;

    int      fd_{-1};
    uint32_t block_size_{0};
    std::atomic<bool>     active_{false};
    std::atomic<uint32_t> block_count_{0};
    // FR-EMU-4: set by flushPending()/drainLoop() on the first writeBytes()
    // failure; drainLoop() stops draining (closing the fd) once this is set,
    // instead of silently continuing to "write" and producing a truncated
    // file that looks like a clean recording.
    std::atomic<bool>     write_error_{false};
    // Number of enqueueBlock() calls currently executing (FR-RTS-4). The drain
    // thread will not consider itself done (and close the file) until this
    // reaches zero after active_ goes false, closing the stop/start overlap
    // window: no in-flight write can land after the file is closed, and no
    // in-flight write can be misattributed to a subsequent start() either,
    // since stop() cannot return (and unblock a new start()) until drainLoop
    // — which waits on this same counter — has exited.
    std::atomic<uint32_t> in_flight_{0};

    // Pot/button event queue (IPC thread → drain thread)
    std::mutex               queue_mutex_;
    std::vector<PendingEvent> pending_;

    // Audio block SPSC ring buffer (RT thread pushes, drain thread pops).
    // Pre-allocated in start() so enqueueBlock() never calls new/malloc.
    std::vector<std::vector<float>> audio_slots_;    // kAudioSlotCount × kMaxFramesPerSlot*2
    std::vector<size_t>             frames_in_slot_; // actual frame count for each slot
    std::atomic<size_t>             audio_write_idx_{0};
    std::atomic<size_t>             audio_read_idx_{0};

    // Drain thread — started in start(), joined in stop().
    std::thread drain_thread_;

    bool writeBytes(const void* data, size_t n);
    void flushPending();
    void drainLoop();
};

}  // namespace daisy_emu
