#pragma once
// BlockAdapter (FR-EMU-12): re-blocks the host audio device's callbacks so
// the effect is always called with exactly the configured block size, as on
// Daisy hardware, whatever frame count the device delivers.
//
// Each device callback appends its (interleaved stereo) input to an input
// FIFO, runs `process` once per complete block, appends each block's output
// to an output FIFO, and hands the device the oldest `frames` frames of
// output. The output FIFO starts primed with one block of silence, which
// guarantees it never runs dry: before each pop it holds
// `block - leftover_input + frames` frames. Latency added: at most one block.
//
// Real-time safety: configure() allocates (call it before the stream starts);
// run() and reset() never allocate, lock or block.

#include <algorithm>
#include <cstddef>
#include <cstring>
#include <vector>

namespace daisy_emu {

class BlockAdapter {
public:
    // Non-RT. `max_device_frames` is the largest callback the device may make.
    void configure(size_t block_frames, size_t max_device_frames) {
        block_ = std::max<size_t>(block_frames, 1);
        max_device_ = max_device_frames;
        in_fifo_.assign((max_device_ + block_) * 2, 0.f);
        out_fifo_.assign((max_device_ + 2 * block_) * 2, 0.f);
        in_block_.assign(block_ * 2, 0.f);
        out_block_.assign(block_ * 2, 0.f);
        reset();
    }

    // RT-safe. Drops buffered audio and re-primes one block of silence (e.g.
    // after the transport was stopped, so stale audio is not played later).
    void reset() {
        in_count_ = 0;
        std::fill(out_fifo_.begin(), out_fifo_.begin() + static_cast<std::ptrdiff_t>(block_ * 2), 0.f);
        out_count_ = block_;
    }

    size_t blockFrames() const { return block_; }
    size_t maxDeviceFrames() const { return max_device_; }

    // RT-safe. `dev_in` may be null (treated as silence). A callback larger
    // than maxDeviceFrames() is clamped and its tail zero-filled.
    // `process(in, out)` receives interleaved stereo blocks of exactly
    // blockFrames() frames; `out` is zeroed first.
    template <typename Process>
    void run(const float* dev_in, float* dev_out, size_t frames_in, Process&& process) {
        const size_t frames = std::min(frames_in, max_device_);
        if (frames_in > frames) std::fill(dev_out + frames * 2, dev_out + frames_in * 2, 0.f);
        if (dev_in) {
            std::memcpy(in_fifo_.data() + in_count_ * 2, dev_in, frames * 2 * sizeof(float));
        } else {
            std::fill(in_fifo_.begin() + static_cast<std::ptrdiff_t>(in_count_ * 2),
                      in_fifo_.begin() + static_cast<std::ptrdiff_t>((in_count_ + frames) * 2), 0.f);
        }
        in_count_ += frames;

        size_t consumed = 0;
        while (in_count_ - consumed >= block_) {
            std::memcpy(in_block_.data(), in_fifo_.data() + consumed * 2, block_ * 2 * sizeof(float));
            std::fill(out_block_.begin(), out_block_.end(), 0.f);
            process(static_cast<const float*>(in_block_.data()), out_block_.data());
            std::memcpy(out_fifo_.data() + out_count_ * 2, out_block_.data(), block_ * 2 * sizeof(float));
            out_count_ += block_;
            consumed += block_;
        }
        if (consumed > 0) {
            in_count_ -= consumed;
            std::memmove(in_fifo_.data(), in_fifo_.data() + consumed * 2, in_count_ * 2 * sizeof(float));
        }

        // Invariant above: out_count_ >= frames here.
        const size_t n = std::min(frames, out_count_);
        std::memcpy(dev_out, out_fifo_.data(), n * 2 * sizeof(float));
        if (n < frames) std::fill(dev_out + n * 2, dev_out + frames * 2, 0.f);
        out_count_ -= n;
        std::memmove(out_fifo_.data(), out_fifo_.data() + n * 2, out_count_ * 2 * sizeof(float));
    }

private:
    size_t block_{1};
    size_t max_device_{0};
    size_t in_count_{0};   // frames waiting in in_fifo_
    size_t out_count_{0};  // frames waiting in out_fifo_
    std::vector<float> in_fifo_, out_fifo_, in_block_, out_block_;
};

}  // namespace daisy_emu
