// M16b audio-output demo: stereo passthrough with audible confirmation tone.
//
// What this does:
//   - In Sine input mode:  passes the sine wave through to both output channels.
//     You should hear a pure 440 Hz (default) tone from your speakers.
//   - In WAV input mode:   passes WAV audio through to output.
//   - In Live (mic) mode:  passes live mic input to output (monitoring).
//
// Build in VS Code:  "Daisy IDE: Build for Emulator"  (select this file as project source)
// Then:             "Daisy IDE: Deploy to Emulator"
//            then:  "Daisy IDE: Start Audio"
//
// Expected result: you hear audio from your default output device immediately.
// If silent: open the Emulator section in the scope panel and confirm the
// source is set to "Sine" and the "Vol" slider is > 0.

#include "daisy_seed.h"

using namespace daisy;

DaisySeed hw;

static void AudioCallback(AudioHandle::InterleavingInputBuffer  in,
                          AudioHandle::InterleavingOutputBuffer out,
                          size_t                                size)
{
    // Simple stereo passthrough: out = in.
    // With Sine input this produces an audible sine wave on the speakers.
    for (size_t i = 0; i < size; i++)
        out[i] = in[i];
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(256);
    hw.StartAudio(AudioCallback);
    while (1) {}
}
