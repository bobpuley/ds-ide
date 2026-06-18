#include "audio_engine.h"
#include "core_audio_device.h"
#include "emulator_state.h"
#include "wav_reader.h"
#include <algorithm>
#include <cfloat>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace daisy_emu {

// ---- Helpers ----------------------------------------------------------------

static void ipc_send(const std::string& msg) {
    std::lock_guard<std::mutex> lk(g_state.send_mutex);
    if (g_state.send_ipc) g_state.send_ipc(msg);
}

static std::string build_scope_json(const std::vector<float>& in_pts,
                                    const std::vector<float>& out_pts,
                                    const std::vector<float>& out_r_pts) {
    std::string s;
    s.reserve(64 + (in_pts.size() + out_pts.size() + out_r_pts.size()) * 12);
    s = "{\"type\":\"scope\",\"in\":[";
    char num[32];
    for (size_t i = 0; i < in_pts.size(); ++i) {
        if (i) s += ',';
        std::snprintf(num, sizeof(num), "%.6g", in_pts[i]);
        s += num;
    }
    s += "],\"out\":[";
    for (size_t i = 0; i < out_pts.size(); ++i) {
        if (i) s += ',';
        std::snprintf(num, sizeof(num), "%.6g", out_pts[i]);
        s += num;
    }
    s += "],\"out_r\":[";
    for (size_t i = 0; i < out_r_pts.size(); ++i) {
        if (i) s += ',';
        std::snprintf(num, sizeof(num), "%.6g", out_r_pts[i]);
        s += num;
    }
    s += "]}";
    return s;
}

// Scan output for NaN/Inf, denormals, and clipping (FR-RU-4). Sends at most
// one IPC event per kind per call. Returns immediately once all three have fired.
static void scan_output_and_notify(const std::vector<float>& out_buf, size_t n) {
    bool sent_nan = false, sent_clip = false, sent_denormal = false;
    for (size_t i = 0; i < n && !(sent_nan && sent_clip && sent_denormal); ++i) {
        float s = out_buf[i];
        int cls = std::fpclassify(s);
        if ((cls == FP_NAN || cls == FP_INFINITE) && !sent_nan) {
            ipc_send("{\"type\":\"event\",\"kind\":\"nan\"}");
            sent_nan = true;
        } else if (cls == FP_SUBNORMAL && !sent_denormal) {
            ipc_send("{\"type\":\"event\",\"kind\":\"denormal\"}");
            sent_denormal = true;
        } else if (cls == FP_NORMAL && std::fabs(s) > 1.f && !sent_clip) {
            ipc_send("{\"type\":\"event\",\"kind\":\"clip\"}");
            sent_clip = true;
        }
    }
}

// ---- Scope state (shared across modes, reset on mode switch) ----------------

struct ScopeState {
    static constexpr size_t SCOPE_BLOCKS = 33;
    static constexpr size_t SCOPE_STEP   = 4;

    std::vector<float> in, out, out_r;
    size_t block_count{0};

    ScopeState() { in.reserve(512); out.reserve(512); out_r.reserve(512); }

    void reset() {
        in.clear(); out.clear(); out_r.clear(); block_count = 0;
    }

    // Accumulate one block of interleaved stereo data (in_buf, out_buf each size frames*2).
    // Returns true and clears state when a full scope frame is ready (caller must emit).
    bool accumulate(const std::vector<float>& in_buf,
                    const std::vector<float>& out_buf,
                    size_t frames) {
        size_t buf_samples = frames * 2;
        for (size_t i = 0; i < buf_samples; i += SCOPE_STEP * 2) {
            in.push_back(in_buf[i]);
            out.push_back(out_buf[i]);
            out_r.push_back(out_buf[i + 1]);
        }
        ++block_count;
        if (block_count >= SCOPE_BLOCKS) {
            block_count = 0;
            return true;
        }
        return false;
    }
};

// ---- Simulated mode loop ----------------------------------------------------

