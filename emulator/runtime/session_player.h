#pragma once
#include "session_recorder.h"
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>
#include <thread>
#include <vector>

namespace daisy_emu {

// Event fired during replay (pot or button).
struct ReplayEvent {
    uint8_t type;           // kRecTypePotEvent or kRecTypeButtonEvent
    uint8_t channel_or_pin;
    float   value;
    uint8_t pressed;
};

// SessionPlayer reads a .dsrec file and feeds it to the audio engine.
//
// A background reader thread performs all ::read()/::lseek() I/O and event
// parsing, decoding blocks ahead of playback into a lock-free SPSC ring
// (FR-RTS-3) — the mirror image of SessionRecorder's write-side ring: the
// reader thread produces, the RT thread only pops pre-decoded blocks via
// popBlock(), which performs no syscalls, no mutex, and no heap allocation.
class SessionPlayer {
public:
    // Ring sizing: kMaxFramesPerSlot matches SessionPlayer::open()'s validated
    // maximum recorded block_size (AC-47: rejected above 65536).
    static constexpr size_t kMaxFramesPerSlot = 65536;
    static constexpr size_t kRingSlots        = 4;
    // Cap on pot/button events queued between two audio blocks in one slot.
    // Generous for control-rate events; any excess in a single gap is dropped.
    static constexpr size_t kMaxEventsPerSlot = 32;

    SessionPlayer() = default;
    ~SessionPlayer();

    // Open file, validate header, and start the background reader thread that
    // decodes blocks ahead of playback into the ring. Returns true on success.
    // Fills out sample_rate and block_size from the header.
    bool open(const std::string& path,
              uint32_t& out_sample_rate,
              uint32_t& out_block_size);

    // RT-safe: pop the next pre-decoded block (no I/O, no mutex, no heap
    // allocation) — safe to call from the CoreAudio render callback (FR-RTS-3).
    // On success, copies min(frames, recorded block_size) floats into buf and
    // any queued events into events_out (capacity max_events; count in
    // n_events), and returns true. Returns false when the reader thread has
    // not yet produced the next block (transient — the ring is temporarily
    // empty; call again on the next block) or when playback has reached
    // end-of-file; use done() to tell the two apart.
    bool popBlock(float* buf, size_t frames,
                  ReplayEvent* events_out, size_t max_events, size_t& n_events);

    bool done() const  { return done_.load(std::memory_order_acquire); }
    uint32_t blocksRead() const { return blocks_read_.load(std::memory_order_relaxed); }
    uint32_t totalBlocks() const { return total_blocks_; }

    // Stops the reader thread (if running), joins it, and closes the file.
    // Not RT-safe — call only from non-RT threads (IPC / engine-management).
    void close();

private:
    int      fd_{-1};
    uint32_t block_size_{0};
    uint32_t total_blocks_{0};
    std::atomic<bool>     done_{true};          // observed by popBlock() callers
    std::atomic<uint32_t> blocks_read_{0};       // blocks actually popped by the RT thread

    bool readBytes(void* dst, size_t n);

    // Pre-scan to count total blocks (for progress reporting). Reader-thread-only.
    void countBlocks(long data_start_offset);

    // Blocking decode of exactly block_size_ frames plus any events queued
    // before them. Reader-thread-only — never called from the RT thread.
    bool readNextBlockBlocking(float* buf, std::vector<ReplayEvent>& events_out);

    // ---- Reader-thread → RT-thread ring buffer (FR-RTS-3) ----
    struct DecodedSlot {
        std::vector<float> audio;    // kMaxFramesPerSlot*2 floats, stereo interleaved
        size_t              frames{0};
        bool                eof{false};
        ReplayEvent          events[kMaxEventsPerSlot];
        size_t               n_events{0};
    };
    std::vector<DecodedSlot> ring_;
    std::atomic<size_t>      ring_write_{0};   // reader thread only
    std::atomic<size_t>      ring_read_{0};    // RT (popBlock) thread only
    std::thread              reader_thread_;
    std::atomic<bool>        reader_stop_{false};

    void readerLoop();
};

}  // namespace daisy_emu
