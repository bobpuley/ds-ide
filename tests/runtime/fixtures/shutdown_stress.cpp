// Shutdown stress fixture: the effect thread polls MIDI in a tight loop, so it
// locks the shared MIDI queue's mutex (a member of the global emulator state)
// continuously, right up to process exit. If process termination destroys that
// state while this thread still runs, its next lock fails with
// "mutex lock failed: Invalid argument" and libc++ aborts.
#include "daisy_seed.h"
#include "daisy/midi_usb_handler.h"

using namespace daisy;

DaisySeed hw;
MidiUsbHandler midi;

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
    volatile bool sink = false;
    while (1) { sink = midi.HasEvents(); (void)sink; }
}
