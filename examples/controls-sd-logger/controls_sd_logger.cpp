// Controls logger — the controls-tour example plus an SD card that records every
// action you take on a control. See README.md.
//
// Same controls and audio as controls-tour (pots, mute button, mode toggle,
// status/colour LEDs, encoder). What is new: each change is written as a line to
// actions.txt on the SD card.
//
// The pattern worth studying: the audio callback must never touch the SD card
// (file I/O can block for milliseconds, and an audio callback that blocks
// glitches). So the callback only *notices* changes and pushes small events into
// a lock-free queue; the main loop takes them out and does the file writes.

#include "daisy_seed.h"
#include <atomic>
#include <cmath>
#include <cstdio>

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

// ds-ide:peripherals:begin
  SdmmcHandler ds_ide_sd; FatFSInterface ds_ide_fatfs;
// ds-ide:peripherals:end

static constexpr int kGainChannel = 0;
static constexpr int kToneChannel = 1;
static constexpr float kDriveStep = 0.05f;

static float s_drive = 0.5f;
static float s_lowL  = 0.0f;
static float s_lowR  = 0.0f;

static float Clamp01(float x) { return x < 0.0f ? 0.0f : (x > 1.0f ? 1.0f : x); }

// ── Event queue: audio callback (producer) → main loop (consumer) ─────────────
//
// A single-producer, single-consumer ring buffer. No locks, no allocation, so it
// is safe to push from the audio callback. If the main loop falls behind and the
// ring fills up, new events are dropped rather than blocking the audio.

enum class EventKind : uint8_t { Gain, Tone, Mute, Mode, Drive };

struct Event
{
    EventKind kind;
    int       value;
};

static constexpr size_t kQueueSize = 64;           // must be a power of two
static Event               s_queue[kQueueSize];
static std::atomic<size_t> s_head{0};              // written by the audio callback
static std::atomic<size_t> s_tail{0};              // written by the main loop

static void Push(EventKind kind, int value)
{
    const size_t head = s_head.load(std::memory_order_relaxed);
    const size_t next = (head + 1) & (kQueueSize - 1);
    if (next == s_tail.load(std::memory_order_acquire)) return;   // full: drop
    s_queue[head] = {kind, value};
    s_head.store(next, std::memory_order_release);
}

static bool Pop(Event& out)
{
    const size_t tail = s_tail.load(std::memory_order_relaxed);
    if (tail == s_head.load(std::memory_order_acquire)) return false;   // empty
    out = s_queue[tail];
    s_tail.store((tail + 1) & (kQueueSize - 1), std::memory_order_release);
    return true;
}

// Last values already reported, so only a real change makes an event. Pots are
// reported in 10 % steps: a pot jitters, and an unquantised log would be noise.
static int  s_lastGain  = -1;
static int  s_lastTone  = -1;
static int  s_lastMode  = -1;
static int  s_lastDrive = -1;
static bool s_lastMuted = false;
static bool s_primed    = false;   // the first pass only records the starting state

static void AudioCallback(AudioHandle::InterleavingInputBuffer  in,
                          AudioHandle::InterleavingOutputBuffer out,
                          size_t                                size)
{
    muteBtn.Debounce();
    modeSwitch.Debounce();
    dial.Debounce();

    s_drive = Clamp01(s_drive + kDriveStep * static_cast<float>(dial.Increment()));

    const int   mode  = modeSwitch.Read();
    const bool  muted = muteBtn.Pressed();
    const float gain  = hardware.adc.GetFloat(kGainChannel);
    const float tone  = hardware.adc.GetFloat(kToneChannel);
    const float coeff = 0.02f + 0.98f * tone * tone;

    // Notice changes and queue them. Nothing here blocks.
    const int gainPct  = static_cast<int>(std::lround(gain * 10.0f)) * 10;
    const int tonePct  = static_cast<int>(std::lround(tone * 10.0f)) * 10;
    const int drivePct = static_cast<int>(std::lround(s_drive * 100.0f));
    // The very first pass just remembers where every control starts, so the log
    // holds only things the user did, not the initial positions.
    if (gainPct  != s_lastGain)  { s_lastGain  = gainPct;  if (s_primed) Push(EventKind::Gain,  gainPct); }
    if (tonePct  != s_lastTone)  { s_lastTone  = tonePct;  if (s_primed) Push(EventKind::Tone,  tonePct); }
    if (mode     != s_lastMode)  { s_lastMode  = mode;     if (s_primed) Push(EventKind::Mode,  mode); }
    if (drivePct != s_lastDrive) { s_lastDrive = drivePct; if (s_primed) Push(EventKind::Drive, drivePct); }
    if (muted    != s_lastMuted) { s_lastMuted = muted;    if (s_primed) Push(EventKind::Mute,  muted ? 1 : 0); }
    s_primed = true;

    for (size_t i = 0; i < size; i += 2)
    {
        float l = in[i];
        float r = in[i + 1];

        if (mode == 1)
        {
            const float k = 1.0f + 9.0f * s_drive;
            l = std::tanh(l * k);
            r = std::tanh(r * k);
        }
        else if (mode == 2)
        {
            const float levels = 64.0f - 60.0f * s_drive;
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

    const float level = 0.15f + 0.85f * s_drive;
    colorLed.Set(mode == 0 ? 0.0f : level, mode == 2 ? 0.0f : level, 0.0f);
    colorLed.Update();
}

// ── Main loop: turn events into lines on the SD card ──────────────────────────

static FIL      s_file;
static bool     s_fileOpen = false;
static unsigned s_lineNo   = 0;

static void WriteLine(const char* text)
{
    char line[64];
    const int n = std::snprintf(line, sizeof(line), "%u %s\n", ++s_lineNo, text);
    if (n <= 0) return;
    unsigned written = 0;
    f_write(&s_file, line, static_cast<unsigned>(n), &written);
}

static void LogEvent(const Event& e)
{
    char text[48];
    switch (e.kind)
    {
        case EventKind::Gain:  std::snprintf(text, sizeof(text), "gain %d%%",  e.value); break;
        case EventKind::Tone:  std::snprintf(text, sizeof(text), "tone %d%%",  e.value); break;
        case EventKind::Drive: std::snprintf(text, sizeof(text), "drive %d%%", e.value); break;
        case EventKind::Mode:  std::snprintf(text, sizeof(text), "mode %d",    e.value); break;
        case EventKind::Mute:  std::snprintf(text, sizeof(text), e.value ? "mute pressed" : "mute released"); break;
    }
    WriteLine(text);
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

// ds-ide:peripherals:init:begin
  ds_ide_sd.Init();
  ds_ide_fatfs.Init();
// ds-ide:peripherals:init:end

    // Mount the card and start a fresh log for this run.
    if (f_mount(&ds_ide_fatfs.GetSDFileSystem(), "/", 1) == FR_OK
        && f_open(&s_file, "actions.txt", FA_WRITE | FA_CREATE_ALWAYS) == FR_OK)
    {
        s_fileOpen = true;
        WriteLine("session start");
        f_sync(&s_file);
    }

    hardware.adc.Start();
    hardware.StartAudio(AudioCallback);

    for (;;)
    {
        bool wrote = false;
        Event e;
        while (Pop(e))
        {
            if (s_fileOpen) { LogEvent(e); wrote = true; }
        }
        // Flush so the lines are on the card (and visible in the viewer) now,
        // not only when the file is closed.
        if (wrote) f_sync(&s_file);
        System::Delay(10);
    }
}
