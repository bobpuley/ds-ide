#include "daisy/midi_uart_handler.h"
#include "emulator_state.h"

namespace daisy {

bool MidiUartHandler::HasEvents() const {
    return !daisy_emu::g_state.midi_in_queue.empty();
}

MidiEvent MidiUartHandler::PopEvent() {
    MidiEvent ev{};
    daisy_emu::g_state.midi_in_queue.pop(ev);
    return ev;
}

}  // namespace daisy
