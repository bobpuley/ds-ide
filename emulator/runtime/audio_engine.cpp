#include "audio_engine.h"
#include "emulator_state.h"
#include <cfloat>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
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
                                    const std::vector<float>& out_pts) {
    std::string s;
    s.reserve(64 + in_pts.size() * 12 + out_pts.size() * 12);
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
    s += "]}";
    return s;
}

// ---- Engine loop ------------------------------------------------------------

void run_audio_engine() {
    // Wait for the effect to call StartAudio()
    {
        std::unique_lock<std::mutex> lk(g_state.callback_mutex);
        g_state.callback_cv.wait(lk, [] {
            return g_state.callback_set || g_state.shutdown.load();
        });
    }
    if (g_state.shutdown.load()) return;

    // Snapshot config at callback time (block_size / sample_rate from shim calls)
    float  sample_rate = g_state.sample_rate.load();
    size_t block_size  = g_state.block_size.load();
    // interleaved stereo: 2 samples per frame
    size_t buf_samples = block_size * 2;

    std::vector<float> in_buf(buf_samples);
    std::vector<float> out_buf(buf_samples);

    // Scope: collect ~33 blocks then emit one frame (~33 ms at 48kHz/48-block = 30 fps)
    constexpr size_t SCOPE_BLOCKS = 33;
    constexpr size_t SCOPE_STEP   = 4;  // downsample: keep 1 sample per SCOPE_STEP frames
    std::vector<float> scope_in, scope_out;
    scope_in.reserve(512);
    scope_out.reserve(512);
    size_t block_count = 0;

    // Sine phase accumulator [0, 1)
    double phase = 0.0;

    // Nanoseconds per block for soft real-time pacing
    auto block_ns = [&]() -> long long {
        return static_cast<long long>(
            static_cast<double>(block_size) / static_cast<double>(sample_rate) * 1e9);
    };

    while (!g_state.shutdown.load()) {
        if (!g_state.transport_running.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            continue;
        }

        const float freq = g_state.sine_freq.load();
        const float amp  = g_state.sine_amp.load();

        // Fill input buffer: interleaved L=R sine wave
        for (size_t i = 0; i < block_size; ++i) {
            float s = amp * static_cast<float>(std::sin(2.0 * M_PI * phase));
            in_buf[2 * i]     = s;
            in_buf[2 * i + 1] = s;
            phase += static_cast<double>(freq) / static_cast<double>(sample_rate);
            if (phase >= 1.0) phase -= 1.0;
        }

        std::fill(out_buf.begin(), out_buf.end(), 0.f);

        // Invoke the effect's audio callback
        g_state.interleaving_cb(in_buf.data(), out_buf.data(), buf_samples);

        // Scan output for NaN/Inf, denormals, and clipping (FR-RU-4)
        bool sent_nan = false, sent_clip = false, sent_denormal = false;
        for (size_t i = 0; i < buf_samples && !(sent_nan && sent_clip && sent_denormal); ++i) {
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

        // Scope tap: downsample by SCOPE_STEP, keep left channel sample
        for (size_t i = 0; i < buf_samples; i += SCOPE_STEP * 2) {
            scope_in.push_back(in_buf[i]);
            scope_out.push_back(out_buf[i]);
        }

        ++block_count;
        if (block_count >= SCOPE_BLOCKS) {
            ipc_send(build_scope_json(scope_in, scope_out));
            scope_in.clear();
            scope_out.clear();
            block_count = 0;
        }

        // Soft real-time pacing: sleep ~one block duration
        std::this_thread::sleep_for(std::chrono::nanoseconds(block_ns()));
    }
}

}  // namespace daisy_emu
