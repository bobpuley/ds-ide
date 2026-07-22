#pragma once

// Host libDaisy shim — ds-ide emulator (C5).
// Drop-in replacement for the real libDaisy daisy_seed.h used by bare-libDaisy
// effects compiled for the emulator target.  Include exactly as the real header:
//
//   #include "daisy_seed.h"
//
// API surface is pinned to the canonical examples corpus (02 §3.1 / 03 §2.7).
// Unsupported peripherals (LED, Switch, GPIO, SD, MIDI, display) compile as
// no-op stubs so existing code still links (FR-SH-5).

#include "daisy/gpio.h"
#include "daisy/audio_handle.h"
#include "daisy/adc_handle.h"
#include "daisy/system.h"
#include "daisy/led.h"
#include "daisy/switch.h"
#include "daisy/daisy_seed_class.h"

// FR-DEV-7/8/9/10/14/16: these peripheral shims were never wired into this
// umbrella header when each landed — a generated effect (whose scaffold only
// ever emits `#include "daisy_seed.h"`, see create-effect-project.ts) placing
// a toggle/RGB LED/encoder/SD card/OLED/MIDI-TRS control failed to compile
// with "unknown type name", even though each shim's own isolated unit test
// (which includes its header directly) passed — the gap only surfaces at a
// real end-to-end build. Discovered and fixed while adding MidiUartHandler
// (M47, FR-DEV-16), whose own Init()-emitting DoD bullet would have been
// false under the same gap; folding in the five pre-existing misses here
// rather than leaving a known compile break in place for released devices.
#include "daisy/switch3.h"
#include "daisy/rgb_led.h"
#include "daisy/encoder.h"
#include "daisy/fatfs_host.h"
#include "daisy/oled_display.h"
#include "daisy/midi_uart_handler.h"
#include "daisy/midi_usb_handler.h"

// Expose the daisy::seed pin aliases at namespace scope so effects using
//   using namespace daisy;
// can write A0, A1, … directly (matches libDaisy usage in Osc.cpp / inout.cpp).
namespace daisy {
    using namespace seed;
}
