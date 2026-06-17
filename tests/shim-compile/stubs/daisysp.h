#pragma once

// Minimal DaisySP stub for shim compile-tests.
// Declares only what the v1 example corpus (Osc) uses.  The real DaisySP is
// compiled unchanged into the emulator (FR-SH-6); this stub is never shipped.

namespace daisysp {

enum AdEnvSeg { ADENV_SEG_ATTACK = 0, ADENV_SEG_DECAY = 1 };

class Oscillator {
public:
    enum Waveform { WAVE_SIN = 0 };

    void  Init(float sample_rate);
    void  SetWaveform(int waveform);
    void  SetAmp(float amp);
    void  SetFreq(float freq);
    float Process();
};

class AdEnv {
public:
    void  Init(float sample_rate);
    void  SetTime(AdEnvSeg seg, float time);
    void  SetMin(float min);
    void  SetMax(float max);
    void  SetCurve(float curve);
    void  Trigger();
    float Process();
};

inline float mtof(float midi_note) { return 440.f * 1.f; (void)midi_note; }

} // namespace daisysp

// Bring ADENV_SEG_* into global scope — DaisySP normally does this.
using daisysp::ADENV_SEG_ATTACK;
using daisysp::ADENV_SEG_DECAY;
