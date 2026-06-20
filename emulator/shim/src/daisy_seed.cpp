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

void DaisySeed::StartAudio(AudioHandle::InterleavingAudioCallback cb) {
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.callback_mutex);
    daisy_emu::g_state.interleaving_cb = cb;
    daisy_emu::g_state.callback_set    = true;
    daisy_emu::g_state.callback_cv.notify_one();
}

void DaisySeed::StartAudio(AudioHandle::AudioCallback cb) {
    std::lock_guard<std::mutex> lk(daisy_emu::g_state.callback_mutex);
    daisy_emu::g_state.block_cb    = cb;
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
