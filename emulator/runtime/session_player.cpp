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
            uint32_t frames = block_size_;
            if (version_ >= kRecMagicVersion) {
                uint8_t c[4];
                if (::read(fd_, c, 4) != 4) break;
                frames = static_cast<uint32_t>(c[0]) | (static_cast<uint32_t>(c[1]) << 8)
                       | (static_cast<uint32_t>(c[2]) << 16) | (static_cast<uint32_t>(c[3]) << 24);
            }
            if (::lseek(fd_, static_cast<off_t>(static_cast<size_t>(frames) * 2 * sizeof(float)), SEEK_CUR) < 0)
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
    if (header[6] != kRecMagicVersion && header[6] != kRecVersionLegacy) {
        ::close(fd_); fd_ = -1; return false;
    }
    version_ = header[6];

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

    // Pre-allocate every ring so neither thread ever resizes one, and the RT
    // thread's popBlock() touches nothing but fixed-capacity storage.
    stream_.assign(kStreamFrames * 2, 0.f);
    events_.assign(kMarkerSlots, PositionedEvent{});
    block_ends_.assign(kMarkerSlots, 0);
    stream_w_.store(0, std::memory_order_relaxed);
    stream_r_.store(0, std::memory_order_relaxed);
    events_w_.store(0, std::memory_order_relaxed);
    events_r_.store(0, std::memory_order_relaxed);
    block_ends_w_.store(0, std::memory_order_relaxed);
    block_ends_r_.store(0, std::memory_order_relaxed);
    reader_done_.store(false, std::memory_order_relaxed);

    done_.store(false, std::memory_order_release);
    reader_stop_.store(false, std::memory_order_relaxed);
    reader_thread_ = std::thread(&SessionPlayer::readerLoop, this);

    return true;
}

