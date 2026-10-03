#include "input_generators.h"

#include <algorithm>
#include <cmath>

namespace daisy_emu {

namespace {

constexpr uint32_t kSeed = 0x2545F491u;
constexpr double   kTwoPi = 6.283185307179586476925286766559;

// FR-GEN-2 ranges, mirrored by src/webview/scope/scope-generators.ts.
constexpr float kMinHz = 20.f, kMaxHz = 20000.f;
constexpr float kMinTimeS = 0.5f, kMaxTimeS = 60.f;
constexpr float kMinPeriodMs = 10.f, kMaxPeriodMs = 5000.f;

// Two-tone: 4:1 amplitude ratio, so the sum never exceeds Amp.
constexpr double kToneLowHz = 60.0, kToneHighHz = 7000.0;
constexpr float  kToneLowGain = 0.8f, kToneHighGain = 0.2f;

// Gain bringing the Kellet pink filter output to roughly unit peak; a hard clamp
// then guarantees |sample| <= Amp.
constexpr float kPinkGain = 0.11f;

float clampf(float v, float lo, float hi, float fallback) {
    if (std::isnan(v)) return fallback;
    return std::max(lo, std::min(hi, v));
}

}  // namespace

GenParams clamp_gen_params(const GenParams& in) {
    const GenParams d;
    GenParams p;
    p.freq      = clampf(in.freq, kMinHz, kMaxHz, d.freq);
    p.amp       = clampf(in.amp, 0.f, 1.f, d.amp);
    p.pink      = in.pink;
    p.from      = clampf(in.from, kMinHz, kMaxHz - 1.f, d.from);
    p.to        = clampf(in.to, p.from + 1.f, kMaxHz, d.to);
    p.time      = clampf(in.time, kMinTimeS, kMaxTimeS, d.time);
    p.period_ms = clampf(in.period_ms, kMinPeriodMs, kMaxPeriodMs, d.period_ms);
    return p;
}

void InputGenerator::configure(GenKind kind, const GenParams& p, float sample_rate) {
    kind_ = kind;
    sr_ = sample_rate > 0.f ? static_cast<double>(sample_rate) : 48000.0;
    apply(p);
    reset();
}

void InputGenerator::setParams(const GenParams& p) {
    apply(p);
    // Keep phase; fold counters and the sweep position into the new lengths.
    counter_ %= (kind_ == GenKind::Step ? 2 * period_samples_ : period_samples_);
    if (sweep_n_ >= sweep_len_) restart_sweep(); else seek_sweep();
}

void InputGenerator::apply(const GenParams& in) {
    p_ = clamp_gen_params(in);
    period_samples_ = std::max<uint64_t>(1, static_cast<uint64_t>(std::llround(p_.period_ms * sr_ / 1000.0)));
    sweep_len_ = std::max<uint64_t>(1, static_cast<uint64_t>(std::llround(static_cast<double>(p_.time) * sr_)));
    sweep_ratio_ = std::pow(static_cast<double>(p_.to) / static_cast<double>(p_.from),
                            1.0 / static_cast<double>(sweep_len_));
}

void InputGenerator::reset() {
    phase_ = phase2_ = 0.0;
    rng_ = kSeed;
    pink_b0_ = pink_b1_ = pink_b2_ = 0.f;
    counter_ = 0;
    restart_sweep();
}

void InputGenerator::restart_sweep() {
    sweep_n_ = 0;
    sweep_freq_ = static_cast<double>(p_.from);
    phase_ = 0.0;
}

// After a parameter change mid-sweep: keep the position, recompute the frequency for it.
void InputGenerator::seek_sweep() {
    sweep_freq_ = static_cast<double>(p_.from) * std::pow(sweep_ratio_, static_cast<double>(sweep_n_));
}

float InputGenerator::next_noise() noexcept {
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    // Uniform in [-1, 1).
    const float white = static_cast<float>(static_cast<int32_t>(rng_)) * (1.0f / 2147483648.0f);
    if (!p_.pink) return white;
    pink_b0_ = 0.99765f * pink_b0_ + white * 0.0990460f;
    pink_b1_ = 0.96300f * pink_b1_ + white * 0.2965164f;
    pink_b2_ = 0.57000f * pink_b2_ + white * 1.0526913f;
    const float pink = (pink_b0_ + pink_b1_ + pink_b2_ + white * 0.1848f) * kPinkGain;
    return std::max(-1.f, std::min(1.f, pink));
}

float InputGenerator::next_sample() noexcept {
    const float amp = p_.amp;
    switch (kind_) {
    case GenKind::Silence:
        return 0.f;
    case GenKind::Noise:
        return amp * next_noise();
    case GenKind::Sine: {
        const float s = amp * static_cast<float>(std::sin(kTwoPi * phase_));
        phase_ += static_cast<double>(p_.freq) / sr_;
        if (phase_ >= 1.0) phase_ -= 1.0;
        return s;
    }
    case GenKind::Sweep: {
        const float s = amp * static_cast<float>(std::sin(kTwoPi * phase_));
        phase_ += sweep_freq_ / sr_;
        if (phase_ >= 1.0) phase_ -= 1.0;
        sweep_freq_ *= sweep_ratio_;
        if (++sweep_n_ >= sweep_len_) restart_sweep();
        return s;
    }
    case GenKind::Impulse: {
        const float s = counter_ == 0 ? amp : 0.f;
        if (++counter_ >= period_samples_) counter_ = 0;
        return s;
    }
    case GenKind::Step: {
        const float s = counter_ < period_samples_ ? 0.f : amp;
        if (++counter_ >= 2 * period_samples_) counter_ = 0;
        return s;
    }
    case GenKind::TwoTone: {
        const float s = amp * (kToneLowGain * static_cast<float>(std::sin(kTwoPi * phase_))
                             + kToneHighGain * static_cast<float>(std::sin(kTwoPi * phase2_)));
        phase_  += kToneLowHz / sr_;
        phase2_ += kToneHighHz / sr_;
        if (phase_ >= 1.0) phase_ -= 1.0;
        if (phase2_ >= 1.0) phase2_ -= 1.0;
        return s;
    }
    }
    return 0.f;
}

void InputGenerator::render(float* out, size_t frames) noexcept {
    for (size_t i = 0; i < frames; ++i) {
        const float s = next_sample();
        out[2 * i]     = s;
        out[2 * i + 1] = s;
    }
}

}  // namespace daisy_emu
