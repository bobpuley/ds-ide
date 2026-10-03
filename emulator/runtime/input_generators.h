#pragma once
// Deterministic input generators for the emulator's input stage (FR-GEN-2, FR-GEN-3).
//
// One InputGenerator renders any of the seven generators into an interleaved stereo
// buffer, identically on both channels. `render` is real-time safe: no allocation,
// lock or syscall. Not thread-safe by design — the audio thread owns the instance;
// other threads hand it settings through EmulatorState atomics.

#include <cstddef>
#include <cstdint>

namespace daisy_emu {

enum class GenKind : int { Sine = 0, Noise, Sweep, Impulse, Step, Silence, TwoTone };

/** Settings of every generator; each kind reads the subset listed in FR-GEN-2. */
struct GenParams {
    float freq{440.f};       // Hz, Sine
    float amp{0.25f};        // 0-1
    bool  pink{false};       // Noise: pink instead of white
    float from{20.f};        // Hz, Sweep start
    float to{20000.f};       // Hz, Sweep end (kept above `from`)
    float time{5.f};         // s, Sweep duration
    float period_ms{500.f};  // ms, Impulse / Step
};

/** Clamp every field to its FR-GEN-2 range; NaN falls back to the default. */
GenParams clamp_gen_params(const GenParams& p);

class InputGenerator {
public:
    /** Select a generator: clamps `p` and resets every phase, filter state and counter. */
    void configure(GenKind kind, const GenParams& p, float sample_rate);

    /** Apply new settings while running: clamps, keeps phase where the signal has one. */
    void setParams(const GenParams& p);

    /** Render `frames` frames of interleaved stereo (L == R) into `out`. */
    void render(float* out, size_t frames) noexcept;

    GenKind kind() const { return kind_; }

private:
    void reset();
    void apply(const GenParams& p);
    void restart_sweep();
    void seek_sweep();
    float next_noise() noexcept;
    float next_sample() noexcept;

    GenKind   kind_{GenKind::Silence};
    GenParams p_{};
    double    sr_{48000.0};

    // Phases in cycles [0,1): primary (sine / sweep / 60 Hz) and the 7 kHz tone.
    double phase_{0.0}, phase2_{0.0};

    // Noise: fixed-seed xorshift32 and the three pink-filter poles.
    uint32_t rng_{0};
    float    pink_b0_{0.f}, pink_b1_{0.f}, pink_b2_{0.f};

    // Sweep: position in samples, length in samples, current frequency and per-sample ratio.
    uint64_t sweep_n_{0}, sweep_len_{1};
    double   sweep_freq_{20.0}, sweep_ratio_{1.0};

    // Impulse / Step: counter within the period, and the period in samples.
    uint64_t counter_{0}, period_samples_{1};
};

}  // namespace daisy_emu
