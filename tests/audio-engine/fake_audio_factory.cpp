// Fake make_audio_device() for the engine tests: replaces
// emulator/runtime/audio_device_factory.cpp at link time (M79 / FR-WIN-AUD-4).
#include "fake_audio_device.h"

namespace daisy_emu {
std::unique_ptr<AudioDevice> make_audio_device() {
    return std::make_unique<fake_audio::FakeAudioDevice>();
}
}  // namespace daisy_emu
