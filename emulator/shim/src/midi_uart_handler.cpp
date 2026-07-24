#include "daisy/midi_uart_handler.h"
#include "emulator_state.h"
#include <cstdio>

namespace daisy {

bool MidiUartHandler::HasEvents() const {
    return !daisy_emu::g_state.midi_in_queue.empty();
}

MidiEvent MidiUartHandler::PopEvent() {
    MidiEvent ev{};
    daisy_emu::g_state.midi_in_queue.pop(ev);
    return ev;
}

// FR-MIDI-1: mirrors MidiUsbHandler::SendMessage — see that implementation
// for the parsing/JSON-shape rationale (shared byte-triplet convention).
void MidiUartHandler::SendMessage(uint8_t* buff, size_t size) {
    if (!buff || size == 0) return;
    uint8_t status = buff[0];
    uint8_t data1  = size > 1 ? buff[1] : 0;
    uint8_t data2  = size > 2 ? buff[2] : 0;

    MidiEvent ev{};
    parse_midi_event(status, data1, data2, ev);

    char msg[96];
    std::snprintf(msg, sizeof(msg),
        "{\"type\":\"midiTx\",\"status\":%u,\"data1\":%u,\"data2\":%u,\"channel\":%u,\"midiType\":%d}",
        status, data1, data2, ev.channel, static_cast<int>(ev.type));
    if (!daisy_emu::g_state.midi_queue.push(msg))
        daisy_emu::g_state.midi_queue_drops.fetch_add(1, std::memory_order_relaxed);
}

}  // namespace daisy
