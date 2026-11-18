// Controls tour — one of every basic control the emulator offers, each wired to
// something you can hear or see. See README.md for the walkthrough.
//
// Bare libDaisy: no DaisySP, so it builds with nothing but the extension.
//
//   Gain pot     D15 (A0)  output level
//   Tone pot     D16 (A1)  low-pass brightness (a one-pole filter written here)
//   Mute button  D28       hold to silence the output          (Switch)
//   Mode switch  D27       3 positions: clean / soft clip / bit crush (Switch3)
//   Status LED   D23       lit while audio is passing          (Led)
//   Colour LED   D18-D20   mode colour, brightness = drive     (RgbLed)
//   Dial         D24-D26   turn = drive amount               (Encoder)

#include "daisy_seed.h"
#include <cmath>

using namespace daisy;

DaisySeed hardware;

// ds-ide:controls:begin
  AdcChannelConfig ds_ide_adc_cfg[2];
// ds-ide: id=gainPot, kind=pot, pin=15
// ds-ide: id=tonePot, kind=pot, pin=16
Switch muteBtn; // ds-ide: id=muteBtn, kind=button, pin=28
Switch3 modeSwitch; // ds-ide: id=modeSwitch, kind=toggle, pin=27
Led statusLed; // ds-ide: id=statusLed, kind=led, pin=23
RgbLed colorLed; // ds-ide: id=colorLed, kind=rgbled, pin=18, pins=18,19,20
Encoder dial; // ds-ide: id=dial, kind=encoder, pin=24, pins=24,25,26
// ds-ide:controls:end

// Pot channels are the positions in ds_ide_adc_cfg[] above.
static constexpr int kGainChannel = 0;
static constexpr int kToneChannel = 1;

static constexpr float kDriveStep    = 0.05f;

static float s_drive = 0.5f;
static float s_lowL  = 0.0f;  // one-pole filter state, left
static float s_lowR  = 0.0f;  // one-pole filter state, right

static float Clamp01(float x) { return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x); }

static void AudioCallback(AudioHandle::InterleavingInputBuffer  in,
                          AudioHandle::InterleavingOutputBuffer out,
                          size_t                                size)
{
    muteBtn.Debounce();
    modeSwitch.Debounce();
    dial.Debounce();

    // Encoder: each detent moves the drive amount up or down.
    s_drive = Clamp01(s_drive + kDriveStep * static_cast<float>(dial.Increment()));

    const int   mode  = modeSwitch.Read();                  // 0, 1 or 2
    const bool  muted = muteBtn.Pressed();
    const float gain  = hardware.adc.GetFloat(kGainChannel);
    const float tone  = hardware.adc.GetFloat(kToneChannel);
    // Tone 1.0 = fully open; 0.0 = very dark. Coefficient of the one-pole filter.
    const float coeff = 0.02f + 0.98f * tone * tone;

    for (size_t i = 0; i < size; i += 2)
    {
        float l = in[i];
        float r = in[i + 1];

        if (mode == 1)            // soft clip: the more drive, the harder it squashes
        {
            const float k = 1.0f + 9.0f * s_drive;
            l = std::tanh(l * k);
            r = std::tanh(r * k);
        }
        else if (mode == 2)       // bit crush: fewer levels as drive rises
        {
            const float levels = 64.0f - 60.0f * s_drive;   // 64 .. 4 levels
            l = std::round(l * levels) / levels;
            r = std::round(r * levels) / levels;
        }

        s_lowL += coeff * (l - s_lowL);
        s_lowR += coeff * (r - s_lowR);

        const float g = muted ? 0.0f : gain;
        out[i]     = s_lowL * g;
        out[i + 1] = s_lowR * g;
    }

    statusLed.Set(muted ? 0.0f : 1.0f);
    statusLed.Update();

    // Mode colour: 0 green, 1 yellow, 2 red, all scaled by the drive amount.
    const float level = 0.15f + 0.85f * s_drive;
    colorLed.Set(mode == 0 ? 0.0f : level, mode == 2 ? 0.0f : level, 0.0f);
    colorLed.Update();
}

int main(void)
{
    hardware.Init();
    hardware.SetAudioBlockSize(4);

// ds-ide:controls:init:begin
  muteBtn.Init(daisy::seed::D28, hardware.AudioCallbackRate());
  modeSwitch.Init(daisy::seed::D27);
  statusLed.Init(daisy::seed::D23, false);
  colorLed.Init(daisy::seed::D18, daisy::seed::D19, daisy::seed::D20);
  dial.Init(daisy::seed::D24, daisy::seed::D25, daisy::seed::D26);
  ds_ide_adc_cfg[0].InitSingle(daisy::seed::A0);
  ds_ide_adc_cfg[1].InitSingle(daisy::seed::A1);
  hardware.adc.Init(ds_ide_adc_cfg, 2);
// ds-ide:controls:init:end

    hardware.adc.Start();
    hardware.StartAudio(AudioCallback);

    for (;;) { System::Delay(1); }
}
