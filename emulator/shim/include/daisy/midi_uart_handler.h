#pragma once
#include "daisy/midi_event.h"

// MidiUartHandler host shim (MIDI TRS, M47/FR-DEV-16). Fixed to USART1
// (D13-D14) — the board's only canonical MIDI-TRS UART
// (02_assumptions-and-risks.md scopes "or an alternative UART" out of v14).
//
// The emulator doesn't simulate real UART byte-level timing, so incoming
// messages arrive pre-parsed onto EmulatorState::midi_in_queue at IPC-receipt
// time (see ipc_server.cpp's `midiEvent` handler) rather than being
// reconstructed here one byte at a time — Listen() is therefore a no-op
// (nothing left to do; matches real libDaisy's call-shape so effect code is
// unaffected) and HasEvents()/PopEvent() simply drain that queue.
namespace daisy {

class MidiUartHandler {
public:
    struct Config {
        void Defaults() {}
    };

    void Init(const Config& config = Config()) { (void)config; }

    // No-op: parsing already happened at IPC-receipt time (see midi_event.h).
    void Listen() {}

    bool HasEvents() const;
    MidiEvent PopEvent();
};

}  // namespace daisy
