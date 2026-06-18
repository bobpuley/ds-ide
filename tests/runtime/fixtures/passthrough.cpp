// M14 test fixture: simple stereo passthrough (out = in, no state, no DaisySP).
// Used to verify that replay produces identical output to the original recording.
#include "daisy_seed.h"

using namespace daisy;

DaisySeed hw;

static void Callback(AudioHandle::InterleavingInputBuffer  in,
                     AudioHandle::InterleavingOutputBuffer out,
                     size_t                                size)
{
    for (size_t i = 0; i < size; i++)
        out[i] = in[i];
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(48);
    hw.StartAudio(Callback);
    while (1) {}
}
