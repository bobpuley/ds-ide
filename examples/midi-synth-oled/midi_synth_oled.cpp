// MIDI synth with an OLED — the midi-synth example plus a 128x64 display that
// draws the selected waveform. See README.md.
//
//   Note On / Note Off   play and release a note (last note wins)
//   Control Change #1    selects the waveform (see WaveformFromCc below)
//   Volume pot  D15 (A0) output level
//   OLED (SPI1)          waveform shape, plus a square that lights while a note is held
//
// The emulator's display has pixel primitives only (Fill, DrawPixel, Update) and
// no text or fonts, so the waveform is drawn as a shape rather than named.

#include "daisy_seed.h"
#include "daisysp.h"
#include <algorithm>
#include <cmath>

using namespace daisy;
using namespace daisysp;

DaisySeed hardware;

// ds-ide:controls:begin
  AdcChannelConfig ds_ide_adc_cfg[1];
// ds-ide: id=volumePot, kind=pot, pin=15
// ds-ide:controls:end

// ds-ide:peripherals:begin
  MidiUsbHandler ds_ide_midi_usb;
  OledDisplay<SSD130x4WireSpi128x64Driver> ds_ide_oled;
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
static volatile int   s_shape    = 0;      // 0..4, index of the selected waveform
static volatile bool  s_dirty    = true;   // the display needs redrawing

// Five waveforms spread evenly over the 0..127 controller range:
//   0-25 sine, 26-51 triangle, 52-76 saw, 77-102 ramp, 103-127 square.
static int ShapeFromCc(uint8_t value) { return (value * 5) / 128; }

static const uint8_t kWaves[5] = {
    Oscillator::WAVE_SIN, Oscillator::WAVE_TRI, Oscillator::WAVE_SAW,
    Oscillator::WAVE_RAMP, Oscillator::WAVE_SQUARE,
};

// One sample of the selected shape at phase p in [0, 1), as -1..1. Matches the
// DaisySP waveforms: saw falls, ramp rises.
static float ShapeAt(int shape, float p)
{
    switch (shape)
    {
        case 0:  return std::sin(2.0f * 3.14159265f * p);
        case 1:  return p < 0.5f ? 4.0f * p - 1.0f : 3.0f - 4.0f * p;
        case 2:  return 1.0f - 2.0f * p;
        case 3:  return 2.0f * p - 1.0f;
        default: return p < 0.5f ? 1.0f : -1.0f;
    }
}

// Redraws the whole screen: the waveform (two cycles) and a gate square.
static void Draw()
{
    constexpr int kLeft = 8, kRight = 119, kMidY = 38, kAmp = 20;
    constexpr float kCycles = 2.0f;

    ds_ide_oled.Fill(false);

    int prevY = kMidY;
    for (int x = kLeft; x <= kRight; x++)
    {
        const float t = static_cast<float>(x - kLeft) / static_cast<float>(kRight - kLeft + 1);
        float       p = t * kCycles;
        p -= std::floor(p);
        const int y = kMidY - static_cast<int>(std::lround(ShapeAt(s_shape, p) * kAmp));

        // Join this column to the previous one so steep edges stay connected.
        const int lo = (x == kLeft) ? y : std::min(y, prevY);
        const int hi = (x == kLeft) ? y : std::max(y, prevY);
        for (int yy = lo; yy <= hi; yy++) ds_ide_oled.DrawPixel(x, yy, true);
        prevY = y;
    }

    // Gate indicator: a filled 6x6 square in the corner while a note is held.
    if (s_gate)
        for (int yy = 0; yy < 6; yy++)
            for (int xx = 0; xx < 6; xx++) ds_ide_oled.DrawPixel(xx, yy, true);

    ds_ide_oled.Update();
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
                if (s_note == n.note) { s_gate = false; s_note = -1; s_dirty = true; }
                break;
            }
            s_note     = n.note;
            s_freq     = mtof(static_cast<float>(n.note));
            s_velocity = static_cast<float>(n.velocity) / 127.0f;
            s_gate     = true;
            s_dirty    = true;
            break;
        }
        case MidiMessageType::NoteOff:
        {
            // Only release if it is the note we are playing (last note wins).
            if (s_note == msg.AsNoteOff().note) { s_gate = false; s_note = -1; s_dirty = true; }
            break;
        }
        case MidiMessageType::ControlChange:
        {
            const ControlChangeEvent cc = msg.AsControlChange();
            if (cc.control_number == kWaveformController)
            {
                s_shape = ShapeFromCc(cc.value);
                osc.SetWaveform(kWaves[s_shape]);
                s_dirty = true;
            }
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
  ds_ide_oled.Init();
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
    Draw();   // show the starting waveform
    hardware.StartAudio(AudioCallback);

    constexpr uint32_t kRefreshTicks = 250;
    uint32_t           ticks         = 0;

    for (;;)
    {
        ds_ide_midi_usb.Listen();
        while (ds_ide_midi_usb.HasEvents())
            HandleMidi(ds_ide_midi_usb.PopEvent());

        // Redraw when something changed, and about every 250 ms regardless, so a
        // display that connects late (the OLED panel opened after the effect
        // started) still gets a frame without waiting for the next MIDI message.
        if (s_dirty || ++ticks >= kRefreshTicks)
        {
            s_dirty = false;
            ticks   = 0;
            Draw();
        }
        System::Delay(1);   // one tick = about 1 ms
    }
}
