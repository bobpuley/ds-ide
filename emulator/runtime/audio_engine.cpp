#include "audio_engine.h"
#include "core_audio_device.h"
#include "emulator_state.h"
#include "session_player.h"
#include "session_recorder.h"
#include "wav_reader.h"
#include <algorithm>
#include <cfloat>
#include <chrono>
#include <cmath>
#include <complex>
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

// Post msg to the SPSC queue; drained to the IPC socket by the non-RT drain
// thread started in run_audio_engine() (AC-39). Safe to call from RT thread.
// The const char* overload avoids constructing a temporary std::string (FR-RTS-2).
// Drops are counted atomically; the drain thread reports them periodically (FR-QA-1).
static void ipc_send(const char* msg) {
    if (!g_state.ipc_queue.push(msg))
        g_state.ipc_queue_drops.fetch_add(1, std::memory_order_relaxed);
}
static void ipc_send(const std::string& msg) {
    if (!g_state.ipc_queue.push(msg))
        g_state.ipc_queue_drops.fetch_add(1, std::memory_order_relaxed);
}

// ---- Inline radix-2 FFT (Cooley-Tukey, power-of-2 N) -----------------------

static void fft_radix2(std::vector<std::complex<float>>& x) {
    size_t N = x.size();
    // Bit-reversal permutation
    for (size_t i = 1, j = 0; i < N; ++i) {
        size_t bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(x[i], x[j]);
    }
    // Butterfly stages
    for (size_t len = 2; len <= N; len <<= 1) {
        float angle = static_cast<float>(-2.0 * M_PI / static_cast<double>(len));
        std::complex<float> wlen(std::cos(angle), std::sin(angle));
        for (size_t i = 0; i < N; i += len) {
            std::complex<float> w(1.f, 0.f);
            for (size_t j = 0; j < len / 2; ++j) {
                std::complex<float> u = x[i + j];
                std::complex<float> v = x[i + j + len / 2] * w;
                x[i + j]           = u + v;
                x[i + j + len / 2] = u - v;
                w *= wlen;
            }
        }
    }
}

// Fills mag_out (N/2 entries) with the single-sided magnitude spectrum of samples.
// Uses work (size N) as scratch space. Both buffers must be pre-allocated (FR-RTS-2).
static void magnitude_spectrum(const std::vector<float>& samples,
                               std::vector<std::complex<float>>& work,
                               std::vector<float>& mag_out) {
    const size_t N = samples.size();
    const float inv_n1 = 1.f / static_cast<float>(N > 1 ? N - 1 : 1);
    for (size_t i = 0; i < N; ++i) {
        float w = 0.5f * (1.f - std::cos(2.f * static_cast<float>(M_PI) * static_cast<float>(i) * inv_n1));
        work[i] = std::complex<float>(samples[i] * w, 0.f);
    }
    fft_radix2(work);
    const float norm = 2.f / static_cast<float>(N);
    for (size_t i = 0; i < N / 2; ++i)
        mag_out[i] = std::abs(work[i]) * norm;
}

// Writes into a pre-allocated std::string to avoid RT heap allocation (FR-RTS-2).
static void build_spectrum_json(const std::vector<float>& in_mag,
                                const std::vector<float>& out_mag,
                                float bin_hz,
                                std::string& s) {
    char num[32];
    std::snprintf(num, sizeof(num), "%.4f", static_cast<double>(bin_hz));
    s.clear();
    s += "{\"type\":\"spectrum\",\"binHz\":";
    s += num;
    s += ",\"in_fft\":[";
    for (size_t i = 0; i < in_mag.size(); ++i) {
        if (i) s += ',';
        std::snprintf(num, sizeof(num), "%.6g", static_cast<double>(in_mag[i]));
        s += num;
    }
    s += "],\"out_fft\":[";
    for (size_t i = 0; i < out_mag.size(); ++i) {
        if (i) s += ',';
        std::snprintf(num, sizeof(num), "%.6g", static_cast<double>(out_mag[i]));
        s += num;
    }
    s += "]}";
}

