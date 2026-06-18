#pragma once
#include "session_recorder.h"
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace daisy_emu {

// Event fired during replay (pot or button).
struct ReplayEvent {
    uint8_t type;           // kRecTypePotEvent or kRecTypeButtonEvent
    uint8_t channel_or_pin;
    float   value;
    uint8_t pressed;
};

class SessionPlayer {
public:
    // Open file and validate header. Returns true on success.
    // Fills out sample_rate and block_size from the header.
    bool open(const std::string& path,
              uint32_t& out_sample_rate,
              uint32_t& out_block_size);

    // Read the next block into buf (must be pre-allocated to block_size*2 floats).
    // Any events stored before this block are returned in events_out.
    // Returns true when a block was read; false when file is exhausted or on error.
    bool nextBlock(float* buf, size_t frames, std::vector<ReplayEvent>& events_out);

    bool done() const  { return done_; }
    uint32_t blocksRead() const { return blocks_read_; }
    uint32_t totalBlocks() const { return total_blocks_; }

    void close();

private:
    int      fd_{-1};
    bool     done_{true};
    uint32_t block_size_{0};
    uint32_t blocks_read_{0};
    uint32_t total_blocks_{0};

    bool readBytes(void* dst, size_t n);

    // Pre-scan to count total blocks (for progress reporting).
    void countBlocks(long data_start_offset);
};

}  // namespace daisy_emu
