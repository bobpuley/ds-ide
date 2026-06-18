// M10 AC-11 test fixture: a virtual button gates the audio, and the onboard
// LED reflects the button state.
//
//   button pressed  → pass audio through (out = in), LED on
//   button released → mute (out = 0),            LED off
//
// Exercises both halves of AC-11: (a) a button press changes the effect output,
// and (b) the effect lighting an LED (hw.SetLed) drives the virtual indicator.
// Bare libDaisy (no DaisySP) so it always builds.

#include "daisy_seed.h"

using namespace daisy;

DaisySeed hw;
Switch     button;

static void Callback(AudioHandle::InterleavingInputBuffer  in,
                     AudioHandle::InterleavingOutputBuffer out,
                     size_t                                size)
{
    button.Debounce();
    bool active = button.Pressed();
    hw.SetLed(active);
    for (size_t i = 0; i < size; i++)
        out[i] = active ? in[i] : 0.0f;
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(4);
    button.Init(hw.GetPin(28), 1000);
    hw.StartAudio(Callback);
    while (1) {}
}
