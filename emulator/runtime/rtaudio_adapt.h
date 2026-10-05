#pragma once
#include "audio_device.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// Driver-independent parts of the RtAudio backend (FR-WIN-AUD-5), kept free of
// RtAudio.h so they are unit-tested on every host (tests/rtaudio-device).
namespace daisy_emu::rtaudio_adapt {

// Picks the RtAudio API by its short name ("wasapi", "asio", ...) from the
// APIs compiled into this binary. `requested` is DS_EMU_AUDIO_API (may be
// null); an unknown or not-compiled request falls back to WASAPI, then to the
// first compiled API. Returns "" when nothing is compiled in.
inline std::string choose_api_name(const char* requested, const std::vector<std::string>& compiled) {
    auto has = [&](const std::string& name) {
        return std::find(compiled.begin(), compiled.end(), name) != compiled.end();
    };
    if (requested && *requested) {
        std::string want(requested);
        for (char& c : want) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (has(want)) return want;
    }
    if (has("wasapi")) return "wasapi";
    return compiled.empty() ? std::string() : compiled.front();
}

// Copies `frames` stereo-interleaved frames into an interleaved hardware buffer
// of `outChannels` channels: mono gets the left channel (as the CoreAudio
// backend does), channels beyond the second get silence.
inline void write_output(const float* stereo, size_t frames, float* out, unsigned outChannels) {
    if (outChannels == 2) {
        std::copy(stereo, stereo + frames * 2, out);
        return;
    }
    for (size_t i = 0; i < frames; ++i) {
        float* frame = out + i * outChannels;
        frame[0] = stereo[2 * i];
        if (outChannels >= 2) frame[1] = stereo[2 * i + 1];
        for (unsigned ch = 2; ch < outChannels; ++ch) frame[ch] = 0.f;
    }
}

// Output latency in ms: the driver's reported stream latency plus one buffer.
// RtAudio's WASAPI API stores IAudioClient::GetStreamLatency()'s REFERENCE_TIME
// (100 ns units) as-is; every other API reports frames. 0 = unknown.
inline float stream_latency_ms(const std::string& api, long rawLatency,
                               unsigned bufferFrames, unsigned sampleRate) {
    if (sampleRate == 0) return 0.f;
    const double driver_ms = api == "wasapi"
        ? static_cast<double>(rawLatency) / 10000.0
        : static_cast<double>(rawLatency) * 1000.0 / sampleRate;
    const double buffer_ms = static_cast<double>(bufferFrames) * 1000.0 / sampleRate;
    return static_cast<float>(driver_ms + buffer_ms);
}

// Output-only render path, called from the RtAudio callback thread.
//
// processBlock is never handed more than the requested buffer size: a larger
// driver callback (ASIO may round the buffer up) is split into chunks, so the
// engine's work buffers sized from maxCallbackFrames() always fit. All buffers
// are allocated in prepare(); render() does not allocate (FR-WIN-AUD-2).
class OutputRenderer {
public:
    // Not real-time safe: allocates. Call before the stream starts.
    void prepare(AudioDevice::ProcessFn processBlock, uint32_t sampleRate,
                 uint32_t chunkFrames, unsigned outChannels) {
        processBlock_ = std::move(processBlock);
        sampleRate_   = sampleRate;
        chunkFrames_  = chunkFrames > 0 ? chunkFrames : 1;
        outChannels_  = outChannels > 0 ? outChannels : 1;
        silentInput_.assign(static_cast<size_t>(chunkFrames_) * 2, 0.f);
        workOut_.assign(static_cast<size_t>(chunkFrames_) * 2, 0.f);
        xruns_.store(0, std::memory_order_relaxed);
        driverOverruns_.store(0, std::memory_order_relaxed);
    }

    // Fills `out` (interleaved, outChannels wide) with nFrames frames.
    // `driverUnderflow` is the driver's output-underflow status for this cycle.
    void render(float* out, size_t nFrames, bool driverUnderflow) noexcept {
        if (driverUnderflow) driverOverruns_.fetch_add(1, std::memory_order_relaxed);

        const auto t_start = std::chrono::steady_clock::now();
        for (size_t done = 0; done < nFrames;) {
            const size_t n = std::min(nFrames - done, static_cast<size_t>(chunkFrames_));
            std::fill(workOut_.begin(), workOut_.begin() + static_cast<ptrdiff_t>(n * 2), 0.f);
            processBlock_(silentInput_.data(), workOut_.data(), n);
            write_output(workOut_.data(), n, out + done * outChannels_, outChannels_);
            done += n;
        }
        // Same xrun definition as the CoreAudio backend (FR-WIN-AUD-3): the
        // callback took longer than the audio it had to produce.
        const double elapsed_ms = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - t_start).count();
        const double budget_ms = static_cast<double>(nFrames) * 1000.0 / sampleRate_;
        if (elapsed_ms > budget_ms) xruns_.fetch_add(1, std::memory_order_relaxed);
    }

    uint32_t maxChunkFrames() const { return chunkFrames_; }
    unsigned outChannels() const { return outChannels_; }
    uint32_t drainXruns() { return xruns_.exchange(0, std::memory_order_relaxed); }
    uint32_t drainDriverOverruns() { return driverOverruns_.exchange(0, std::memory_order_relaxed); }

private:
    AudioDevice::ProcessFn processBlock_;
    uint32_t sampleRate_{48000};
    uint32_t chunkFrames_{256};
    unsigned outChannels_{2};
    std::vector<float> silentInput_;  // zeroed stereo input, chunkFrames * 2
    std::vector<float> workOut_;      // stereo output of one chunk, chunkFrames * 2
    std::atomic<uint32_t> xruns_{0};
    std::atomic<uint32_t> driverOverruns_{0};
};

}  // namespace daisy_emu::rtaudio_adapt
