#pragma once
#include <cstdint>

// Shared MIDI event model (M47, FR-DEV-16/17) — the parsing logic every MIDI
// transport shim (MidiUartHandler, MidiUsbHandler) reuses, mirroring real
// libDaisy's MidiHandler<Transport> template where only the byte source
// varies, never the parsing (graphify's corpus graph links MidiHandler and
// UartHandler as sharing data, consistent with this). The emulator doesn't
// simulate real UART/USB byte-level transport timing, so a message arrives
// pre-assembled as a 3-byte status/data1/data2 triplet (extension -> emulator
// `midiEvent` IPC message) rather than being reconstructed from a raw byte
// stream one octet at a time.
namespace daisy {

enum class MidiMessageType : uint8_t {
    NoteOff,
    NoteOn,
    ControlChange,
    Unknown,
};

struct NoteOnEvent {
    uint8_t channel;
    uint8_t note;
    uint8_t velocity;
};

struct NoteOffEvent {
    uint8_t channel;
    uint8_t note;
    uint8_t velocity;
};

struct ControlChangeEvent {
    uint8_t channel;
    uint8_t control_number;
    uint8_t value;
};

// Real libDaisy's MidiEvent carries channel + a 2-byte data payload alongside
// its type tag; AsNoteOn()/AsNoteOff()/AsControlChange() reinterpret that
// payload for the matching type — matching daisy-seed-knowledge's
// examples/USB_MIDI/USB_MIDI.cpp usage (`msg.AsNoteOn().velocity`).
struct MidiEvent {
    MidiMessageType type{MidiMessageType::Unknown};
    uint8_t         channel{0};
    uint8_t         data[2]{0, 0};

    NoteOnEvent AsNoteOn() const { return {channel, data[0], data[1]}; }
    NoteOffEvent AsNoteOff() const { return {channel, data[0], data[1]}; }
    ControlChangeEvent AsControlChange() const { return {channel, data[0], data[1]}; }
};

// Decodes a 3-byte MIDI message (status, data1, data2) into `out`. Returns
// false for a status byte this shim doesn't recognize (`out` is left as
// MidiMessageType::Unknown in that case, still safe to read).
//
// Deliberately does NOT reclassify a NoteOn with velocity 0 as NoteOff (a
// common MIDI convention) — the one corpus example
// (daisy-seed-knowledge/examples/USB_MIDI/USB_MIDI.cpp) checks
// `note_msg.velocity != 0` on a NoteOn-typed event itself, confirming real
// libDaisy's MidiUsbHandler reports it as NoteOn and leaves the
// reinterpretation to the caller.
bool parse_midi_event(uint8_t status, uint8_t data1, uint8_t data2, MidiEvent& out);

}  // namespace daisy
