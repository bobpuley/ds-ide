// M10 demo effect — exercises pots, buttons (toggle + momentary), and LEDs
// (onboard via SetLed, external via the Led class). Pair with controllers.yaml
// in this folder, then deploy to the emulator and open the scope panel.
//
//   Volume pot (ADC0) ....... scales the output level
//   Bypass button (pin 28) .. TOGGLE: click to pass audio (on) or mute (off)
//   Boost  button (pin 25) .. MOMENTARY: full level while held
//   Status LED (pin 23) ..... onboard LED, lit while audio is passing
//   Boost LED  (pin 18) ..... external LED, lit while Boost is held
//
// Bare libDaisy (no DaisySP).

#include "daisy_seed.h"

using namespace daisy;

DaisySeed hw;
Switch     bypassBtn;   // pin 28 — toggle in the UI
Switch     boostBtn;    // pin 25 — momentary in the UI
Led        boostLed;    // pin 18 — external LED
float      volume = 0.8f;

static void Callback(AudioHandle::InterleavingInputBuffer  in,
                     AudioHandle::InterleavingOutputBuffer out,
                     size_t                                size)
{
    bypassBtn.Debounce();
    boostBtn.Debounce();

    bool passing = bypassBtn.Pressed();   // latched audio-on
    bool boost   = boostBtn.Pressed();    // held boost

    float gain = 0.0f;
    if (passing) gain = boost ? 1.0f : volume;

    hw.SetLed(passing);                   // onboard LED reflects audio-on
    boostLed.Set(boost ? 1.0f : 0.0f);    // external LED reflects boost
    boostLed.Update();

    for (size_t i = 0; i < size; i++)
        out[i] = in[i] * gain;
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(4);

    bypassBtn.Init(hw.GetPin(28), 1000);
    boostBtn.Init(hw.GetPin(25), 1000);
    boostLed.Init(hw.GetPin(18), false);

    AdcChannelConfig adcCfg;
    adcCfg.InitSingle(hw.GetPin(21));     // ADC0 (volume pot)
    hw.adc.Init(&adcCfg, 1);
    hw.adc.Start();

    hw.StartAudio(Callback);

    for (;;)
    {
        volume = hw.adc.GetFloat(0);
        System::Delay(1);
    }
}
