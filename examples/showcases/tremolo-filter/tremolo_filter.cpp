// Showcase — Tremolo + Resonant Filter
//
// Demonstrates the full ds-ide workflow for someone evaluating the tool:
//
//   STEP 1 — Open "Controls Editor" in the sidebar BEFORE building.
//            Design mode shows the 4 pots, bypass button, and beat LED on the
//            canvas.  Drag them, inspect their pin assignments, open the
//            Wiring Editor to see every control mapped to the Daisy Seed pinout.
//
//   STEP 2 — "Build for Emulator", then "Deploy & Start".
//            Controls Editor auto-switches to run mode.
//
//   STEP 3 — Interact and watch three things change at once:
//            · Rate pot  → LFO frequency changes — scope ripple speeds up/slows
//                          down AND the beat LED blinks at exactly the same rate.
//            · Depth pot → tremolo depth — ripple amplitude grows or collapses.
//            · Cutoff pot → filter cutoff — scope waveform brightens or darkens.
//            · Res pot    → resonance — push past 0.8 for audible self-resonance.
//            · Bypass btn → toggle — freezes the tremolo, LED goes solid, dry
//                           sine passes through untouched.
//
// Pin map (reflected in controllers.yaml and the Wiring Editor):
//   D15  A0  ch0  Rate pot      LFO frequency 0.1–10 Hz
//   D16  A1  ch1  Depth pot     tremolo depth 0–100 %
//   D17  A2  ch2  Cutoff pot    SVF cutoff 200–8000 Hz
//   D18  A3  ch3  Res pot       SVF resonance 0–0.9
//   D28           Bypass button toggle — dry pass-through
//   D23           Beat LED      brightness follows the LFO

#include "daisy_seed.h"
#include "daisysp.h"

using namespace daisy;
using namespace daisysp;

DaisySeed hw;

// ds-ide:controls:begin
AdcChannelConfig ratePot;    // ds-ide: id=ratePot,   kind=pot,    pin=15
AdcChannelConfig depthPot;   // ds-ide: id=depthPot,  kind=pot,    pin=16
AdcChannelConfig cutoffPot;  // ds-ide: id=cutoffPot, kind=pot,    pin=17
AdcChannelConfig resPot;     // ds-ide: id=resPot,    kind=pot,    pin=18
Switch           bypassBtn;  // ds-ide: id=bypassBtn, kind=button, pin=28
Led              beatLed;    // ds-ide: id=beatLed,   kind=led,    pin=23
// ds-ide:controls:end

Oscillator lfo;
Svf        filterL, filterR;

static bool s_bypassed = false;

static constexpr float kMinRate   = 0.1f;
static constexpr float kMaxRate   = 10.0f;
static constexpr float kMinCutoff = 200.0f;
static constexpr float kMaxCutoff = 8000.0f;

static void AudioCallback(AudioHandle::InterleavingInputBuffer  in,
                          AudioHandle::InterleavingOutputBuffer out,
                          size_t                                size)
{
    bypassBtn.Debounce();
    if (bypassBtn.RisingEdge()) s_bypassed = !s_bypassed;

    float rate       = hw.adc.GetFloat(0);
    float depth      = hw.adc.GetFloat(1);
    float cutoffNorm = hw.adc.GetFloat(2);
    float res        = hw.adc.GetFloat(3) * 0.9f; // cap below self-oscillation threshold

    float lfoFreq = kMinRate + rate * (kMaxRate - kMinRate);
    float cutoff  = kMinCutoff + cutoffNorm * (kMaxCutoff - kMinCutoff);

    lfo.SetFreq(lfoFreq);
    filterL.SetFreq(cutoff); filterL.SetRes(res);
    filterR.SetFreq(cutoff); filterR.SetRes(res);

    float lastLfoVal = 0.5f;
    for (size_t i = 0; i < size; i += 2)
    {
        lastLfoVal     = (lfo.Process() + 1.0f) * 0.5f;           // [0, 1]
        float gain     = s_bypassed ? 1.0f
                                    : 1.0f - depth + depth * lastLfoVal;

        filterL.Process(in[i]     * gain);
        filterR.Process(in[i + 1] * gain);

        out[i]     = s_bypassed ? in[i]     : filterL.Low();
        out[i + 1] = s_bypassed ? in[i + 1] : filterR.Low();
    }

    // LED blinks on the high half of the LFO cycle (> 0.5) — binary gpio,
    // solid when bypassed so the visual immediately flags the bypass state
    beatLed.Set(!s_bypassed && lastLfoVal > 0.5f ? 1.0f : 0.0f);
    beatLed.Update();
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(4);
    float sr = hw.AudioSampleRate();

    AdcChannelConfig adcCfg[4];
    adcCfg[0].InitSingle(hw.GetPin(15)); // ratePot
    adcCfg[1].InitSingle(hw.GetPin(16)); // depthPot
    adcCfg[2].InitSingle(hw.GetPin(17)); // cutoffPot
    adcCfg[3].InitSingle(hw.GetPin(18)); // resPot
    hw.adc.Init(adcCfg, 4);
    hw.adc.Start();

    bypassBtn.Init(hw.GetPin(28), 1000);
    beatLed.Init(hw.GetPin(23), false);

    lfo.Init(sr);
    lfo.SetWaveform(Oscillator::WAVE_SIN);
    lfo.SetAmp(1.0f);
    lfo.SetFreq(2.0f);

    filterL.Init(sr); filterL.SetFreq(4000.0f); filterL.SetRes(0.3f); filterL.SetDrive(0.0f);
    filterR.Init(sr); filterR.SetFreq(4000.0f); filterR.SetRes(0.3f); filterR.SetDrive(0.0f);

    hw.StartAudio(AudioCallback);

    for (;;) { System::Delay(1); }
}
