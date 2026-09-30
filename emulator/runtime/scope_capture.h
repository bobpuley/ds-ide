#pragma once
// Full-rate scope capture with a trigger scan (FR-SCI-14a).
//
// Owned and driven by the non-RT drain thread only (see run_audio_engine()): it
// is fed the same raw blocks the scope/spectrum accumulators get, so the RT
// callback is untouched. Not thread-safe by design — hand requests to the owner
// thread rather than locking here. All storage is allocated at construction.

#include <algorithm>
#include <cstddef>
#include <atomic>
#include <cstdint>
#include <mutex>
#include <vector>

class ScopeCapture {
public:
    static constexpr size_t kRingFrames   = 16384;  // per channel; power of two
    static constexpr size_t kWindowFrames = 4096;   // frames returned per capture
    static constexpr size_t kPreFrames    = 1024;   // frames before the trigger point

    enum class Source { In, OutL };
    enum class Edge   { Rise, Fall };

    struct Request {
        Source source{Source::In};
        Edge   edge{Edge::Rise};
        float  level{0.f};
    };

    struct Window {
        std::vector<float> in, out, out_r;
        size_t trigger{0};   // index of the trigger sample inside the window
        Window() {
            in.resize(kWindowFrames);
            out.resize(kWindowFrames);
            out_r.resize(kWindowFrames);
        }
    };

    ScopeCapture()
        : in_(kRingFrames), out_(kRingFrames), out_r_(kRingFrames) {}

    // Arm for one capture; replaces any pending request. Only frames pushed
    // after this call can trigger.
    void arm(const Request& r) {
        req_   = r;
        armed_ = true;
        fired_ = false;
        scan_from_ = written_;
    }

    void cancel() { armed_ = false; fired_ = false; }
    bool armed() const { return armed_; }

    // Drops all history (rate / block-size / mode change) and disarms.
    void clear() {
        written_ = 0;
        scan_from_ = 0;
        armed_ = fired_ = false;
    }

    // Append one block of interleaved stereo in/out (frames*2 floats each).
    // Returns true when an armed capture completed; `w` then holds the window
    // and the capture is disarmed.
    bool push(const float* in_buf, const float* out_buf, size_t frames, Window& w) {
        frames = std::min(frames, kRingFrames);
        for (size_t i = 0; i < frames; ++i) {
            const size_t k = (written_ + i) & kMask;
            in_[k]    = in_buf[2 * i];
            out_[k]   = out_buf[2 * i];
            out_r_[k] = out_buf[2 * i + 1];
        }
        const uint64_t first_new = written_;
        written_ += frames;
        if (!armed_) return false;

        if (!fired_) scan(first_new);
        if (!fired_ || written_ < trigger_abs_ + (kWindowFrames - kPreFrames)) return false;

        const uint64_t start = trigger_abs_ - kPreFrames;
        for (size_t i = 0; i < kWindowFrames; ++i) {
            const size_t k = (start + i) & kMask;
            w.in[i]    = in_[k];
            w.out[i]   = out_[k];
            w.out_r[i] = out_r_[k];
        }
        w.trigger = kPreFrames;
        armed_ = fired_ = false;
        return true;
    }

private:
    static constexpr size_t kMask = kRingFrames - 1;
    static_assert((kRingFrames & kMask) == 0, "ring length must be a power of two");

    // Looks for the first crossing among frames [max(first_new, scan_from_), written_).
    // A crossing needs a previous sample and kPreFrames of history, so early ones are skipped.
    void scan(uint64_t first_new) {
        const std::vector<float>& ch = req_.source == Source::In ? in_ : out_;
        uint64_t from = std::max(first_new, scan_from_);
        from = std::max<uint64_t>(from, kPreFrames);
        for (uint64_t n = from; n < written_; ++n) {
            const float prev = ch[(n - 1) & kMask];
            const float cur  = ch[n & kMask];
            const bool hit = req_.edge == Edge::Rise ? (prev < req_.level && cur >= req_.level)
                                                     : (prev > req_.level && cur <= req_.level);
            if (hit) { fired_ = true; trigger_abs_ = n; return; }
        }
        scan_from_ = written_;
    }

    std::vector<float> in_, out_, out_r_;
    uint64_t written_{0};      // total frames pushed since clear()
    uint64_t scan_from_{0};    // first frame not yet scanned
    uint64_t trigger_abs_{0};
    Request  req_{};
    bool     armed_{false};
    bool     fired_{false};
};

// Hand-off of the latest capture command from the IPC-dispatch thread to the
// drain thread (FR-SCI-14b). The last post wins; take() is cheap when idle
// (one relaxed-acquire atomic load), so the drain loop can poll it every pass.
class ScopeCaptureMailbox {
public:
    enum class Action { None, Arm, Cancel };

    void post(Action a, const ScopeCapture::Request& r = {}) {
        std::lock_guard<std::mutex> lk(mutex_);
        action_ = a;
        req_    = r;
        pending_.store(true, std::memory_order_release);
    }

    // Returns false when nothing is pending.
    bool take(Action& a, ScopeCapture::Request& r) {
        if (!pending_.load(std::memory_order_acquire)) return false;
        std::lock_guard<std::mutex> lk(mutex_);
        a = action_;
        r = req_;
        pending_.store(false, std::memory_order_relaxed);
        return true;
    }

private:
    std::mutex mutex_;
    Action action_{Action::None};
    ScopeCapture::Request req_{};
    std::atomic<bool> pending_{false};
};
