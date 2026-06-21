#include "wav_reader.h"
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstring>

namespace daisy_emu {

// ---- Little-endian readers --------------------------------------------------

static uint16_t rd_u16(const uint8_t* p) {
    // Cast to uint32_t before shifting to avoid integer-promotion UB (AC-52).
    return static_cast<uint16_t>(static_cast<uint32_t>(p[0])
                                | (static_cast<uint32_t>(p[1]) << 8));
}

static uint32_t rd_u32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8)
         | (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

// ---- Sample decoders (one interleaved sample at byte offset) ----------------

static float decode_pcm8(const uint8_t* p) {
    // 8-bit WAV PCM is unsigned, 128 = zero.
    return (static_cast<int>(p[0]) - 128) / 128.f;
}

static float decode_pcm16(const uint8_t* p) {
    int16_t v = static_cast<int16_t>(rd_u16(p));
    return v / 32768.f;
}

static float decode_pcm24(const uint8_t* p) {
    // Cast to uint32_t before shifting to avoid integer-promotion UB (AC-52).
    uint32_t u = static_cast<uint32_t>(p[0])
               | (static_cast<uint32_t>(p[1]) << 8)
               | (static_cast<uint32_t>(p[2]) << 16);
    int32_t v = static_cast<int32_t>(u);
    if (v & 0x800000) v |= ~0xFFFFFF;  // sign-extend 24→32
    return static_cast<float>(v) / 8388608.f;
}

static float decode_pcm32(const uint8_t* p) {
    int32_t v = static_cast<int32_t>(rd_u32(p));
    return static_cast<float>(v) / 2147483648.0;
}

static float decode_float32(const uint8_t* p) {
    float f;
    std::memcpy(&f, p, sizeof(float));
    return f;
}

// WAVE format tags
constexpr uint16_t WAVE_FORMAT_PCM        = 0x0001;
constexpr uint16_t WAVE_FORMAT_IEEE_FLOAT = 0x0003;
constexpr uint16_t WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

// ---- Parser -----------------------------------------------------------------

bool parse_wav(const uint8_t* data, size_t size, WavData& out, std::string& err) {
    out = WavData{};

    if (!data || size < 44) { err = "file too small to be a WAV"; return false; }
    if (std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0) {
        err = "not a RIFF/WAVE file";
        return false;
    }

    // Walk the chunk list after the 12-byte RIFF header.
    uint16_t fmt_tag = 0, channels = 0, bits = 0;
    uint32_t sample_rate = 0;
    bool     have_fmt = false;
    const uint8_t* data_chunk = nullptr;
    uint32_t       data_size  = 0;

    size_t pos = 12;
    while (pos + 8 <= size) {
        const uint8_t* chunk_id = data + pos;
        uint32_t chunk_size = rd_u32(data + pos + 4);
        size_t   body = pos + 8;
        if (body + chunk_size > size) chunk_size = static_cast<uint32_t>(size - body);

        if (std::memcmp(chunk_id, "fmt ", 4) == 0 && chunk_size >= 16) {
            fmt_tag     = rd_u16(data + body + 0);
            channels    = rd_u16(data + body + 2);
            sample_rate = rd_u32(data + body + 4);
            bits        = rd_u16(data + body + 14);
            // WAVE_FORMAT_EXTENSIBLE stores the real tag in the subformat GUID.
            if (fmt_tag == WAVE_FORMAT_EXTENSIBLE && chunk_size >= 26) {
                fmt_tag = rd_u16(data + body + 24);
            }
            have_fmt = true;
        } else if (std::memcmp(chunk_id, "data", 4) == 0) {
            data_chunk = data + body;
            data_size  = chunk_size;
        }

        // Chunks are word-aligned: an odd size is followed by a pad byte.
        pos = body + chunk_size + (chunk_size & 1);
    }

    if (!have_fmt)            { err = "missing fmt chunk"; return false; }
    if (!data_chunk)          { err = "missing data chunk"; return false; }
    if (channels == 0)        { err = "zero channels"; return false; }
    if (sample_rate == 0)     { err = "zero sample rate"; return false; }

    // Select a decoder for the declared format + bit depth.
    // Guard division by zero before computing total_samples (AC-42).
    if (bits == 0) { err = "zero bits per sample"; return false; }
    uint32_t bytes_per_sample = bits / 8;
    if (bytes_per_sample == 0) { err = "computed bytes_per_sample is zero"; return false; }
    float (*decode)(const uint8_t*) = nullptr;
    if (fmt_tag == WAVE_FORMAT_PCM) {
        switch (bits) {
            case 8:  decode = decode_pcm8;  break;
            case 16: decode = decode_pcm16; break;
            case 24: decode = decode_pcm24; break;
            case 32: decode = decode_pcm32; break;
        }
    } else if (fmt_tag == WAVE_FORMAT_IEEE_FLOAT && bits == 32) {
        decode = decode_float32;
    }
    if (!decode) {
        char buf[96];
        std::snprintf(buf, sizeof(buf),
                      "unsupported WAV format (tag=%u, bits=%u)", fmt_tag, bits);
        err = buf;
        return false;
    }

    uint32_t total_samples = data_size / bytes_per_sample;
    out.channels    = channels;
    out.sample_rate = sample_rate;
    out.samples.resize(total_samples);
    for (uint32_t i = 0; i < total_samples; ++i) {
        out.samples[i] = decode(data_chunk + static_cast<size_t>(i) * bytes_per_sample);
    }
    return true;
}

void wav_fill_stereo_block(const WavData& wav, double& pos, bool loop,
                           float engine_sr, size_t block_size, float* out) {
    const size_t nframes = wav.frames();
    if (nframes == 0 || engine_sr <= 0.f) {
        for (size_t i = 0; i < block_size * 2; ++i) out[i] = 0.f;
        return;
    }
    const double   ratio = static_cast<double>(wav.sample_rate) / static_cast<double>(engine_sr);
    const uint16_t ch    = wav.channels;
    const double   nf    = static_cast<double>(nframes);

    for (size_t i = 0; i < block_size; ++i) {
        if (!loop && pos >= nf) {
            out[2 * i]     = 0.f;
            out[2 * i + 1] = 0.f;
            continue;
        }
        double p = loop ? std::fmod(pos, nf) : pos;
        if (p < 0.0) p = 0.0;
        size_t i0   = static_cast<size_t>(p);
        size_t i1   = i0 + 1;
        float  frac = static_cast<float>(p - static_cast<double>(i0));
        if (i1 >= nframes) i1 = loop ? 0 : i0;

        float l0   = wav.samples[i0 * ch];
        float l1   = wav.samples[i1 * ch];
        float left = l0 + (l1 - l0) * frac;
        float right;
        if (ch >= 2) {
            float r0 = wav.samples[i0 * ch + 1];
            float r1 = wav.samples[i1 * ch + 1];
            right = r0 + (r1 - r0) * frac;
        } else {
            right = left;
        }
        out[2 * i]     = left;
        out[2 * i + 1] = right;
        pos += ratio;
    }
}

bool load_wav_file(const std::string& path, WavData& out, std::string& err) {
    std::FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) { err = "cannot open file: " + path; return false; }

    std::fseek(f, 0, SEEK_END);
    long len = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    if (len <= 0) { std::fclose(f); err = "empty file: " + path; return false; }

    std::vector<uint8_t> buf(static_cast<size_t>(len));
    size_t read = std::fread(buf.data(), 1, buf.size(), f);
    std::fclose(f);
    if (read != buf.size()) { err = "short read: " + path; return false; }

    return parse_wav(buf.data(), buf.size(), out, err);
}

}  // namespace daisy_emu
