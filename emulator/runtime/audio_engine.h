#pragma once

namespace daisy_emu {
// Audio engine thread entry point.
// Waits for StartAudio() (via callback_cv), then runs the soft-paced block
// loop until g_state.shutdown is set.
void run_audio_engine();
}  // namespace daisy_emu
