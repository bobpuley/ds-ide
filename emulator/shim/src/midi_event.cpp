#include "daisy/midi_event.h"

namespace daisy {

// Standard MIDI status byte layout: high nibble selects the message type,
// low nibble is the channel (0-15). Only channel voice messages relevant to
// synthesis effects are recognized (NoteOff/NoteOn/ControlChange) — real
// libDaisy's MidiMessageType enumerates more (PitchBend, ProgramChange,
// SystemCommon, ...); those arrive as MidiMessageType::Unknown here rather
// than being silently misparsed, per the "reject/flag rather than guess"
// convention every other IPC input validator in this tree follows
// (ipc_server.cpp's clamp_pot_value, decode_control_id).
bool parse_midi_event(uint8_t status, uint8_t data1, uint8_t data2, MidiEvent& out) {
    uint8_t high_nibble = static_cast<uint8_t>(status & 0xF0);
    uint8_t channel     = static_cast<uint8_t>(status & 0x0F);

    MidiMessageType type;
    switch (high_nibble) {
        case 0x80: type = MidiMessageType::NoteOff;      break;
        case 0x90: type = MidiMessageType::NoteOn;       break;
        case 0xB0: type = MidiMessageType::ControlChange; break;
        default:
            out = MidiEvent{MidiMessageType::Unknown, channel, {data1, data2}};
            return false;
    }

    out = MidiEvent{type, channel, {data1, data2}};
    return true;
}

}  // namespace daisy
