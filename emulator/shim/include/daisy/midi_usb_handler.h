#pragma once
#include "daisy/midi_event.h"

// MidiUsbHandler host shim (MIDI USB, M47/FR-DEV-17). Confirmed against the
// one corpus example (daisy-seed-knowledge/examples/USB_MIDI/USB_MIDI.cpp):
// `MidiUsbHandler::Config` carries a `transport_config.periph` selecting
// `MidiUsbTransport::Config::INTERNAL` (the built-in micro USB connector,
// the corpus default) or `EXTERNAL` (USB HS pins, D29-D30 on Daisy Seed).
// The emulator doesn't simulate real USB transport, so `periph` has no
// behavioral effect on the shim itself (both modes drain the same shared
// EmulatorState::midi_in_queue as MidiUartHandler) — it exists so generated
// code's declared Config/Init() call matches real libDaisy's shape, and so
// codegen/midi-usb.ts's busOfDeclLine can read the selected mode back from
// source text.
namespace daisy {

struct MidiUsbTransport {
    struct Config {
        enum Periph { INTERNAL, EXTERNAL };
        Periph periph{INTERNAL};
    };
};

class MidiUsbHandler {
public:
    struct Config {
        MidiUsbTransport::Config transport_config;
    };

    void Init(const Config& config = Config()) { (void)config; }

    // No-op: parsing already happened at IPC-receipt time (see midi_event.h),
    // shared with MidiUartHandler's midi_in_queue.
    void Listen() {}

    bool HasEvents() const;
    MidiEvent PopEvent();
};

}  // namespace daisy
