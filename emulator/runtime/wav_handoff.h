#pragma once
// FR-RTS-6: hand-off of WAV input buffers from the IPC thread to the audio
// thread without use-after-free.
//
// A hazard-pointer scheme with one reader (the audio thread) and one writer
// (the IPC-dispatch thread):
//   - the reader *publishes* the pointer it is about to read in
//     g_state.wav_data_in_use and re-checks that it is still the current one
//     (wav_reader_acquire); it clears the slot after the block
//     (wav_reader_release);
//   - the writer swaps in the new buffer and frees an old one only after
//     seeing that the reader is not using it. A buffer still in use after the
//     wait budget is kept on a retire list — never freed on a timeout — and
//     reclaimed on a later retire, or at shutdown once the reader has stopped.
// All operations on the two pointers are seq_cst: the scheme needs the
// reader's "publish, then re-read" and the writer's "swap, then check" to be
// totally ordered, which acquire/release alone does not give.

#include "emulator_state.h"

#include <chrono>
#include <thread>
#include <vector>

namespace daisy_emu {

// Audio thread only. Returns the current WAV buffer (or null), safe to read
// until wav_reader_release(). RT-safe: atomics only; the retry loop runs again
// only if a swap lands between the publish and the re-check.
inline const WavData* wav_reader_acquire() {
    for (;;) {
        const WavData* p = g_state.wav_data_ptr.load(std::memory_order_seq_cst);
        g_state.wav_data_in_use.store(p, std::memory_order_seq_cst);
        if (p == g_state.wav_data_ptr.load(std::memory_order_seq_cst)) return p;
    }
}

// Audio thread only: the block that read the buffer is done.
inline void wav_reader_release() {
    g_state.wav_data_in_use.store(nullptr, std::memory_order_seq_cst);
}

// IPC thread only (single writer). Not RT: may sleep and allocate.
class WavRetirer {
public:
    explicit WavRetirer(std::chrono::milliseconds wait_budget = std::chrono::milliseconds(200))
        : wait_budget_(wait_budget) {}

    WavRetirer(const WavRetirer&) = delete;
    WavRetirer& operator=(const WavRetirer&) = delete;

    // Publishes `next` (may be null) as the active WAV and retires the old one.
    void publish(const WavData* next) {
        const WavData* old = g_state.wav_data_ptr.exchange(next, std::memory_order_seq_cst);
        if (old) retired_.push_back(old);
        reclaim(wait_budget_);
    }

    // Frees every retired buffer the reader is not using, waiting up to
    // `budget` in total for buffers still in use; those stay on the list.
    void reclaim(std::chrono::milliseconds budget) {
        const auto deadline = std::chrono::steady_clock::now() + budget;
        for (size_t i = 0; i < retired_.size();) {
            const WavData* r = retired_[i];
            while (in_use(r) && std::chrono::steady_clock::now() < deadline)
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            if (in_use(r)) { ++i; continue; }
            delete r;
            retired_[i] = retired_.back();
            retired_.pop_back();
        }
    }

    // Only once the reader can no longer run (audio thread joined).
    void reclaim_all_after_reader_stopped() {
        for (const WavData* r : retired_) delete r;
        retired_.clear();
    }

    size_t pending() const { return retired_.size(); }

private:
    static bool in_use(const WavData* r) {
        return g_state.wav_data_in_use.load(std::memory_order_seq_cst) == r;
    }

    std::chrono::milliseconds wait_budget_;
    std::vector<const WavData*> retired_;
};

}  // namespace daisy_emu
