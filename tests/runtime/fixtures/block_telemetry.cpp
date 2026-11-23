// FR-EMU-12 / FR-EMU-13 e2e fixture: reports what the audio callback really
// receives, and sends telemetry from two threads at once.
//
//   Audio callback (audio thread):
//     - records the min/max frame count it is called with;
//     - every 64 callbacks, sends a MIDI note-on on channel 1 carrying a
//       14-bit sequence number (data1 = high 7 bits, data2 = low 7 bits);
//     - toggles the onboard LED (hw.SetLed, D23) every 64 callbacks.
//   Main loop (effect thread), every 20 ms:
//     - sends CC 20 = min and CC 21 = max frames seen since the last report
//       (each split into two CCs: value = low 7 bits, CC+10 = high 7 bits),
//       then resets them;
//     - sends a note-on on channel 2 with its own sequence number;
//     - toggles an external Led on D18.
// Audio passes through unchanged. Bare libDaisy (no DaisySP) so it always builds.

#include "daisy_seed.h"
#include <atomic>
#include <cstdint>

using namespace daisy;

DaisySeed      hw;
MidiUsbHandler midi;
Led            loopLed;

static std::atomic<uint32_t> g_min{UINT32_MAX};
static std::atomic<uint32_t> g_max{0};
static uint32_t g_cb_count = 0;   // audio thread only
static uint32_t g_cb_seq   = 0;   // audio thread only

static void send3(uint8_t a, uint8_t b, uint8_t c) {
    uint8_t msg[3] = { a, static_cast<uint8_t>(b & 0x7f), static_cast<uint8_t>(c & 0x7f) };
    midi.SendMessage(msg, 3);
}

static void Callback(AudioHandle::InterleavingInputBuffer  in,
                     AudioHandle::InterleavingOutputBuffer out,
                     size_t                                size)
{
    const uint32_t frames = static_cast<uint32_t>(size / 2);
    uint32_t cur = g_min.load(std::memory_order_relaxed);
    while (frames < cur && !g_min.compare_exchange_weak(cur, frames)) {}
    cur = g_max.load(std::memory_order_relaxed);
    while (frames > cur && !g_max.compare_exchange_weak(cur, frames)) {}

    if (++g_cb_count % 64 == 0) {
        send3(0x90, static_cast<uint8_t>(g_cb_seq >> 7), static_cast<uint8_t>(g_cb_seq));
        ++g_cb_seq;
        hw.SetLed((g_cb_count / 64) & 1);
    }
    for (size_t i = 0; i < size; i++) out[i] = in[i];
}

int main(void)
{
    hw.Init();
    hw.SetAudioBlockSize(4);
    midi.Init();
    loopLed.Init(hw.GetPin(18), false);
    hw.StartAudio(Callback);

    uint32_t seq = 0;
    bool lit = false;
    while (1) {
        System::Delay(20);
        const uint32_t mn = g_min.exchange(UINT32_MAX);
        const uint32_t mx = g_max.exchange(0);
        if (mx > 0) {
            send3(0xB0, 20, static_cast<uint8_t>(mn));
            send3(0xB0, 30, static_cast<uint8_t>(mn >> 7));
            send3(0xB0, 21, static_cast<uint8_t>(mx));
            send3(0xB0, 31, static_cast<uint8_t>(mx >> 7));
        }
        send3(0x91, static_cast<uint8_t>(seq >> 7), static_cast<uint8_t>(seq));
        ++seq;
        lit = !lit;
        loopLed.Set(lit ? 1.f : 0.f);
        loopLed.Update();
    }
}