static void run_simulated(bool use_block,
                          float sample_rate,
                          size_t block_size,
                          std::vector<float>& in_buf,
                          std::vector<float>& out_buf,
                          std::vector<float>& in_ch0,
                          std::vector<float>& in_ch1,
                          std::vector<float>& out_ch0,
                          std::vector<float>& out_ch1) {
    ScopeState scope;
    double phase = 0.0;

    // WAV playhead (M9): fractional read position and the generation we last saw,
    // so a freshly-loaded file restarts from the beginning.
    double   wav_pos      = 0.0;
    uint64_t wav_gen_seen = g_state.wav_generation.load();

    auto block_ns = [&]() -> long long {
        return static_cast<long long>(
            static_cast<double>(block_size) / static_cast<double>(sample_rate) * 1e9);
    };

    while (!g_state.shutdown.load()) {
        // Exit simulated loop if mode has changed to realtime
        if (static_cast<AudioMode>(g_state.audio_mode.load()) != AudioMode::Simulated) return;

        if (!g_state.transport_running.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            continue;
        }

        // --- Input generation: WAV file (M9) or sine generator ---
        if (g_state.wav_active.load()) {
            std::shared_ptr<const WavData> wav;
            {
                std::lock_guard<std::mutex> lk(g_state.wav_mutex);
                wav = g_state.wav_data;
            }
            uint64_t gen = g_state.wav_generation.load();
            if (gen != wav_gen_seen) { wav_gen_seen = gen; wav_pos = 0.0; }
            if (wav && !wav->empty()) {
                wav_fill_stereo_block(*wav, wav_pos, g_state.wav_loop.load(),
                                      sample_rate, block_size, in_buf.data());
            } else {
                std::fill(in_buf.begin(),
                          in_buf.begin() + static_cast<ptrdiff_t>(block_size * 2), 0.f);
            }
        } else {
            const float freq = g_state.sine_freq.load();
            const float amp  = g_state.sine_amp.load();
            for (size_t i = 0; i < block_size; ++i) {
                float s = amp * static_cast<float>(std::sin(2.0 * M_PI * phase));
                in_buf[2 * i]     = s;
                in_buf[2 * i + 1] = s;
                phase += static_cast<double>(freq) / static_cast<double>(sample_rate);
                if (phase >= 1.0) phase -= 1.0;
            }
        }

        std::fill(out_buf.begin(), out_buf.end(), 0.f);

        if (use_block) {
            for (size_t i = 0; i < block_size; ++i) {
                in_ch0[i] = in_buf[2 * i];
                in_ch1[i] = in_buf[2 * i + 1];
            }
            std::fill(out_ch0.begin(), out_ch0.end(), 0.f);
            std::fill(out_ch1.begin(), out_ch1.end(), 0.f);

            const float* in_ptrs[2]  = { in_ch0.data(), in_ch1.data() };
            float*       out_ptrs[2] = { out_ch0.data(), out_ch1.data() };
            g_state.block_cb(in_ptrs, out_ptrs, block_size);

            for (size_t i = 0; i < block_size; ++i) {
                out_buf[2 * i]     = out_ch0[i];
                out_buf[2 * i + 1] = out_ch1[i];
            }
        } else {
            g_state.interleaving_cb(in_buf.data(), out_buf.data(), block_size * 2);
        }

        scan_output_and_notify(out_buf, block_size * 2);

        if (scope.accumulate(in_buf, out_buf, block_size)) {
            ipc_send(build_scope_json(scope.in, scope.out, scope.out_r));
            scope.reset();
        }

        std::this_thread::sleep_for(std::chrono::nanoseconds(block_ns()));
    }
}

// ---- Real-time mode loop ----------------------------------------------------

