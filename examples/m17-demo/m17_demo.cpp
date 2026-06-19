// M17 demo — Controls Editor v3 (two-mode panel, convention block).
//
// This file shows the ds-ide:controls convention (D15) in use.
// Build with the emulator, then open "Controls Editor" in the panel:
//   - Design mode: see the pot, bypass button, and status LED as cards on the canvas.
//   - Start audio (emulator running) → Controls Editor auto-switches to Run mode.
//   - Run mode: move the Volume slider → changes audio gain; click Bypass → mutes/passes audio.
//
// Pin assignments:
//   Volume pot    — A0  (D15): adcChannel 0 in software  (pin-15 = 0)
//   Bypass button — D28: GPIO pin 28
//   Status LED    — D23: onboard LED (gpio pin 23)
//
// Bare libDaisy (no DaisySP).

#include "daisy_seed.h"

using namespace daisy;

DaisySeed hw;

// ds-ide:controls:begin
AdcChannelConfig volumePot;   // ds-ide: id=volumePot, kind=pot, pin=15
Switch           bypassBtn;   // ds-ide: id=bypassBtn, kind=button, pin=28
Led              statusLed;   // ds-ide: id=statusLed, kind=led, pin=23
// ds-ide:controls:end

float volume = 0.8f;

static void Callback(AudioHandle::InterleavingInputBuffer  in,
                     AudioHandle::InterleavingOutputBuffer out,
                     size_t                                size)
{
    bypassBtn.Debounce();
    bool passing = bypassBtn.Pressed();

    hw.SetLed(passing);
    statusLed.Set(passing ? 1.0f : 0.0f);
    statusLed.Update();

    float gain = passing ? volume : 0.0f;
    for (size_t i = 0; i < size; i++)
        out[i] = in[i] * gain;
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(4);

    bypassBtn.Init(hw.GetPin(28), 1000);
    statusLed.Init(hw.GetPin(23), false);

    volumePot.InitSingle(hw.GetPin(15));   // A0 — adcChannel 0
    hw.adc.Init(&volumePot, 1);
    hw.adc.Start();

    hw.StartAudio(Callback);

    for (;;)
    {
        volume = hw.adc.GetFloat(0);
        System::Delay(1);
    }
}
