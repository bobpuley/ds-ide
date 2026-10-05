// The only place that branches on the platform to pick an audio backend
// (FR-WIN-AUD-1). Windows gets its RtAudio backend here in M80.
#include "audio_device.h"

#ifdef __APPLE__
#include "core_audio_device.h"
#else
#include "null_audio_device.h"
#endif

namespace daisy_emu {

std::unique_ptr<AudioDevice> make_audio_device() {
#ifdef __APPLE__
    return std::make_unique<CoreAudioDevice>();
#else
    return std::make_unique<NullAudioDevice>();
#endif
}

}  // namespace daisy_emu
