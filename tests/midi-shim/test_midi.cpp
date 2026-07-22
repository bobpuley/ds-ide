// Unit test for the shared MIDI event parser (M47, FR-DEV-16/17) and the
// MidiUartHandler shim (FR-DEV-16).
//
// Exercises byte-triplet -> MidiEvent parsing, MidiInQueue's bounded FIFO
// ordering and overflow-drops-newest behaviour, and a concurrent
// producer(IPC thread)/consumer(effect thread) stress test against the real
// EmulatorState::midi_in_queue/midi_queue instances (same shape as
// test_oled.cpp's stress test). No IPC socket or audio thread. Plain
// asserts; exit 0 on success. Provides its own g_state definition (normally
// in main.cpp).

#include "daisy/midi_event.h"
#include "daisy/midi_uart_handler.h"
#include "daisy/midi_usb_handler.h"
#include "emulator_state.h"

#include <atomic>
#include <cstdio>
#include <thread>

namespace daisy_emu {
EmulatorState g_state;  // single global, as defined in runtime/main.cpp
}

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

static void test_parses_note_on() {
    daisy::MidiEvent ev{};
    bool ok = daisy::parse_midi_event(0x90, 60, 100, ev);
    CHECK(ok, "0x90 status byte parses successfully");
    CHECK(ev.type == daisy::MidiMessageType::NoteOn, "0x90 parses as NoteOn");
    CHECK(ev.channel == 0, "channel 0 decoded from low nibble");
    auto note_on = ev.AsNoteOn();
    CHECK(note_on.note == 60, "AsNoteOn() carries the note number");
    CHECK(note_on.velocity == 100, "AsNoteOn() carries the velocity");
}

// The one corpus example (USB_MIDI.cpp) checks `note_msg.velocity != 0` on a
// NoteOn-typed event itself — confirming real libDaisy does NOT reclassify a
// zero-velocity NoteOn as NoteOff. This parser must match that behavior.
static void test_note_on_with_zero_velocity_stays_note_on() {
    daisy::MidiEvent ev{};
    daisy::parse_midi_event(0x91, 64, 0, ev);
    CHECK(ev.type == daisy::MidiMessageType::NoteOn,
          "a zero-velocity NoteOn is NOT reclassified as NoteOff");
    CHECK(ev.channel == 1, "channel 1 decoded from low nibble 0x1");
}

static void test_parses_note_off() {
    daisy::MidiEvent ev{};
    daisy::parse_midi_event(0x82, 60, 64, ev);
    CHECK(ev.type == daisy::MidiMessageType::NoteOff, "0x82 parses as NoteOff");
    auto note_off = ev.AsNoteOff();
    CHECK(note_off.channel == 2, "channel 2 decoded from low nibble 0x2");
    CHECK(note_off.note == 60, "AsNoteOff() carries the note number");
}

static void test_parses_control_change() {
    daisy::MidiEvent ev{};
    daisy::parse_midi_event(0xB3, 7, 127, ev);
    CHECK(ev.type == daisy::MidiMessageType::ControlChange, "0xB3 parses as ControlChange");
    auto cc = ev.AsControlChange();
    CHECK(cc.channel == 3, "channel 3 decoded from low nibble 0x3");
    CHECK(cc.control_number == 7, "AsControlChange() carries the controller number");
    CHECK(cc.value == 127, "AsControlChange() carries the value");
}

static void test_unrecognized_status_is_unknown_not_misparsed() {
    daisy::MidiEvent ev{};
    bool ok = daisy::parse_midi_event(0xF8, 0, 0, ev);  // MIDI clock (system real-time)
    CHECK(!ok, "an unrecognized status byte returns false");
    CHECK(ev.type == daisy::MidiMessageType::Unknown, "an unrecognized status byte is tagged Unknown, not guessed");
}

static void test_midi_in_queue_preserves_fifo_order() {
    daisy_emu::MidiInQueue q;
    daisy::MidiEvent a{}; a.channel = 1;
    daisy::MidiEvent b{}; b.channel = 2;
    daisy::MidiEvent c{}; c.channel = 3;
    CHECK(q.push(a) && q.push(b) && q.push(c), "three pushes succeed under capacity");

    daisy::MidiEvent out{};
    q.pop(out); CHECK(out.channel == 1, "pop() returns events in FIFO order (1st)");
    q.pop(out); CHECK(out.channel == 2, "pop() returns events in FIFO order (2nd)");
    q.pop(out); CHECK(out.channel == 3, "pop() returns events in FIFO order (3rd)");
    CHECK(q.empty(), "queue is empty after draining every pushed event");
}

// A full queue must drop the *new* event, preserving the ordering of
// everything already queued — never silently overwriting or reordering.
static void test_midi_in_queue_drops_newest_when_full() {
    daisy_emu::MidiInQueue q;
    for (size_t i = 0; i < daisy_emu::MidiInQueue::CAPACITY; ++i) {
        daisy::MidiEvent ev{};
        ev.channel = static_cast<uint8_t>(i % 16);
        CHECK(q.push(ev), "push succeeds up to capacity");
    }
    daisy::MidiEvent overflow{};
    overflow.channel = 9;
    CHECK(!q.push(overflow), "push() reports failure once the queue is full");

    daisy::MidiEvent out{};
    q.pop(out);
    CHECK(out.channel == 0, "the oldest event (not the dropped new one) is still first out");
}

