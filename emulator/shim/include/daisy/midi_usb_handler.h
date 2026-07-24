#pragma once
#include <cstddef>
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

    // FR-MIDI-1: outbound path — an effect calling this enqueues a `midiTx`
    // message onto the same EmulatorState::midi_queue the inbound `midiRx`
    // telemetry already uses (see midi_usb_handler.cpp), so the monitor sees
    // both directions on one channel. `buff` is read as a status byte plus up
    // to two data bytes (status[, data1[, data2]]) — the same triplet shape
    // ipc_server.cpp's `midiEvent` handler parses inbound, tolerating a
    // shorter 2-byte message (e.g. Program Change) by treating a missing
    // data2 as 0 rather than reading past `size`.
    void SendMessage(uint8_t* buff, size_t size);
};

}  // namespace daisy
