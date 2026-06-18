#include "session_recorder.h"
#include <cstring>
#include <fcntl.h>
#include <unistd.h>

namespace daisy_emu {

bool SessionRecorder::writeBytes(const void* data, size_t n) {
    const uint8_t* p = static_cast<const uint8_t*>(data);
    size_t written = 0;
    while (written < n) {
        ssize_t r = ::write(fd_, p + written, n - written);
        if (r <= 0) return false;
        written += static_cast<size_t>(r);
    }
    return true;
}

bool SessionRecorder::start(const std::string& path,
                             uint32_t sample_rate, uint32_t block_size) {
    fd_ = ::open(path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd_ < 0) return false;

    block_size_  = block_size;
    block_count_.store(0);
    pending_.clear();

    // Header
    uint8_t header[16] = {};
    static const char magic[6] = "DSREC";
    std::memcpy(header, magic, 6);
    header[6] = kRecMagicVersion;
    header[7] = 0x00;
    // sample_rate LE
    header[8]  = static_cast<uint8_t>(sample_rate & 0xFF);
    header[9]  = static_cast<uint8_t>((sample_rate >> 8) & 0xFF);
    header[10] = static_cast<uint8_t>((sample_rate >> 16) & 0xFF);
    header[11] = static_cast<uint8_t>((sample_rate >> 24) & 0xFF);
    // block_size LE
    header[12] = static_cast<uint8_t>(block_size & 0xFF);
    header[13] = static_cast<uint8_t>((block_size >> 8) & 0xFF);
    header[14] = static_cast<uint8_t>((block_size >> 16) & 0xFF);
    header[15] = static_cast<uint8_t>((block_size >> 24) & 0xFF);

    if (!writeBytes(header, 16)) { ::close(fd_); fd_ = -1; return false; }

    active_.store(true, std::memory_order_release);
    return true;
}

void SessionRecorder::enqueuePot(uint8_t channel, float value) {
    std::lock_guard<std::mutex> lk(queue_mutex_);
    pending_.push_back({ kRecTypePotEvent, channel, value, 0 });
}

void SessionRecorder::enqueueButton(uint8_t gpio_pin, bool pressed) {
    std::lock_guard<std::mutex> lk(queue_mutex_);
    pending_.push_back({ kRecTypeButtonEvent, gpio_pin, 0.f,
                         static_cast<uint8_t>(pressed ? 1 : 0) });
}

void SessionRecorder::flushPending() {
    std::vector<PendingEvent> batch;
    {
        std::lock_guard<std::mutex> lk(queue_mutex_);
        batch.swap(pending_);
    }
    for (const auto& ev : batch) {
        uint8_t type = ev.type;
        writeBytes(&type, 1);
        if (ev.type == kRecTypePotEvent) {
            uint8_t payload[5];
            payload[0] = ev.channel_or_pin;
            std::memcpy(payload + 1, &ev.value, 4);
            writeBytes(payload, 5);
        } else if (ev.type == kRecTypeButtonEvent) {
            uint8_t payload[2] = { ev.channel_or_pin, ev.pressed };
            writeBytes(payload, 2);
        }
    }
}

bool SessionRecorder::writeBlock(const float* in_buf, size_t frames) {
    if (!active_.load(std::memory_order_relaxed)) return false;

    flushPending();

    uint8_t type = kRecTypeAudioBlock;
    if (!writeBytes(&type, 1)) return false;
    if (!writeBytes(in_buf, frames * 2 * sizeof(float))) return false;

    block_count_.fetch_add(1, std::memory_order_relaxed);
    return true;
}

void SessionRecorder::stop() {
    if (!active_.load(std::memory_order_relaxed)) return;
    active_.store(false, std::memory_order_release);

    flushPending();
    uint8_t end = kRecTypeEnd;
    writeBytes(&end, 1);
    ::close(fd_);
    fd_ = -1;
}

}  // namespace daisy_emu