static void test_uart_handler_has_events_and_pop_event_drain_shared_queue() {
    // Reset: drain anything left by an earlier test in this binary.
    daisy::MidiEvent tmp{};
    while (daisy_emu::g_state.midi_in_queue.pop(tmp)) {}

    daisy::MidiUartHandler handler;
    handler.Init();
    CHECK(!handler.HasEvents(), "HasEvents() is false with an empty queue");

    daisy::MidiEvent ev{};
    daisy::parse_midi_event(0x90, 69, 127, ev);
    daisy_emu::g_state.midi_in_queue.push(ev);

    CHECK(handler.HasEvents(), "HasEvents() is true once an event is queued");
    handler.Listen();  // no-op — parsing already happened at IPC-receipt time
    daisy::MidiEvent popped = handler.PopEvent();
    CHECK(popped.AsNoteOn().note == 69, "PopEvent() returns the queued event");
    CHECK(!handler.HasEvents(), "HasEvents() is false again after PopEvent() drains it");
}

// MidiUsbHandler shares the exact same midi_in_queue as MidiUartHandler
// (FR-DEV-17) — only one MIDI peripheral is realistically enabled at a time
// in a given effect, and the virtual keyboard/host bridge is one logical
// input regardless of which transport is declared.
static void test_usb_handler_shares_the_same_midi_in_queue() {
    daisy::MidiEvent tmp{};
    while (daisy_emu::g_state.midi_in_queue.pop(tmp)) {}

    daisy::MidiUsbHandler::Config cfg;
    cfg.transport_config.periph = daisy::MidiUsbTransport::Config::EXTERNAL;
    daisy::MidiUsbHandler handler;
    handler.Init(cfg);
    CHECK(!handler.HasEvents(), "MidiUsbHandler::HasEvents() is false with an empty queue");

    daisy::MidiEvent ev{};
    daisy::parse_midi_event(0xB0, 7, 64, ev);
    daisy_emu::g_state.midi_in_queue.push(ev);

    CHECK(handler.HasEvents(), "MidiUsbHandler::HasEvents() is true once an event is queued");
    handler.Listen();
    daisy::MidiEvent popped = handler.PopEvent();
    CHECK(popped.AsControlChange().control_number == 7, "MidiUsbHandler::PopEvent() returns the queued event");
    CHECK(!handler.HasEvents(), "queue is shared: draining via MidiUsbHandler leaves it empty for MidiUartHandler too");
}

// The RT-safety measurement mirroring test_oled.cpp's stress test: a
// producer thread (simulating the IPC-dispatch thread parsing inbound
// `midiEvent` messages) racing a consumer thread (simulating the effect's
// own thread calling PopEvent()) against the SAME EmulatorState::midi_in_queue
// instance the real runtime uses. Every pushed event is either consumed or
// counted as a drop — never silently lost or corrupted.
static void test_sustained_concurrent_producer_consumer_no_corruption() {
    daisy::MidiEvent tmp{};
    while (daisy_emu::g_state.midi_in_queue.pop(tmp)) {}  // reset from prior test

    static constexpr int kEventCount = 10000;
    std::atomic<int> consumed{0};
    std::atomic<int> dropped{0};
    std::atomic<bool> producer_done{false};

    std::thread consumer([&]() {
        daisy::MidiEvent ev{};
        while (!producer_done.load() || !daisy_emu::g_state.midi_in_queue.empty()) {
            if (daisy_emu::g_state.midi_in_queue.pop(ev)) consumed.fetch_add(1);
        }
    });

    for (int i = 0; i < kEventCount; ++i) {
        daisy::MidiEvent ev{};
        daisy::parse_midi_event(0x90, static_cast<uint8_t>(i % 128), 100, ev);
        if (!daisy_emu::g_state.midi_in_queue.push(ev)) dropped.fetch_add(1);
    }
    producer_done.store(true);
    consumer.join();

    CHECK(consumed.load() + dropped.load() == kEventCount,
          "every pushed event is either consumed or counted as a drop — none silently lost");
}

int main() {
    std::printf("=== MIDI shim unit tests (M47, FR-DEV-16) ===\n");
    test_parses_note_on();
    test_note_on_with_zero_velocity_stays_note_on();
    test_parses_note_off();
    test_parses_control_change();
    test_unrecognized_status_is_unknown_not_misparsed();
    test_midi_in_queue_preserves_fifo_order();
    test_midi_in_queue_drops_newest_when_full();
    test_uart_handler_has_events_and_pop_event_drain_shared_queue();
    test_usb_handler_shares_the_same_midi_in_queue();
    test_sustained_concurrent_producer_consumer_no_corruption();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
