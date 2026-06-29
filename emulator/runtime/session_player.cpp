#include "session_player.h"
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

namespace daisy_emu {

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
    fd_ = ::open(path.c_str(), O_RDONLY);
    if (fd_ < 0) return false;

    uint8_t header[16];
    if (!readBytes(header, 16)) { close(); return false; }

    // Validate magic
    if (std::memcmp(header, "DSREC", 5) != 0 || header[5] != '\0') {
        close(); return false;
    }
    if (header[6] != kRecMagicVersion) { close(); return false; }

    out_sample_rate = static_cast<uint32_t>(header[8])
                    | (static_cast<uint32_t>(header[9])  << 8)
                    | (static_cast<uint32_t>(header[10]) << 16)
                    | (static_cast<uint32_t>(header[11]) << 24);
    out_block_size  = static_cast<uint32_t>(header[12])
                    | (static_cast<uint32_t>(header[13]) << 8)
                    | (static_cast<uint32_t>(header[14]) << 16)
                    | (static_cast<uint32_t>(header[15]) << 24);

    if (out_block_size == 0 || out_block_size > 65536) { close(); return false; }  // AC-47
    block_size_  = out_block_size;
    done_        = false;
    blocks_read_ = 0;

    long data_start = ::lseek(fd_, 0, SEEK_CUR);
    if (data_start < 0) { close(); return false; }  // AC-47
    countBlocks(data_start);
    if (::lseek(fd_, data_start, SEEK_SET) < 0) { close(); return false; }  // AC-47

    return true;
}

bool SessionPlayer::nextBlock(float* buf, size_t frames,
                               std::vector<ReplayEvent>& events_out) {
    if (done_ || fd_ < 0) return false;

    events_out.clear();
    uint8_t type;

    // Read events + one AUDIO_BLOCK
    while (true) {
        ssize_t r = ::read(fd_, &type, 1);
        if (r != 1) { done_ = true; return false; }

        if (type == kRecTypePotEvent) {
            uint8_t payload[5];
            if (!readBytes(payload, 5)) { done_ = true; return false; }
            float val;
            std::memcpy(&val, payload + 1, 4);
            events_out.push_back({ kRecTypePotEvent, payload[0], val, 0 });

        } else if (type == kRecTypeButtonEvent) {
            uint8_t payload[2];
            if (!readBytes(payload, 2)) { done_ = true; return false; }
            events_out.push_back({ kRecTypeButtonEvent, payload[0], 0.f, payload[1] });

        } else if (type == kRecTypeAudioBlock) {
            // Read frames*2 floats; if recorded block_size differs from frames, clamp
            size_t to_read = std::min(frames, static_cast<size_t>(block_size_));
            if (!readBytes(buf, to_read * 2 * sizeof(float))) {
                done_ = true; return false;
            }
            // If recorded block was larger, skip the remainder (AC-47: check lseek return).
            if (block_size_ > static_cast<uint32_t>(frames)) {
                size_t skip = (block_size_ - static_cast<uint32_t>(frames)) * 2 * sizeof(float);
                off_t pos = ::lseek(fd_, static_cast<off_t>(skip), SEEK_CUR);
                if (pos < 0) { done_ = true; return false; }  // AC-47: lseek error
            }
            ++blocks_read_;
            return true;

        } else {
            // END or unknown — mark done
            done_ = true;
            return false;
        }
    }
}

void SessionPlayer::close() {
    if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
    done_ = true;
}

}  // namespace daisy_emu
