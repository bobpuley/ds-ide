#pragma once
#include <cstdarg>
#include <cstddef>
#include <cstdint>
#include "gpio.h"
#include "audio_handle.h"
#include "adc_handle.h"
#include "system.h"

namespace daisy {

// Host implementation of the Daisy Seed board object.
// Mirrors the libDaisy DaisySeed surface used by the v1 example corpus
// (bypass, Knob, Osc, inout).  FR-SH-1..4.  Implementations in C5 (M1).
class DaisySeed {
public:
    // Public ADC handle — accessed as hw.adc.Init(...) / hw.adc.GetFloat(n).
    AdcHandle adc;

    // Configure internal peripherals.  Must be called before Init() when the
    // effect calls both (some examples call only Init()).
    void Configure();

    // Initialise the board at 48 kHz / block-size 48 (libDaisy defaults).
    void Init();

    // Override the audio block size.  Must be called before StartAudio().
    void SetAudioBlockSize(size_t block_size);

    // Return the configured sample rate in Hz.
    float AudioSampleRate();

    // Return the audio callback rate in Hz (sample rate / block size).
    float AudioCallbackRate();

    // Return a pin descriptor for a Daisy Seed pin number.
    // Pin numbers 0-31 map to the physical header; the emulator ignores
    // port/pin values for GPIO peripherals (stub, FR-SH-5) but passes them
    // through to AdcChannelConfig for channel-tracking purposes.
    dsy_gpio_pin GetPin(uint8_t pin_num);

    // Start the audio engine with an interleaved callback (v1.0).
    void StartAudio(AudioHandle::InterleavingAudioCallback cb);

    // Start the audio engine with a block/non-interleaved callback (v1.1).
    void StartAudio(AudioHandle::AudioCallback cb);

    // Drive the onboard user LED (M10). Maps to the declared onboard LED
    // (gpio_pin 23) and emits an IPC `led` message on change.
    void SetLed(bool state);

    // Map to the host logger.  Accepts printf-style format string.
    // format(printf, 2, 3): parameter 1 is the implicit `this`, so the format
    // string is parameter 2 and varargs start at 3 (FR-QA-EMU-7) — lets the
    // compiler catch a mismatched format/argument pair at the call site.
    void PrintLine(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
};

} // namespace daisy