// ---- FFT accumulation state -------------------------------------------------

struct FftState {
    static constexpr size_t N_FFT = 1024;

    std::vector<float> in_samples, out_samples;
    // Pre-allocated working buffers — no RT heap allocation in compute path (FR-RTS-2).
    std::vector<std::complex<float>> fft_work;    // size N_FFT
    std::vector<float>               mag_in_buf;  // size N_FFT/2
    std::vector<float>               mag_out_buf; // size N_FFT/2
    std::string                      json_buf;    // pre-reserved to MAX_MSG

    FftState() {
        in_samples.reserve(N_FFT);
        out_samples.reserve(N_FFT);
        fft_work.resize(N_FFT);
        mag_in_buf.resize(N_FFT / 2);
        mag_out_buf.resize(N_FFT / 2);
        json_buf.reserve(SpscIpcQueue::MAX_MSG);
    }

    void reset() { in_samples.clear(); out_samples.clear(); }

    // Accumulate left-channel samples from interleaved stereo buffers.
    // Returns true when N_FFT samples are ready.
    bool accumulate(const std::vector<float>& in_buf,
                    const std::vector<float>& out_buf,
                    size_t frames) {
        size_t space = N_FFT - in_samples.size();
        size_t take  = std::min(frames, space);
        for (size_t i = 0; i < take; ++i) {
            in_samples.push_back(in_buf[2 * i]);
            out_samples.push_back(out_buf[2 * i]);
        }
        return in_samples.size() >= N_FFT;
    }
};

// ---- Scope + Spectrum emit helper -------------------------------------------

static void emit_spectrum_if_ready(FftState& fft,
                                   const std::vector<float>& in_buf,
                                   const std::vector<float>& out_buf,
                                   size_t frames,
                                   float sample_rate) {
    if (!fft.accumulate(in_buf, out_buf, frames)) return;
    float bin_hz = sample_rate / static_cast<float>(FftState::N_FFT);
    magnitude_spectrum(fft.in_samples,  fft.fft_work, fft.mag_in_buf);
    magnitude_spectrum(fft.out_samples, fft.fft_work, fft.mag_out_buf);
    build_spectrum_json(fft.mag_in_buf, fft.mag_out_buf, bin_hz, fft.json_buf);
    ipc_send(fft.json_buf);
    fft.reset();
}

