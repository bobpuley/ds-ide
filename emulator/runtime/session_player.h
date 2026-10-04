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
// parsing, decoding the recording ahead of playback into a lock-free SPSC
// ring of *frames* (FR-RTS-3) — the mirror image of SessionRecorder's
// write-side ring: the reader thread produces, the RT thread only pops
// pre-decoded audio via popBlock(), which performs no syscalls, no mutex,
// and no heap allocation.
//
// The ring is a continuous sample stream, not a queue of recorded blocks:
// recorded block sizes (which follow the audio device's callback size) need
// not match the size popBlock() is asked for. Events and record boundaries
// travel alongside as frame positions in two small SPSC rings.
class SessionPlayer {
public:
    // Largest recorded block a record may declare / a v1 header may state
    // (AC-47: rejected above 65536).
    static constexpr size_t kMaxFramesPerSlot = 65536;
    // Capacity of the decoded-frame ring. Requests up to this size are
    // served all-or-nothing; larger requests are served partially.
    static constexpr size_t kStreamFrames     = 32768;
    // Cap on pot/button events delivered by one popBlock() call. Events
    // beyond it stay queued for the next call.
    static constexpr size_t kMaxEventsPerSlot = 32;
    // Capacity of the event and record-boundary rings (reader waits when full).
    static constexpr size_t kMarkerSlots      = 512;

    SessionPlayer() = default;
    ~SessionPlayer();

    // Open file, validate header, and start the background reader thread that
    // decodes the recording ahead of playback. Returns true on success.
    // Fills out sample_rate and block_size from the header.
    bool open(const std::string& path,
              uint32_t& out_sample_rate,
              uint32_t& out_block_size);

    // RT-safe: pop exactly `frames` frames of the recording (no I/O, no
    // mutex, no heap allocation) — safe to call from the CoreAudio render
    // callback (FR-RTS-3). The recording is one continuous sample stream, so
    // the frames are taken across recorded-block boundaries whatever block
    // size the recording used. Events queued before a recorded block are
    // delivered (into events_out, capacity max_events; count in n_events)
    // with the pop that first reads that block. If the recording ends
    // mid-request the rest of buf is zero-filled and the call still returns
    // true. Returns false when the reader thread has not yet produced enough
    // data (transient — nothing is consumed; call again on the next block)
    // or when playback has reached end-of-file; use done() to tell the two
    // apart.
    bool popBlock(float* buf, size_t frames,
                  ReplayEvent* events_out, size_t max_events, size_t& n_events);

    bool done() const  { return done_.load(std::memory_order_acquire); }
    // Recorded blocks fully consumed by the RT thread so far.
    uint32_t blocksRead() const { return blocks_read_.load(std::memory_order_relaxed); }
    uint32_t totalBlocks() const { return total_blocks_; }

    // Stops the reader thread (if running), joins it, and closes the file.
    // Not RT-safe — call only from non-RT threads (IPC / engine-management).
    void close();

private:
    int      fd_{-1};
    uint32_t block_size_{0};
    uint8_t  version_{0};        // .dsrec version of the open file (1 or 2)
    uint32_t total_blocks_{0};
    std::atomic<bool>     done_{true};          // observed by popBlock() callers
    std::atomic<uint32_t> blocks_read_{0};       // recorded blocks fully consumed by the RT thread

    bool readBytes(void* dst, size_t n);

    // Pre-scan to count total blocks (for progress reporting). Reader-thread-only.
    void countBlocks(long long data_start_offset);

    // Blocking decode of one AUDIO_BLOCK record (block_size_ frames in v1, the
    // record's own frame count in v2; stored in frames_out) plus any events
    // queued before it. Reader-thread-only — never called from the RT thread.
    bool readNextBlockBlocking(float* buf, size_t& frames_out, std::vector<ReplayEvent>& events_out);

    // ---- Reader-thread → RT-thread rings (FR-RTS-3) ----
    // Frame positions are absolute (frames since the start of the recording).
    struct PositionedEvent { uint64_t pos; ReplayEvent ev; };

    std::vector<float>          stream_;          // kStreamFrames*2 floats, stereo interleaved
    std::atomic<uint64_t>       stream_w_{0};     // frames written (reader thread only)
    std::atomic<uint64_t>       stream_r_{0};     // frames read (RT thread only)
    std::atomic<bool>           reader_done_{false};

    std::vector<PositionedEvent> events_;         // kMarkerSlots
    std::atomic<size_t>          events_w_{0};    // reader thread only
    std::atomic<size_t>          events_r_{0};    // RT thread only
    std::vector<uint64_t>        block_ends_;     // kMarkerSlots: end frame of each record
    std::atomic<size_t>          block_ends_w_{0};
    std::atomic<size_t>          block_ends_r_{0};

    std::thread              reader_thread_;
    std::atomic<bool>        reader_stop_{false};

    void readerLoop();
};

}  // namespace daisy_emu
