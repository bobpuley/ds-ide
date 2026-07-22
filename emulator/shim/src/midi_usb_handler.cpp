#include "daisy/midi_usb_handler.h"
#include "emulator_state.h"

namespace daisy {

bool MidiUsbHandler::HasEvents() const {
    return !daisy_emu::g_state.midi_in_queue.empty();
}

MidiEvent MidiUsbHandler::PopEvent() {
    MidiEvent ev{};
    daisy_emu::g_state.midi_in_queue.pop(ev);
    return ev;
}

}  // namespace daisy
