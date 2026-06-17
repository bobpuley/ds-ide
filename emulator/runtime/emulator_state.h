#pragma once
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <mutex>
#include <string>
#include "daisy/audio_handle.h"

namespace daisy_emu {

struct EmulatorState {
    // Audio configuration — set via IPC config message or shim calls
    std::atomic<float>  sample_rate{48000.f};
    std::atomic<size_t> block_size{48};

    // Transport
    std::atomic<bool> transport_running{false};
    std::atomic<bool> shutdown{false};

    // Sine generator
    std::atomic<float> sine_freq{440.f};
    std::atomic<float> sine_amp{0.353553f};  // ~-9 dBFS

    // ADC pot values (0..1), one per channel (Daisy Seed has 12 ADC channels)
    std::atomic<float> pot_values[12];

    // Interleaved audio callback — set by shim StartAudio(), read by audio engine
    daisy::AudioHandle::InterleavingAudioCallback interleaving_cb{nullptr};
    std::mutex              callback_mutex;
    std::condition_variable callback_cv;
    bool                    callback_set{false};

    // IPC output — set by ipc_server when a client is connected; nullptr otherwise.
    // Audio engine calls this to emit scope/status/event JSON lines.
    std::mutex                        send_mutex;
    std::function<void(std::string)>  send_ipc;

    EmulatorState() {
        for (auto& v : pot_values) v.store(0.f);
    }
};

// Single global instance — defined in runtime/main.cpp.
extern EmulatorState g_state;

}  // namespace daisy_emu