bool SessionPlayer::readNextBlockBlocking(float* buf, size_t& frames_out, std::vector<ReplayEvent>& events_out) {
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
            size_t frames = block_size_;
            if (version_ >= kRecMagicVersion) {
                uint8_t c[4];
                if (!readBytes(c, 4)) return false;
                frames = static_cast<size_t>(c[0]) | (static_cast<size_t>(c[1]) << 8)
                       | (static_cast<size_t>(c[2]) << 16) | (static_cast<size_t>(c[3]) << 24);
                // A corrupt count must not overrun the slot (or stall on a huge read).
                if (frames == 0 || frames > kMaxFramesPerSlot) return false;
            }
            if (!readBytes(buf, frames * 2 * sizeof(float)))
                return false;
            frames_out = frames;
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
    std::vector<float>       tmp(kMaxFramesPerSlot * 2);
    std::vector<ReplayEvent> events;
    uint64_t                 pos = 0;  // frames published so far

    auto waitForRoom = [this](auto&& has_room) {
        while (!reader_stop_.load(std::memory_order_relaxed)) {
            if (has_room()) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        return false;
    };

    while (!reader_stop_.load(std::memory_order_relaxed)) {
        size_t frames = 0;
        if (!readNextBlockBlocking(tmp.data(), frames, events)) break;  // EOF / error

        // Events queued before this record fire when its first frame is read.
        size_t ne = std::min(events.size(), kMaxEventsPerSlot);
        for (size_t i = 0; i < ne; ++i) {
            if (!waitForRoom([&] {
                    return (events_w_.load(std::memory_order_relaxed) + 1) % kMarkerSlots
                           != events_r_.load(std::memory_order_acquire);
                })) goto finished;
            size_t w = events_w_.load(std::memory_order_relaxed);
            events_[w] = PositionedEvent{ pos, events[i] };
            events_w_.store((w + 1) % kMarkerSlots, std::memory_order_release);
        }

        // Record boundary (for blocksRead()).
        if (!waitForRoom([&] {
                return (block_ends_w_.load(std::memory_order_relaxed) + 1) % kMarkerSlots
                       != block_ends_r_.load(std::memory_order_acquire);
            })) goto finished;
        {
            size_t w = block_ends_w_.load(std::memory_order_relaxed);
            block_ends_[w] = pos + frames;
            block_ends_w_.store((w + 1) % kMarkerSlots, std::memory_order_release);
        }

        // Audio, copied in as ring space frees up.
        for (size_t off = 0; off < frames;) {
            uint64_t w = stream_w_.load(std::memory_order_relaxed);
            uint64_t r = stream_r_.load(std::memory_order_acquire);
            size_t free_frames = kStreamFrames - static_cast<size_t>(w - r);
            if (free_frames == 0) {
                if (!waitForRoom([&] {
                        return stream_w_.load(std::memory_order_relaxed)
                               - stream_r_.load(std::memory_order_acquire) < kStreamFrames;
                    })) goto finished;
                continue;
            }
            size_t n     = std::min(free_frames, frames - off);
            size_t start = static_cast<size_t>(w % kStreamFrames);
            size_t first = std::min(n, kStreamFrames - start);
            std::memcpy(stream_.data() + start * 2, tmp.data() + off * 2, first * 2 * sizeof(float));
            if (n > first)
                std::memcpy(stream_.data(), tmp.data() + (off + first) * 2, (n - first) * 2 * sizeof(float));
            stream_w_.store(w + n, std::memory_order_release);
            off += n;
        }
        pos += frames;
    }
finished:
    reader_done_.store(true, std::memory_order_release);
}

bool SessionPlayer::popBlock(float* buf, size_t frames,
                              ReplayEvent* events_out, size_t max_events, size_t& n_events) {
    n_events = 0;
    if (done_.load(std::memory_order_acquire)) return false;

    const uint64_t r = stream_r_.load(std::memory_order_relaxed);
    uint64_t       w = stream_w_.load(std::memory_order_acquire);
    size_t         avail = static_cast<size_t>(w - r);

    if (avail < frames) {
        if (!reader_done_.load(std::memory_order_acquire)) {
            // The reader hasn't produced enough yet. Serve a request that fits
            // the ring all-or-nothing (transient — nothing consumed, so a
            // starved pop can never punch silence into the stream); only an
            // oversized request, which the ring can never hold, is served
            // with whatever is there.
            if (frames <= kStreamFrames || avail == 0) return false;
        } else {
            // Reader finished: pick up anything it published before flagging done.
            w     = stream_w_.load(std::memory_order_acquire);
            avail = static_cast<size_t>(w - r);
            if (avail == 0) {
                done_.store(true, std::memory_order_release);
                return false;
            }
        }
    }

    const size_t n     = std::min(avail, frames);
    const size_t start = static_cast<size_t>(r % kStreamFrames);
    const size_t first = std::min(n, kStreamFrames - start);
    std::memcpy(buf, stream_.data() + start * 2, first * 2 * sizeof(float));
    if (n > first)
        std::memcpy(buf + first * 2, stream_.data(), (n - first) * 2 * sizeof(float));
    // FR-EMU-1: zero-fill the unread tail when the recording ends mid-request,
    // so stale samples from whatever the caller's buffer previously held never
    // leak into replay output.
    if (n < frames)
        std::memset(buf + n * 2, 0, (frames - n) * 2 * sizeof(float));
    stream_r_.store(r + n, std::memory_order_release);

    // Events that precede a record this pop just started reading.
    size_t er = events_r_.load(std::memory_order_relaxed);
    const size_t ew = events_w_.load(std::memory_order_acquire);
    while (er != ew && n_events < max_events && events_[er].pos < r + n) {
        events_out[n_events++] = events_[er].ev;
        er = (er + 1) % kMarkerSlots;
    }
    events_r_.store(er, std::memory_order_release);

    // Records now fully consumed.
    size_t br = block_ends_r_.load(std::memory_order_relaxed);
    const size_t bw = block_ends_w_.load(std::memory_order_acquire);
    while (br != bw && block_ends_[br] <= r + n) {
        blocks_read_.fetch_add(1, std::memory_order_relaxed);
        br = (br + 1) % kMarkerSlots;
    }
    block_ends_r_.store(br, std::memory_order_release);
    return true;
}

void SessionPlayer::close() {
    reader_stop_.store(true, std::memory_order_relaxed);
    if (reader_thread_.joinable()) reader_thread_.join();
    if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
    done_.store(true, std::memory_order_release);
}

}  // namespace daisy_emu
