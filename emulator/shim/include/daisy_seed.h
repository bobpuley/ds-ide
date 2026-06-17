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

// Expose the daisy::seed pin aliases at namespace scope so effects using
//   using namespace daisy;
// can write A0, A1, … directly (matches libDaisy usage in Osc.cpp / inout.cpp).
namespace daisy {
    using namespace seed;
}
