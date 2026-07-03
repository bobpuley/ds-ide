#include "session_player.h"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

namespace daisy_emu {

SessionPlayer::~SessionPlayer() {
    close();
}

bool SessionPlayer::readBytes(void* dst, size_t n) {
    uint8_t* p = static_cast<uint8_t*>(dst);
    size_t total = 0;
    while (total < n) {
        ssize_t r = ::read(fd_, p + total, n - total);
        if (r <= 0) return false;
        total += static_cast<size_t>(r);
    }
    return true;
}

void SessionPlayer::countBlocks(long data_start_offset) {
    total_blocks_ = 0;
    long pos = ::lseek(fd_, 0, SEEK_CUR);
    if (pos < 0 || ::lseek(fd_, data_start_offset, SEEK_SET) < 0) return;  // AC-47

    uint8_t type;
    while (::read(fd_, &type, 1) == 1) {
        if (type == kRecTypeAudioBlock) {
            ++total_blocks_;
            if (::lseek(fd_, static_cast<off_t>(block_size_ * 2 * sizeof(float)), SEEK_CUR) < 0)
                break;
        } else if (type == kRecTypePotEvent) {
            if (::lseek(fd_, 5, SEEK_CUR) < 0) break;
        } else if (type == kRecTypeButtonEvent) {
            if (::lseek(fd_, 2, SEEK_CUR) < 0) break;
        } else {
            break;  // END or unknown
        }
    }
    ::lseek(fd_, pos, SEEK_SET);
}

bool SessionPlayer::open(const std::string& path,
                          uint32_t& out_sample_rate,
                          uint32_t& out_block_size) {
    close();  // stop any previous reader thread and close any previous fd

    fd_ = ::open(path.c_str(), O_RDONLY);
    if (fd_ < 0) return false;

    uint8_t header[16];
    if (!readBytes(header, 16)) { ::close(fd_); fd_ = -1; return false; }

    // Validate magic
    if (std::memcmp(header, "DSREC", 5) != 0 || header[5] != '\0') {
        ::close(fd_); fd_ = -1; return false;
    }
    if (header[6] != kRecMagicVersion) { ::close(fd_); fd_ = -1; return false; }

    out_sample_rate = static_cast<uint32_t>(header[8])
                    | (static_cast<uint32_t>(header[9])  << 8)
                    | (static_cast<uint32_t>(header[10]) << 16)
                    | (static_cast<uint32_t>(header[11]) << 24);
    out_block_size  = static_cast<uint32_t>(header[12])
                    | (static_cast<uint32_t>(header[13]) << 8)
                    | (static_cast<uint32_t>(header[14]) << 16)
                    | (static_cast<uint32_t>(header[15]) << 24);

    if (out_block_size == 0 || out_block_size > kMaxFramesPerSlot) {  // AC-47
        ::close(fd_); fd_ = -1; return false;
    }
    block_size_  = out_block_size;
    blocks_read_.store(0, std::memory_order_relaxed);

    long data_start = ::lseek(fd_, 0, SEEK_CUR);
    if (data_start < 0) { ::close(fd_); fd_ = -1; return false; }  // AC-47
    countBlocks(data_start);
    if (::lseek(fd_, data_start, SEEK_SET) < 0) { ::close(fd_); fd_ = -1; return false; }  // AC-47

    // Pre-allocate the ring so the reader thread never resizes it, and the RT
    // thread's popBlock() never touches anything but fixed-capacity slots.
    ring_.assign(kRingSlots, DecodedSlot{});
    for (auto& slot : ring_) slot.audio.assign(kMaxFramesPerSlot * 2, 0.f);
    ring_write_.store(0, std::memory_order_relaxed);
    ring_read_.store(0, std::memory_order_relaxed);

    done_.store(false, std::memory_order_release);
    reader_stop_.store(false, std::memory_order_relaxed);
    reader_thread_ = std::thread(&SessionPlayer::readerLoop, this);

    return true;
}

bool SessionPlayer::readNextBlockBlocking(float* buf, std::vector<ReplayEvent>& events_out) {
    events_out.clear();
    uint8_t type;

    // Read events + one AUDIO_BLOCK
    while (true) {
        ssize_t r = ::read(fd_, &type, 1);
        if (r != 1) return false;

        if (type == kRecTypePotEvent) {
            uint8_t payload[5];
            if (!readBytes(payload, 5)) return false;
            float val;
            std::memcpy(&val, payload + 1, 4);
            events_out.push_back({ kRecTypePotEvent, payload[0], val, 0 });

        } else if (type == kRecTypeButtonEvent) {
            uint8_t payload[2];
            if (!readBytes(payload, 2)) return false;
            events_out.push_back({ kRecTypeButtonEvent, payload[0], 0.f, payload[1] });

        } else if (type == kRecTypeAudioBlock) {
            if (!readBytes(buf, static_cast<size_t>(block_size_) * 2 * sizeof(float)))
                return false;
            return true;

        } else {
            // END or unknown — end of stream.
            return false;
        }
    }
}

void SessionPlayer::readerLoop() {
    // Reused across iterations — heap allocation here is fine (reader thread,
    // never the RT thread).
    std::vector<ReplayEvent> events;

    while (!reader_stop_.load(std::memory_order_relaxed)) {
        size_t w    = ring_write_.load(std::memory_order_relaxed);
        size_t next = (w + 1) % kRingSlots;
        if (next == ring_read_.load(std::memory_order_acquire)) {
            // Ring full — the RT thread hasn't caught up yet.
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
            continue;
        }

        DecodedSlot& slot = ring_[w];
        bool ok = readNextBlockBlocking(slot.audio.data(), events);
        if (!ok) {
            slot.eof      = true;
            slot.frames   = 0;
            slot.n_events = 0;
            ring_write_.store(next, std::memory_order_release);
            return;  // end of file / error — no more slots to produce
        }

        slot.eof    = false;
        slot.frames = block_size_;
        size_t ne   = std::min(events.size(), kMaxEventsPerSlot);
        for (size_t i = 0; i < ne; ++i) slot.events[i] = events[i];
        slot.n_events = ne;

        ring_write_.store(next, std::memory_order_release);
    }
}

bool SessionPlayer::popBlock(float* buf, size_t frames,
                              ReplayEvent* events_out, size_t max_events, size_t& n_events) {
    n_events = 0;
    if (done_.load(std::memory_order_acquire)) return false;

    size_t r = ring_read_.load(std::memory_order_relaxed);
    size_t w = ring_write_.load(std::memory_order_acquire);
    if (r == w) return false;  // reader hasn't produced the next block yet — transient

    DecodedSlot& slot = ring_[r];
    if (slot.eof) {
        ring_read_.store((r + 1) % kRingSlots, std::memory_order_release);
        done_.store(true, std::memory_order_release);
        return false;
    }

    size_t to_copy = std::min(frames, slot.frames);
    std::memcpy(buf, slot.audio.data(), to_copy * 2 * sizeof(float));

    size_t ne = std::min(slot.n_events, max_events);
    for (size_t i = 0; i < ne; ++i) events_out[i] = slot.events[i];
    n_events = ne;

    blocks_read_.fetch_add(1, std::memory_order_relaxed);
    ring_read_.store((r + 1) % kRingSlots, std::memory_order_release);
    return true;
}

void SessionPlayer::close() {
    reader_stop_.store(true, std::memory_order_relaxed);
    if (reader_thread_.joinable()) reader_thread_.join();
    if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
    done_.store(true, std::memory_order_release);
}

}  // namespace daisy_emu
