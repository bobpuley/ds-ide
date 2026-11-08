// The only place that branches on the platform to pick an audio backend
// (FR-WIN-AUD-1): CoreAudio on macOS, RtAudio on Windows (FR-WIN-AUD-5), the
// no-backend NullAudioDevice elsewhere.
#include "audio_device.h"

#if defined(__APPLE__)
#include "core_audio_device.h"
#elif defined(_WIN32)
#include "audio_device_rtaudio.h"
#else
#include "null_audio_device.h"
#endif

namespace daisy_emu {

std::unique_ptr<AudioDevice> make_audio_device() {
#if defined(__APPLE__)
    return std::make_unique<CoreAudioDevice>();
#elif defined(_WIN32)
    return std::make_unique<RtAudioDevice>();
#else
    return std::make_unique<NullAudioDevice>();
#endif
}

}  // namespace daisy_emu