static void run_realtime(bool use_block,
                         float sample_rate,
                         std::vector<float>& in_ch0,
                         std::vector<float>& in_ch1,
                         std::vector<float>& out_ch0,
                         std::vector<float>& out_ch1) {
    uint32_t buffer_size = static_cast<uint32_t>(g_state.rt_buffer_size.load());

    // State captured by the CoreAudio render callback (called on the real-time thread).
    ScopeState scope;
    std::vector<float> in_buf(buffer_size * 2);
    std::vector<float> out_buf(buffer_size * 2);
    std::vector<float> local_in_ch0(buffer_size), local_in_ch1(buffer_size);
    std::vector<float> local_out_ch0(buffer_size), local_out_ch1(buffer_size);

    // Xrun reporting: track last reported count.
    uint32_t last_reported_xruns = 0;
    uint32_t xrun_report_blocks  = 0;

    CoreAudioDevice device;

    auto processBlock = [&](const float* ca_in, float* ca_out, size_t frames) {
        // Copy CoreAudio input to interleaved in_buf
        std::memcpy(in_buf.data(), ca_in, frames * 2 * sizeof(float));
        std::fill(out_buf.begin(), out_buf.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);

        if (!g_state.transport_running.load()) {
            // Transport stopped — output silence
            std::fill(ca_out, ca_out + frames * 2, 0.f);
            return;
        }

        if (use_block) {
            for (size_t i = 0; i < frames; ++i) {
                local_in_ch0[i] = in_buf[2 * i];
                local_in_ch1[i] = in_buf[2 * i + 1];
            }
            std::fill(local_out_ch0.begin(), local_out_ch0.begin() + static_cast<ptrdiff_t>(frames), 0.f);
            std::fill(local_out_ch1.begin(), local_out_ch1.begin() + static_cast<ptrdiff_t>(frames), 0.f);

            const float* in_ptrs[2]  = { local_in_ch0.data(), local_in_ch1.data() };
            float*       out_ptrs[2] = { local_out_ch0.data(), local_out_ch1.data() };
            g_state.block_cb(in_ptrs, out_ptrs, frames);

            for (size_t i = 0; i < frames; ++i) {
                out_buf[2 * i]     = local_out_ch0[i];
                out_buf[2 * i + 1] = local_out_ch1[i];
            }
        } else {
            g_state.interleaving_cb(in_buf.data(), out_buf.data(), frames * 2);
        }

        scan_output_and_notify(out_buf, frames * 2);
        std::memcpy(ca_out, out_buf.data(), frames * 2 * sizeof(float));

        // Scope tap
        if (scope.accumulate(in_buf, out_buf, frames)) {
            ipc_send(build_scope_json(scope.in, scope.out, scope.out_r));
            scope.reset();
        }

        // Latency reporting (~once per SCOPE_BLOCKS)
        ++xrun_report_blocks;
        if (xrun_report_blocks >= ScopeState::SCOPE_BLOCKS) {
            xrun_report_blocks = 0;
            uint32_t total_xruns = g_state.xrun_count.load(std::memory_order_relaxed)
                                 + device.drainXruns();
            if (total_xruns != last_reported_xruns) {
                last_reported_xruns = total_xruns;
                char buf[128];
                std::snprintf(buf, sizeof(buf),
                    "{\"type\":\"xrun\",\"count\":%u}", total_xruns);
                ipc_send(buf);
            }
            float lat_ms = device.lastLatencyMs();
            if (lat_ms > 0.f) {
                char buf[128];
                std::snprintf(buf, sizeof(buf),
                    "{\"type\":\"latency\",\"measuredMs\":%.2f}", static_cast<double>(lat_ms));
                ipc_send(buf);
            }
        }
    };

    bool started = device.start(static_cast<uint32_t>(sample_rate), buffer_size, processBlock);
    if (!started) {
        ipc_send("{\"type\":\"event\",\"kind\":\"realtime_unavailable\"}");
        // Fall back: switch back to simulated mode
        {
            std::lock_guard<std::mutex> lk(g_state.mode_mutex);
            g_state.audio_mode.store(0);
        }
        g_state.mode_cv.notify_all();
        return;
    }

    // Block this thread until mode changes or shutdown
    {
        std::unique_lock<std::mutex> lk(g_state.mode_mutex);
        g_state.mode_cv.wait(lk, [] {
            return g_state.shutdown.load()
                || static_cast<AudioMode>(g_state.audio_mode.load()) != AudioMode::Realtime;
        });
    }

    device.stop();
    scope.reset();
}

// ---- Engine entry point -----------------------------------------------------

void run_audio_engine() {
    // Wait for the effect to call StartAudio()
    {
        std::unique_lock<std::mutex> lk(g_state.callback_mutex);
        g_state.callback_cv.wait(lk, [] {
            return g_state.callback_set || g_state.shutdown.load();
        });
    }
    if (g_state.shutdown.load()) return;

    const bool use_block = (g_state.block_cb != nullptr);

    float  sample_rate = g_state.sample_rate.load();
    size_t block_size  = g_state.block_size.load();
    size_t max_size    = std::max(block_size, static_cast<size_t>(g_state.rt_buffer_size.load()));

    // Preallocated shared work buffers (sized for the larger of the two modes)
    std::vector<float> in_buf(max_size * 2);
    std::vector<float> out_buf(max_size * 2);
    std::vector<float> in_ch0(max_size), in_ch1(max_size);
    std::vector<float> out_ch0(max_size), out_ch1(max_size);

    // Outer dispatch loop: check mode and run the appropriate inner loop.
    // Each inner loop returns when mode changes or shutdown is set.
    while (!g_state.shutdown.load()) {
        AudioMode mode = static_cast<AudioMode>(g_state.audio_mode.load());

        if (mode == AudioMode::Simulated) {
            run_simulated(use_block, sample_rate, block_size,
                          in_buf, out_buf, in_ch0, in_ch1, out_ch0, out_ch1);
        } else {
            run_realtime(use_block, sample_rate, in_ch0, in_ch1, out_ch0, out_ch1);
        }
    }
}

}  // namespace daisy_emu
