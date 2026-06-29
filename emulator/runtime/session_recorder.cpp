#include "session_recorder.h"
#include <chrono>
#include <cstring>
#include <fcntl.h>
#include <thread>
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
    audio_write_idx_.store(0);
    audio_read_idx_.store(0);
    pending_.clear();

    // Pre-allocate audio ring-buffer slots so enqueueBlock() never calls malloc.
    audio_slots_.resize(kAudioSlotCount);
    frames_in_slot_.resize(kAudioSlotCount, 0);
    for (auto& slot : audio_slots_)
        slot.resize(kMaxFramesPerSlot * 2);  // stereo interleaved

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
    drain_thread_ = std::thread(&SessionRecorder::drainLoop, this);
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

bool SessionRecorder::enqueueBlock(const float* in_buf, size_t frames) {
    if (!active_.load(std::memory_order_relaxed)) return false;
    if (frames > kMaxFramesPerSlot) return false;  // slot too small — drop

    size_t w    = audio_write_idx_.load(std::memory_order_relaxed);
    size_t next = (w + 1) % kAudioSlotCount;
    if (next == audio_read_idx_.load(std::memory_order_acquire)) return false;  // full

    std::memcpy(audio_slots_[w].data(), in_buf, frames * 2 * sizeof(float));
    frames_in_slot_[w] = frames;
    audio_write_idx_.store(next, std::memory_order_release);
    block_count_.fetch_add(1, std::memory_order_relaxed);
    return true;
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

void SessionRecorder::drainLoop() {
    // Drain all enqueued audio blocks. Continues until active_ is false AND the
    // ring buffer is empty (all blocks written by the RT thread are flushed).
    while (true) {
        size_t r = audio_read_idx_.load(std::memory_order_relaxed);
        size_t w = audio_write_idx_.load(std::memory_order_acquire);

        if (r == w) {
            // Ring buffer is empty.
            if (!active_.load(std::memory_order_relaxed)) break;  // recording stopped
            std::this_thread::sleep_for(std::chrono::microseconds(500));
            continue;
        }

        // Flush pending pot/button events before this audio block (preserves
        // the .dsrec ordering: events precede the block they were recorded with).
        flushPending();

        size_t frames = frames_in_slot_[r];
        uint8_t type = kRecTypeAudioBlock;
        writeBytes(&type, 1);
        writeBytes(audio_slots_[r].data(), frames * 2 * sizeof(float));
        audio_read_idx_.store((r + 1) % kAudioSlotCount, std::memory_order_release);
    }

    // Flush any final pot/button events that arrived after the last audio block.
    flushPending();

    // Write END marker and close file (FR-RTS-1: all I/O off the RT thread).
    uint8_t end = kRecTypeEnd;
    writeBytes(&end, 1);
    ::close(fd_);
    fd_ = -1;
}

void SessionRecorder::stop() {
    if (!active_.load(std::memory_order_relaxed)) return;
    active_.store(false, std::memory_order_release);
    if (drain_thread_.joinable())
        drain_thread_.join();
    // fd_ is closed and reset to -1 by drainLoop().
}

}  // namespace daisy_emu
