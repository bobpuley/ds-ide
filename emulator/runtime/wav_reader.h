#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace daisy_emu {

// Decoded WAV audio. Samples are interleaved by channel and normalized to
// the [-1, 1] float range. `frames()` is the per-channel sample count.
struct WavData {
    std::vector<float> samples;
    uint32_t           sample_rate{0};
    uint16_t           channels{0};

    size_t frames() const { return channels ? samples.size() / channels : 0; }
    bool   empty()  const { return samples.empty(); }
};

// Parse a WAV image already in memory. Supports the common RIFF/WAVE subset
// used for audio regression material: 8/16/24/32-bit integer PCM and 32-bit
// IEEE float, mono or multi-channel. Returns false and sets `err` on failure.
bool parse_wav(const uint8_t* data, size_t size, WavData& out, std::string& err);

// Read a WAV file from disk and decode it via parse_wav(). Returns false and
// sets `err` if the file cannot be read or is not a supported WAV.
bool load_wav_file(const std::string& path, WavData& out, std::string& err);

// Render `block_size` interleaved-stereo frames from `wav` into `out` (length
// block_size*2), advancing the fractional playhead `pos` (measured in WAV
// frames). Linear interpolation resamples the file to `engine_sr`; mono is
// duplicated to both channels, stereo maps L/R (extra channels ignored). With
// loop=false, frames past the end are silence. An empty file or engine_sr<=0
// yields silence.
void wav_fill_stereo_block(const WavData& wav, double& pos, bool loop,
                           float engine_sr, size_t block_size, float* out);

}  // namespace daisy_emu
