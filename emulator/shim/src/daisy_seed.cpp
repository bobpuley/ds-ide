#include "daisy/daisy_seed_class.h"
#include "daisy/led.h"
#include "emulator_state.h"
#include <cstdarg>
#include <cstdio>

namespace daisy {

void DaisySeed::Configure() {}

void DaisySeed::Init() {}

void DaisySeed::SetAudioBlockSize(size_t block_size) {
    daisy_emu::g_state.block_size.store(block_size);
}

float DaisySeed::AudioSampleRate() {
    return daisy_emu::g_state.sample_rate.load();
}

float DaisySeed::AudioCallbackRate() {
    const auto bs = daisy_emu::g_state.block_size.load();
    return daisy_emu::g_state.sample_rate.load() / static_cast<float>(bs > 0 ? bs : 1);
}

dsy_gpio_pin DaisySeed::GetPin(uint8_t pin_num) {
    dsy_gpio_pin p{};
    p.pin = pin_num;
    return p;
}

// FR-QA-EMU-3: warn (once per repeat call) if the effect calls StartAudio()
// more than once — the second call silently overriding the first previously
// went unnoticed since callback_set was never reset to false.
static void warn_if_start_audio_repeated() {
    if (!daisy_emu::g_state.callback_set) return;
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.send_mutex);
    if (daisy_emu::g_state.send_ipc)
        daisy_emu::g_state.send_ipc(
            "{\"type\":\"event\",\"kind\":\"start_audio_repeated\"}");
}

void DaisySeed::StartAudio(AudioHandle::InterleavingAudioCallback cb) {
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.callback_mutex);
    warn_if_start_audio_repeated();
    // Null the other overload's pointer (FR-QA-EMU-3) so a prior StartAudio()
    // call of the other form can never remain latched alongside this one.
    daisy_emu::g_state.block_cb.store(nullptr, std::memory_order_relaxed);
    daisy_emu::g_state.interleaving_cb.store(cb, std::memory_order_relaxed);
    daisy_emu::g_state.callback_set = true;
    daisy_emu::g_state.callback_cv.notify_one();
}

void DaisySeed::StartAudio(AudioHandle::AudioCallback cb) {
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.callback_mutex);
    warn_if_start_audio_repeated();
    daisy_emu::g_state.interleaving_cb.store(nullptr, std::memory_order_relaxed);
    daisy_emu::g_state.block_cb.store(cb, std::memory_order_relaxed);
    daisy_emu::g_state.callback_set = true;
    daisy_emu::g_state.callback_cv.notify_one();
}

void DaisySeed::SetLed(bool state) {
    emit_led_change(daisy_emu::EmulatorState::kOnboardLedPin, state);
}

void DaisySeed::PrintLine(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    std::vprintf(fmt, args);
    va_end(args);
    std::putchar('\n');
}

}  // namespace daisy