// Writes into a pre-allocated std::string to avoid RT heap allocation (FR-RTS-2).
static void build_scope_json(const std::vector<float>& in_pts,
                             const std::vector<float>& out_pts,
                             const std::vector<float>& out_r_pts,
                             std::string& s) {
    char num[32];
    s.clear();
    s += "{\"type\":\"scope\",\"in\":[";
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

    // Reference hardware frame size SCOPE_STEP_BASE was originally tuned for
    // (rt_buffer_size default = 256 — see SpscIpcQueue::MAX_MSG's comment,
    // sized for the ~76 kB message this combination produces).
    static constexpr size_t SCOPE_STEP_BASE_FRAMES = 256;
    static constexpr size_t SCOPE_STEP_BASE        = 4;

    // FR-EMU-2: the per-channel sample budget is derived from
    // SpscIpcQueue::MAX_MSG instead of being sized independently, so
    // build_scope_json()'s output can never structurally exceed the SPSC
    // slot capacity regardless of hardware frame size. kBytesPerValueWorstCase
    // bounds the widest "%.6g" output plus its separating comma (e.g.
    // "-1.23046e-05,"); kFixedOverheadBytes covers the surrounding JSON
    // skeleton (keys, brackets, braces).
    static constexpr size_t kBytesPerValueWorstCase = 16;
    static constexpr size_t kFixedOverheadBytes     = 128;
    static constexpr size_t SCOPE_SAMPLES_MAX =
        (SpscIpcQueue::MAX_MSG - kFixedOverheadBytes) / (3 * kBytesPerValueWorstCase);

    std::vector<float> in, out, out_r;
    std::string json_buf;  // pre-reserved to MAX_MSG — no RT heap allocation (FR-RTS-2)
    size_t block_count{0};

    ScopeState() {
        in.reserve(SCOPE_SAMPLES_MAX);
        out.reserve(SCOPE_SAMPLES_MAX);
        out_r.reserve(SCOPE_SAMPLES_MAX);
        json_buf.reserve(SpscIpcQueue::MAX_MSG);
    }

    void reset() {
        in.clear(); out.clear(); out_r.clear(); block_count = 0;
    }

    // Accumulate one block of interleaved stereo data (in_buf, out_buf each size frames*2).
    // Enforces SCOPE_SAMPLES_MAX so push_back never triggers reallocation on the RT
    // thread once the vectors have been reserved (AC-40).
    // Returns true and resets state when a full scope frame is ready (caller must emit).
    bool accumulate(const std::vector<float>& in_buf,
                    const std::vector<float>& out_buf,
                    size_t frames) {
        // FR-EMU-2: decimate more aggressively as the hardware frame count
        // grows past the reference size, so the total samples accumulated
        // over SCOPE_BLOCKS blocks — and therefore the emitted message size —
        // stays roughly constant instead of scaling linearly with frames.
        size_t step = SCOPE_STEP_BASE;
        if (frames > SCOPE_STEP_BASE_FRAMES) {
            step = SCOPE_STEP_BASE * frames / SCOPE_STEP_BASE_FRAMES;
        }

        size_t buf_samples = frames * 2;
        for (size_t i = 0; i < buf_samples; i += step * 2) {
            if (in.size() >= SCOPE_SAMPLES_MAX) break;  // hard cap — no realloc (AC-40)
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
    FftState fft;
    double phase = 0.0;

    // WAV playhead (M9): fractional read position and generation counter.
    double   wav_pos      = 0.0;
    uint64_t wav_gen_seen = g_state.wav_generation.load();

    // FR-EMU-7: snapshot of config_generation at entry — process_one_block()
    // and the CoreAudio-wait predicate below both compare against this to
    // detect a `config` IPC update and return/restart with fresh sample_rate/
    // block_size instead of running the rest of the session on stale values.
    uint64_t cfg_gen_seen = g_state.config_generation.load();

    // FR-EMU-4: track the recorder's active() edge so a record_error is
    // reported once promptly per session rather than either never firing
    // (checked only at recordStop) or re-firing every block indefinitely.
    bool recorder_was_active   = false;
    bool recorder_error_reported = false;

    // Process one block of audio: generate input, run effect, emit scope/FFT.
    // Also writes the computed output into out_buf so the caller can forward
    // it to an audio device. Returns false when the simulated mode should exit.
    auto process_one_block = [&](size_t frames) -> bool {
        if (static_cast<AudioMode>(g_state.audio_mode.load()) != AudioMode::Simulated)
            return false;
        // FR-EMU-7: a `config` update since this loop was entered — return
        // so the caller (the fallback silent loop, or the CoreAudio-wait
        // predicate below) restarts run_simulated() with freshly re-read
        // sample_rate/block_size rather than continuing on stale values.
        if (g_state.config_generation.load(std::memory_order_relaxed) != cfg_gen_seen)
            return false;

        if (!g_state.transport_running.load()) return true;

        // CoreAudio may deliver more frames than we requested (hardware minimum
        // clamping). Grow all work buffers on the fly to avoid buffer overflow.
        if (frames * 2 > in_buf.size()) {
            in_buf.resize(frames * 2, 0.f);
            out_buf.resize(frames * 2, 0.f);
            in_ch0.resize(frames, 0.f);
            in_ch1.resize(frames, 0.f);
            out_ch0.resize(frames, 0.f);
            out_ch1.resize(frames, 0.f);
        }

        // --- Input generation: replay (M14) / WAV (M9) / sine ---
        if (g_state.replay_active.load()) {
            // RT-safe (FR-RTS-3): popBlock only pops from a pre-filled ring —
            // no syscalls, no mutex, no heap allocation on this thread.
            ReplayEvent evbuf[SessionPlayer::kMaxEventsPerSlot];
            size_t n_events = 0;
            bool got_block = g_state.player.popBlock(in_buf.data(), frames,
                                                      evbuf, SessionPlayer::kMaxEventsPerSlot,
                                                      n_events);
            if (!got_block) {
                if (g_state.player.done()) {
                    g_state.replay_active.store(false);
                    ipc_send("{\"type\":\"replayDone\"}");
                    return true;
                }
                // Reader thread hasn't produced the next block yet — output
                // silence this block rather than blocking the RT thread.
                std::fill(in_buf.begin(),
                          in_buf.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);
            } else {
                for (size_t i = 0; i < n_events; ++i) {
                    const auto& ev = evbuf[i];
                    if (ev.type == kRecTypePotEvent) {
                        if (ev.channel_or_pin < 12)
                            g_state.pot_values[ev.channel_or_pin].store(ev.value);
                    } else if (ev.type == kRecTypeButtonEvent) {
                        if (ev.channel_or_pin < EmulatorState::kNumGpioPins)
                            g_state.button_states[ev.channel_or_pin].store(ev.pressed != 0);
                    }
                }
            }
        } else if (g_state.wav_active.load()) {
            // RT-safe (FR-RTS-3): atomic pointer load replaces the wav_mutex +
            // shared_ptr copy — no mutex, no refcount churn on this thread. The
            // pointer is published back via wav_data_in_use so the IPC thread
            // knows when it is safe to free a retired WavData.
            const WavData* wav = g_state.wav_data_ptr.load(std::memory_order_acquire);
            g_state.wav_data_in_use.store(wav, std::memory_order_release);
            uint64_t gen = g_state.wav_generation.load();
            if (gen != wav_gen_seen) { wav_gen_seen = gen; wav_pos = 0.0; }
            if (wav && !wav->empty()) {
                wav_fill_stereo_block(*wav, wav_pos, g_state.wav_loop.load(),
                                      sample_rate, frames, in_buf.data());
            } else {
                std::fill(in_buf.begin(),
                          in_buf.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);
            }
        } else {
            const float freq = g_state.sine_freq.load();
            const float amp  = g_state.sine_amp.load();
            for (size_t i = 0; i < frames; ++i) {
                float s = amp * static_cast<float>(std::sin(2.0 * M_PI * phase));
                in_buf[2 * i]     = s;
                in_buf[2 * i + 1] = s;
                phase += static_cast<double>(freq) / static_cast<double>(sample_rate);
                if (phase >= 1.0) phase -= 1.0;
            }
        }

        // Record input block (M14 / FR-RTS-1): enqueueBlock is RT-safe (SPSC, no mutex).
        g_state.recorder.enqueueBlock(in_buf.data(), frames);

        // FR-EMU-4: surface a drain-thread write failure (ENOSPC/EIO) promptly
        // instead of only at the next explicit recordStop. active()'s
        // false→true edge re-arms reporting for each new recording session.
        bool rec_active_now = g_state.recorder.active();
        if (rec_active_now && !recorder_was_active) recorder_error_reported = false;
        recorder_was_active = rec_active_now;
        if (g_state.recorder.hasWriteError() && !recorder_error_reported) {
            recorder_error_reported = true;
            ipc_send("{\"type\":\"event\",\"kind\":\"record_error\"}");
        }

        std::fill(out_buf.begin(), out_buf.begin() + static_cast<ptrdiff_t>(frames * 2), 0.f);

        if (use_block) {
            for (size_t i = 0; i < frames; ++i) {
                in_ch0[i] = in_buf[2 * i];
                in_ch1[i] = in_buf[2 * i + 1];
            }
            std::fill(out_ch0.begin(), out_ch0.begin() + static_cast<ptrdiff_t>(frames), 0.f);
            std::fill(out_ch1.begin(), out_ch1.begin() + static_cast<ptrdiff_t>(frames), 0.f);

            const float* in_ptrs[2]  = { in_ch0.data(), in_ch1.data() };
            float*       out_ptrs[2] = { out_ch0.data(), out_ch1.data() };
            g_state.block_cb(in_ptrs, out_ptrs, frames);

            for (size_t i = 0; i < frames; ++i) {
                out_buf[2 * i]     = out_ch0[i];
                out_buf[2 * i + 1] = out_ch1[i];
            }
        } else {
            g_state.interleaving_cb(in_buf.data(), out_buf.data(), frames * 2);
        }

        scan_output_and_notify(out_buf, frames * 2);

        const float vol_s = g_state.output_volume.load();
        if (vol_s != 1.f) {
            for (size_t i = 0; i < frames * 2; ++i) out_buf[i] *= vol_s;
        }

        if (scope.accumulate(in_buf, out_buf, frames)) {
            build_scope_json(scope.in, scope.out, scope.out_r, scope.json_buf);
            ipc_send(scope.json_buf);
            scope.reset();
        }

        emit_spectrum_if_ready(fft, in_buf, out_buf, frames, sample_rate);
        return true;
    };

    // Try to open an output-only CoreAudio device so the effect is audible
    // from speakers without requiring microphone permission.
    CoreAudioDevice device;

    auto ca_process = [&](const float* /*ca_in*/, float* ca_out, size_t frames) {
        if (!process_one_block(frames)) {
            std::fill(ca_out, ca_out + frames * 2, 0.f);
            return;
        }
        if (g_state.transport_running.load()) {
            std::memcpy(ca_out, out_buf.data(), frames * 2 * sizeof(float));
        } else {
            std::fill(ca_out, ca_out + frames * 2, 0.f);
        }
    };

    // Never request fewer than 256 frames from CoreAudio in simulated mode.
    // Very small block sizes (e.g. 4) cause ~12 000 callbacks/s, overwhelming
    // the kernel scheduler and producing xrun distortion. Effects receive the
    // full hardware frame count per call, which is correct for emulation.
    const size_t hw_buf = std::max(block_size, size_t(256));
    bool audio_started = device.start_output_only(
        static_cast<uint32_t>(sample_rate),
        static_cast<uint32_t>(hw_buf),
        ca_process);

    if (!audio_started) {
        // No audio output device available (headless / CI). Fall back to the
        // original silent software loop — scope/FFT still work over IPC.
        std::fprintf(stderr, "[daisy-emu] No output device — running silent simulated loop\n");

        auto block_ns = static_cast<long long>(
            static_cast<double>(block_size) / static_cast<double>(sample_rate) * 1e9);

        while (!g_state.shutdown.load()) {
            auto t0 = std::chrono::steady_clock::now();
            if (!process_one_block(block_size)) break;
            if (!g_state.transport_running.load()) {
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
            } else {
                // Subtract elapsed execution time so WAV playback rate tracks wall
                // clock within ±5% under sustained CPU load (AC-54).
                auto elapsed_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::steady_clock::now() - t0).count();
                long long sleep_ns = block_ns - elapsed_ns;
                if (sleep_ns > 0)
                    std::this_thread::sleep_for(std::chrono::nanoseconds(sleep_ns));
            }
        }
        return;
    }

    // CoreAudio is driving the loop — wait for mode change, config change, or shutdown.
    {
        std::unique_lock<std::mutex> lk(g_state.mode_mutex);
        g_state.mode_cv.wait(lk, [cfg_gen_seen] {
            return g_state.shutdown.load()
                || static_cast<AudioMode>(g_state.audio_mode.load()) != AudioMode::Simulated
                || g_state.config_generation.load(std::memory_order_relaxed) != cfg_gen_seen;
        });
    }

    // Cancel any in-progress replay when switching away from simulated mode.
    if (g_state.replay_active.load()) {
        g_state.replay_active.store(false);
        std::lock_guard<std::mutex> lk(g_state.player_mutex);
        g_state.player.close();
    }

    device.stop();
    scope.reset();
}

// ---- Real-time mode loop ----------------------------------------------------

static void run_realtime(bool use_block,
                         float sample_rate,
                         std::vector<float>& in_ch0,
                         std::vector<float>& in_ch1,
                         std::vector<float>& out_ch0,
                         std::vector<float>& out_ch1) {
    uint32_t buffer_size = static_cast<uint32_t>(g_state.rt_buffer_size.load());

    // FR-EMU-7: see run_simulated()'s cfg_gen_seen for rationale — wakes the
    // mode_cv wait below on a `config` update even though audio_mode itself
    // didn't change, so sample_rate (used for FFT bin labeling) is re-read
    // by the caller on the next entry instead of staying latched.
    uint64_t cfg_gen_seen = g_state.config_generation.load();

    // State captured by the CoreAudio render callback (called on the real-time thread).
    ScopeState scope;
    FftState fft;
    std::vector<float> in_buf(buffer_size * 2);
    std::vector<float> out_buf(buffer_size * 2);
    std::vector<float> local_in_ch0(buffer_size), local_in_ch1(buffer_size);
    std::vector<float> local_out_ch0(buffer_size), local_out_ch1(buffer_size);

    // Xrun reporting: track last reported count.
    uint32_t last_reported_xruns = 0;
    uint32_t xrun_report_blocks  = 0;

    CoreAudioDevice device;

    auto processBlock = [&](const float* ca_in, float* ca_out, size_t frames) {
        // Guard against hardware delivering more frames than rt_buffer_size.
        if (frames * 2 > in_buf.size()) {
            in_buf.resize(frames * 2, 0.f);
            out_buf.resize(frames * 2, 0.f);
            local_in_ch0.resize(frames, 0.f);
            local_in_ch1.resize(frames, 0.f);
            local_out_ch0.resize(frames, 0.f);
            local_out_ch1.resize(frames, 0.f);
        }
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
        const float vol = g_state.output_volume.load();
        if (vol != 1.f) {
            for (size_t i = 0; i < frames * 2; ++i) out_buf[i] *= vol;
        }
        std::memcpy(ca_out, out_buf.data(), frames * 2 * sizeof(float));

        // Scope tap
        if (scope.accumulate(in_buf, out_buf, frames)) {
            build_scope_json(scope.in, scope.out, scope.out_r, scope.json_buf);
            ipc_send(scope.json_buf);
            scope.reset();
        }

        emit_spectrum_if_ready(fft, in_buf, out_buf, frames,
                               static_cast<float>(sample_rate));

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
                    "{\"type\":\"latency\",\"estimatedMs\":%.2f}", static_cast<double>(lat_ms));
                ipc_send(buf);
            }
            // FR-EMU-3: AudioUnitRender failures, surfaced alongside xruns
            // rather than silently leaving the render callback's input
            // unchanged for that block.
            uint32_t render_errs = device.drainRenderErrors();
            if (render_errs > 0) {
                char buf[128];
                std::snprintf(buf, sizeof(buf),
                    "{\"type\":\"event\",\"kind\":\"render_error\",\"count\":%u}", render_errs);
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

    // FR-EMU-3: the input hardware's actual queried sample rate may diverge
    // from the engine's configured rate (e.g. a device that ignores the
    // requested format) — surface it instead of silently playing/recording
    // at the wrong rate.
    float queried_sr = device.queriedInputSampleRate();
    if (queried_sr > 0.f && std::fabs(queried_sr - sample_rate) > 0.5f) {
        char buf[160];
        std::snprintf(buf, sizeof(buf),
            "{\"type\":\"event\",\"kind\":\"sample_rate_mismatch\","
            "\"engineSampleRate\":%.1f,\"deviceSampleRate\":%.1f}",
            static_cast<double>(sample_rate), static_cast<double>(queried_sr));
        ipc_send(buf);
    }

    // Block this thread until mode changes, config changes, or shutdown (FR-EMU-7)
    {
        std::unique_lock<std::mutex> lk(g_state.mode_mutex);
        g_state.mode_cv.wait(lk, [cfg_gen_seen] {
            return g_state.shutdown.load()
                || static_cast<AudioMode>(g_state.audio_mode.load()) != AudioMode::Realtime
                || g_state.config_generation.load(std::memory_order_relaxed) != cfg_gen_seen;
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

    // Drain thread: forwards messages from the SPSC queue to the IPC socket (AC-39).
    // Runs for the lifetime of the audio engine; the mutex and ::send() stay off
    // the real-time thread. Reports ipc_queue_drops periodically (FR-QA-1).
    std::thread drain_thread([&]() {
        std::string msg;
        uint32_t last_reported_drops = 0;
        int idle_ticks = 0;
        while (!g_state.shutdown.load()) {
            if (g_state.ipc_queue.pop(msg)) {
                std::lock_guard<std::mutex> lk(g_state.send_mutex);
                if (g_state.send_ipc) g_state.send_ipc(msg);
                idle_ticks = 0;
            } else {
                std::this_thread::sleep_for(std::chrono::microseconds(500));
                ++idle_ticks;
                // Report drop count roughly every 500 ms of idle time.
                if (idle_ticks >= 1000) {
                    idle_ticks = 0;
                    // FR-EMU-2: fold in messages truncated for exceeding MAX_MSG
                    // alongside queue-full drops — both mean "this message
                    // didn't reach the client intact."
                    uint32_t drops = g_state.ipc_queue_drops.load(std::memory_order_relaxed)
                                   + g_state.ipc_queue.oversize_drops.load(std::memory_order_relaxed);
                    if (drops != last_reported_drops) {
                        last_reported_drops = drops;
                        char buf[80];
                        std::snprintf(buf, sizeof(buf),
                            "{\"type\":\"ipc_drops\",\"count\":%u}", drops);
                        std::lock_guard<std::mutex> lk(g_state.send_mutex);
                        if (g_state.send_ipc) g_state.send_ipc(buf);
                    }
                }
            }
        }
        // Flush any remaining messages after shutdown
        while (g_state.ipc_queue.pop(msg)) {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            if (g_state.send_ipc) g_state.send_ipc(msg);
        }
    });

    // Outer dispatch loop: check mode and run the appropriate inner loop.
    // Each inner loop returns when mode changes, config changes, or shutdown
    // is set (FR-EMU-7).
    while (!g_state.shutdown.load()) {
        // FR-EMU-7: re-read audio configuration each outer loop iteration so
        // a `config` IPC update takes effect on the next mode-loop entry
        // instead of the values captured once at startup silently going
        // stale for the rest of the session.
        sample_rate = g_state.sample_rate.load();
        block_size  = g_state.block_size.load();

        AudioMode mode = static_cast<AudioMode>(g_state.audio_mode.load());

        if (mode == AudioMode::Simulated) {
            run_simulated(use_block, sample_rate, block_size,
                          in_buf, out_buf, in_ch0, in_ch1, out_ch0, out_ch1);
        } else {
            run_realtime(use_block, sample_rate, in_ch0, in_ch1, out_ch0, out_ch1);
        }
    }

    drain_thread.join();
}

}  // namespace daisy_emu
