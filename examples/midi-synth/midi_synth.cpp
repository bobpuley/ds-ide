// MIDI synth — a monophonic synth played from USB MIDI. See README.md.
//
//   Note On / Note Off   play and release a note (last note wins)
//   Control Change #1    selects the waveform (see WaveformFromCc below)
//   Volume pot  D15 (A0) output level
//
// In the emulator, notes and Control Change messages come from the MIDI panel
// (an on-screen keyboard plus a Control Change sender), so no hardware
// controller is needed.

#include "daisy_seed.h"
#include "daisysp.h"

using namespace daisy;
using namespace daisysp;

DaisySeed hardware;

// ds-ide:controls:begin
  AdcChannelConfig ds_ide_adc_cfg[1];
// ds-ide: id=volumePot, kind=pot, pin=15
// ds-ide:controls:end

// ds-ide:peripherals:begin
  MidiUsbHandler ds_ide_midi_usb;
// ds-ide:peripherals:end

static constexpr uint8_t kWaveformController = 1;   // CC #1, the mod wheel

static Oscillator osc;
static Adsr       env;

// Shared between the main loop (MIDI) and the audio callback. A single float or
// bool written on one side and read on the other is fine for a demo; a real
// instrument would pass events through a lock-free queue.
static volatile float s_freq     = 440.0f;
static volatile float s_velocity = 0.0f;
static volatile bool  s_gate     = false;
static volatile int   s_note     = -1;     // note currently held, or -1

// Five waveforms spread evenly over the 0..127 controller range:
//   0-25 sine, 26-51 triangle, 52-76 saw, 77-102 ramp, 103-127 square.
static uint8_t WaveformFromCc(uint8_t value)
{
    static const uint8_t kWaves[5] = {
        Oscillator::WAVE_SIN, Oscillator::WAVE_TRI, Oscillator::WAVE_SAW,
        Oscillator::WAVE_RAMP, Oscillator::WAVE_SQUARE,
    };
    return kWaves[(value * 5) / 128];
}

static void HandleMidi(const MidiEvent& msg)
{
    switch (msg.type)
    {
        case MidiMessageType::NoteOn:
        {
            const NoteOnEvent n = msg.AsNoteOn();
            // A Note On with velocity 0 means Note Off in much real-world MIDI.
            if (n.velocity == 0)
            {
                if (s_note == n.note) { s_gate = false; s_note = -1; }
                break;
            }
            s_note     = n.note;
            s_freq     = mtof(static_cast<float>(n.note));
            s_velocity = static_cast<float>(n.velocity) / 127.0f;
            s_gate     = true;
            break;
        }
        case MidiMessageType::NoteOff:
        {
            // Only release if it is the note we are playing (last note wins).
            if (s_note == msg.AsNoteOff().note) { s_gate = false; s_note = -1; }
            break;
        }
        case MidiMessageType::ControlChange:
        {
            const ControlChangeEvent cc = msg.AsControlChange();
            if (cc.control_number == kWaveformController)
                osc.SetWaveform(WaveformFromCc(cc.value));
            break;
        }
        default:
            break;
    }
}

static void AudioCallback(AudioHandle::InterleavingInputBuffer  in,
                          AudioHandle::InterleavingOutputBuffer out,
                          size_t                                size)
{
    (void)in;
    const float volume = hardware.adc.GetFloat(0);

    osc.SetFreq(s_freq);
    for (size_t i = 0; i < size; i += 2)
    {
        const float sample = osc.Process() * env.Process(s_gate) * s_velocity * volume;
        out[i]     = sample;
        out[i + 1] = sample;
    }
}

int main(void)
{
    hardware.Init();
    hardware.SetAudioBlockSize(4);
    const float sr = hardware.AudioSampleRate();

// ds-ide:controls:init:begin
  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);
  hardware.adc.Init(ds_ide_adc_cfg, 1);
// ds-ide:controls:init:end

// ds-ide:peripherals:init:begin
  MidiUsbHandler::Config ds_ide_midi_usb_cfg;
  ds_ide_midi_usb_cfg.transport_config.periph = MidiUsbTransport::Config::INTERNAL;
  ds_ide_midi_usb.Init(ds_ide_midi_usb_cfg);
// ds-ide:peripherals:init:end

    osc.Init(sr);
    osc.SetWaveform(Oscillator::WAVE_SIN);
    osc.SetAmp(0.5f);

    env.Init(sr);
    env.SetTime(ADSR_SEG_ATTACK, 0.01f);
    env.SetTime(ADSR_SEG_DECAY, 0.10f);
    env.SetTime(ADSR_SEG_RELEASE, 0.20f);
    env.SetSustainLevel(0.7f);

    hardware.adc.Start();
    hardware.StartAudio(AudioCallback);

    for (;;)
    {
        ds_ide_midi_usb.Listen();
        while (ds_ide_midi_usb.HasEvents())
            HandleMidi(ds_ide_midi_usb.PopEvent());
        System::Delay(1);
    }
}
