// FR-EMU-13: LED and MIDI output called concurrently from two threads — the
// effect's main loop and the audio callback — as valid Daisy effects do.
// Built with -fsanitize=thread by run_tests.sh: any data race makes TSAN
// report and the binary exit non-zero.
//
//   LEDs are state: the drain side receives the latest value of each LED.
//   MIDI is an event stream: every message arrives intact, in per-thread
//   order, or is counted as dropped — never silently lost or corrupted.

#include "daisy/daisy_seed_class.h"
#include "daisy/led.h"
#include "daisy/rgb_led.h"
#include "daisy/midi_uart_handler.h"
#include "daisy/midi_usb_handler.h"
#include "emulator_state.h"
#include "led_telemetry.h"

#include <atomic>
#include <cstdio>
#include <string>
#include <thread>
#include <vector>

namespace daisy_emu { EmulatorState g_state; }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static constexpr int kPerThread = 4000;  // < 2^14, encoded in data1/data2

static void send(daisy::MidiUartHandler& uart, uint8_t status, int i) {
    uint8_t b[3] = { status, static_cast<uint8_t>((i >> 7) & 0x7f), static_cast<uint8_t>(i & 0x7f) };
    uart.SendMessage(b, 3);
}
static void send(daisy::MidiUsbHandler& usb, uint8_t status, int i) {
    uint8_t b[3] = { status, static_cast<uint8_t>((i >> 7) & 0x7f), static_cast<uint8_t>(i & 0x7f) };
    usb.SendMessage(b, 3);
}

static void test_midi_two_producers() {
    std::printf("--- MIDI: two producer threads, one consumer (FR-EMU-13) ---\n");
    std::atomic<int> done{0};
    std::vector<std::string> got;
    std::thread consumer([&] {
        std::string m;
        for (;;) {
            if (daisy_emu::g_state.midi_tx_queue.pop(m)) { got.push_back(m); continue; }
            if (done.load() == 2) {
                while (daisy_emu::g_state.midi_tx_queue.pop(m)) got.push_back(m);
                break;
            }
            std::this_thread::yield();
        }
    });
    std::thread main_loop([&] {  // the effect's while(1) loop
        daisy::MidiUartHandler uart;
        for (int i = 0; i < kPerThread; ++i) send(uart, 0x90, i);
        done.fetch_add(1);
    });
    std::thread audio_cb([&] {   // the audio callback, e.g. sending MIDI clock
        daisy::MidiUsbHandler usb;
        for (int i = 0; i < kPerThread; ++i) send(usb, 0x91, i);
        done.fetch_add(1);
    });
    main_loop.join(); audio_cb.join(); consumer.join();

    int last[2] = { -1, -1 };
    bool intact = true, ordered = true;
    for (const auto& m : got) {
        unsigned status = 0, d1 = 0, d2 = 0;
        if (std::sscanf(m.c_str(), "{\"type\":\"midiTx\",\"status\":%u,\"data1\":%u,\"data2\":%u", &status, &d1, &d2) != 3
            || (status != 0x90 && status != 0x91) || m.back() != '}') { intact = false; continue; }
        const int t = static_cast<int>(status - 0x90);
        const int seq = static_cast<int>((d1 << 7) | d2);
        if (seq <= last[t]) ordered = false;
        last[t] = seq;
    }
    const uint32_t dropped = daisy_emu::g_state.midi_tx_queue_drops.load();
    CHECK(intact, "every MIDI message arrives intact (no torn or mixed slots)");
    CHECK(ordered, "messages from each thread arrive in the order they were sent");
    char msg[160];
    std::snprintf(msg, sizeof(msg), "received (%zu) + counted drops (%u) == sent (%d)",
                  got.size(), dropped, 2 * kPerThread);
    CHECK(got.size() + dropped == static_cast<size_t>(2 * kPerThread), msg);
}

static void test_midi_full_queue_counts_drops() {
    std::printf("--- MIDI: a full queue counts drops instead of losing them silently (FR-EMU-13) ---\n");
    const uint32_t drops_before = daisy_emu::g_state.midi_tx_queue_drops.load();
    constexpr int kEach = 1500;  // 3000 sends into a 1024-slot queue, no consumer
    std::thread a([] { daisy::MidiUartHandler uart; for (int i = 0; i < kEach; ++i) send(uart, 0x90, i); });
    std::thread b([] { daisy::MidiUsbHandler usb;   for (int i = 0; i < kEach; ++i) send(usb, 0x91, i); });
    a.join(); b.join();
    std::string m;
    size_t got = 0;
    while (daisy_emu::g_state.midi_tx_queue.pop(m)) ++got;
    const uint32_t dropped = daisy_emu::g_state.midi_tx_queue_drops.load() - drops_before;
    char msg[160];
    std::snprintf(msg, sizeof(msg), "queue holds its capacity (%zu of 1024) and the rest is counted (%u)", got, dropped);
    CHECK(got == 1024 && got + dropped == static_cast<size_t>(2 * kEach), msg);
}

static void test_led_two_producers() {
    std::printf("--- LED / RGB LED: two producer threads, drain samples (FR-EMU-13) ---\n");
    daisy_emu::LedSampler sampler;
    std::atomic<bool> stop{false};
    std::vector<std::string> got;
    std::thread drain([&] {
        while (!stop.load()) {
            sampler.collect([&](const char* m) { got.push_back(m); });
            std::this_thread::yield();
        }
    });
    std::thread main_loop([] {
        daisy::Led led;
        led.Init(dsy_gpio_pin{0, 18}, false);
        daisy::RgbLed rgb;
        rgb.Init(dsy_gpio_pin{0, 5}, dsy_gpio_pin{0, 6}, dsy_gpio_pin{0, 7}, false);
        for (int i = 0; i < kPerThread; ++i) {
            led.Set((i & 1) ? 1.f : 0.f); led.Update();
            rgb.Set(0.25f, (i & 1) ? 0.5f : 0.f, 0.75f); rgb.Update();
        }
    });
    std::thread audio_cb([] {  // per-block LED meter + onboard LED
        daisy::DaisySeed hw;
        daisy::Led led;
        led.Init(dsy_gpio_pin{0, 18}, false);
        for (int i = 0; i < kPerThread; ++i) {
            hw.SetLed(i & 1);
            led.Set((i & 2) ? 1.f : 0.f); led.Update();
        }
    });
    main_loop.join(); audio_cb.join();

    // The last values set win.
    daisy::DaisySeed hw;
    hw.SetLed(true);
    daisy::RgbLed rgb;
    rgb.Init(dsy_gpio_pin{0, 5}, dsy_gpio_pin{0, 6}, dsy_gpio_pin{0, 7}, false);
    rgb.Set(1.f, 0.f, 0.125f); rgb.Update();
    stop = true;
    drain.join();
    sampler.collect([&](const char* m) { got.push_back(m); });

    std::string last_onboard, last_rgb;
    for (const auto& m : got) {
        if (m.find("\"gpioPin\":23") != std::string::npos) last_onboard = m;
        if (m.find("\"rgbLed\"") != std::string::npos && m.find("\"gpioPin\":5") != std::string::npos) last_rgb = m;
    }
    CHECK(last_onboard.find("\"lit\":true") != std::string::npos, "the last onboard LED value set is the last one received");
    CHECK(last_rgb.find("\"r\":1.0000,\"g\":0.0000,\"b\":0.1250") != std::string::npos,
          "the last RGB colour set is the last one received, with all three channels from the same write");
}

int main() {
    test_midi_two_producers();
    test_midi_full_queue_counts_drops();
    test_led_two_producers();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
