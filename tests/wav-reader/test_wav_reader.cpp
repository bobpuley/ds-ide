// Unit test for the C4 WAV reader (T9.1).
//
// Builds small WAV images in memory and verifies parse_wav() decodes header
// fields and samples correctly across bit depths / channel counts, and rejects
// malformed input. No framework dependency — plain asserts, exit 0 on success.

#include "wav_reader.h"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace daisy_emu;

// ---- WAV image builder ------------------------------------------------------

static void push_u16(std::vector<uint8_t>& b, uint16_t v) {
    b.push_back(v & 0xFF);
    b.push_back((v >> 8) & 0xFF);
}
static void push_u32(std::vector<uint8_t>& b, uint32_t v) {
    b.push_back(v & 0xFF);
    b.push_back((v >> 8) & 0xFF);
    b.push_back((v >> 16) & 0xFF);
    b.push_back((v >> 24) & 0xFF);
}
static void push_tag(std::vector<uint8_t>& b, const char* t) {
    b.insert(b.end(), t, t + 4);
}

// Assemble a canonical 44-byte-header WAV from a raw data-chunk payload.
static std::vector<uint8_t> make_wav(uint16_t fmt_tag, uint16_t channels,
                                     uint32_t sample_rate, uint16_t bits,
                                     const std::vector<uint8_t>& data) {
    std::vector<uint8_t> b;
    uint16_t block_align = static_cast<uint16_t>(channels * (bits / 8));
    uint32_t byte_rate   = sample_rate * block_align;

    push_tag(b, "RIFF");
    push_u32(b, static_cast<uint32_t>(36 + data.size()));
    push_tag(b, "WAVE");
    push_tag(b, "fmt ");
    push_u32(b, 16);
    push_u16(b, fmt_tag);
    push_u16(b, channels);
    push_u32(b, sample_rate);
    push_u32(b, byte_rate);
    push_u16(b, block_align);
    push_u16(b, bits);
    push_tag(b, "data");
    push_u32(b, static_cast<uint32_t>(data.size()));
    b.insert(b.end(), data.begin(), data.end());
    return b;
}

static bool close_to(float a, float b, float eps = 1e-4f) {
    return std::fabs(a - b) <= eps;
}

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

// ---- Tests ------------------------------------------------------------------

static void test_pcm16_stereo() {
    std::vector<uint8_t> data;
    // Two stereo frames: L/R = (+full, -full), then (0, +half)
    push_u16(data, 0x7FFF);          // L ~ +1.0
    push_u16(data, 0x8000);          // R = -1.0
    push_u16(data, 0x0000);          // L = 0
    push_u16(data, 0x4000);          // R = +0.5
    auto wav = make_wav(0x0001, 2, 44100, 16, data);

    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(ok, "pcm16 stereo parses");
    CHECK(out.channels == 2, "pcm16 stereo channels==2");
    CHECK(out.sample_rate == 44100, "pcm16 stereo sample_rate==44100");
    CHECK(out.frames() == 2, "pcm16 stereo frames==2");
    CHECK(close_to(out.samples[0], 1.0f, 1e-3f), "pcm16 sample[0] ~ +1.0");
    CHECK(close_to(out.samples[1], -1.0f), "pcm16 sample[1] == -1.0");
    CHECK(close_to(out.samples[2], 0.0f), "pcm16 sample[2] == 0");
    CHECK(close_to(out.samples[3], 0.5f), "pcm16 sample[3] == +0.5");
}

static void test_pcm24_mono() {
    std::vector<uint8_t> data;
    // 24-bit value 0x400000 = +0.5, and 0xC00000 (sign-extended) = -0.5
    data.push_back(0x00); data.push_back(0x00); data.push_back(0x40);
    data.push_back(0x00); data.push_back(0x00); data.push_back(0xC0);
    auto wav = make_wav(0x0001, 1, 48000, 24, data);

    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(ok, "pcm24 mono parses");
    CHECK(out.channels == 1, "pcm24 mono channels==1");
    CHECK(out.frames() == 2, "pcm24 mono frames==2");
    CHECK(close_to(out.samples[0], 0.5f), "pcm24 sample[0] == +0.5");
    CHECK(close_to(out.samples[1], -0.5f), "pcm24 sample[1] == -0.5");
}

static void test_float32_mono() {
    std::vector<uint8_t> data;
    float vals[3] = { 0.25f, -0.75f, 1.0f };
    for (float v : vals) {
        uint8_t buf[4];
        std::memcpy(buf, &v, 4);
        data.insert(data.end(), buf, buf + 4);
    }
    auto wav = make_wav(0x0003, 1, 48000, 32, data);  // IEEE float

    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(ok, "float32 mono parses");
    CHECK(out.frames() == 3, "float32 mono frames==3");
    CHECK(close_to(out.samples[0], 0.25f), "float32 sample[0] == 0.25");
    CHECK(close_to(out.samples[1], -0.75f), "float32 sample[1] == -0.75");
    CHECK(close_to(out.samples[2], 1.0f), "float32 sample[2] == 1.0");
}

static void test_rejects_non_riff() {
    std::vector<uint8_t> junk(64, 0xAB);
    WavData out; std::string err;
    bool ok = parse_wav(junk.data(), junk.size(), out, err);
    CHECK(!ok, "rejects non-RIFF data");
    CHECK(!err.empty(), "non-RIFF sets error message");
}

static void test_rejects_unsupported_bits() {
    std::vector<uint8_t> data(8, 0);
    auto wav = make_wav(0x0001, 1, 48000, 12, data);  // 12-bit: unsupported
    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(!ok, "rejects unsupported bit depth");
}

// ---- wav_fill_stereo_block (T9.2) -------------------------------------------

// Build a WavData directly (bypassing the file parser) for playback tests.
static WavData make_wavdata(uint16_t channels, uint32_t sample_rate,
                            std::vector<float> samples) {
    WavData w;
    w.channels    = channels;
    w.sample_rate = sample_rate;
    w.samples     = std::move(samples);
    return w;
}

static void test_fill_mono_to_stereo_same_rate() {
    // Mono ramp 0.1, 0.2, 0.3, 0.4 at engine rate — should pass through and
    // duplicate to both channels with no resampling.
    WavData w = make_wavdata(1, 48000, { 0.1f, 0.2f, 0.3f, 0.4f });
    double pos = 0.0;
    float out[8] = {0};
    wav_fill_stereo_block(w, pos, /*loop=*/false, 48000.f, 4, out);
    CHECK(close_to(out[0], 0.1f) && close_to(out[1], 0.1f), "fill mono frame0 L==R==0.1");
    CHECK(close_to(out[6], 0.4f) && close_to(out[7], 0.4f), "fill mono frame3 L==R==0.4");
    CHECK(close_to(static_cast<float>(pos), 4.0f), "fill advances playhead to 4");
}

static void test_fill_oneshot_silence_past_end() {
    WavData w = make_wavdata(1, 48000, { 0.5f, 0.5f });  // 2 frames
    double pos = 0.0;
    float out[8] = {0};
    wav_fill_stereo_block(w, pos, /*loop=*/false, 48000.f, 4, out);
    CHECK(close_to(out[0], 0.5f), "oneshot frame0 plays");
    CHECK(close_to(out[2], 0.5f), "oneshot frame1 plays");
    CHECK(close_to(out[4], 0.0f) && close_to(out[6], 0.0f), "oneshot frames past end are silent");
}

static void test_fill_loop_wraps() {
    WavData w = make_wavdata(1, 48000, { 1.0f, -1.0f });  // 2 frames
    double pos = 0.0;
    float out[12] = {0};
    wav_fill_stereo_block(w, pos, /*loop=*/true, 48000.f, 6, out);
    // Frames: 1, -1, 1, -1, 1, -1 (wrapping)
    CHECK(close_to(out[0], 1.0f), "loop frame0 == 1.0");
    CHECK(close_to(out[2], -1.0f), "loop frame1 == -1.0");
    CHECK(close_to(out[4], 1.0f), "loop frame2 wraps back to 1.0");
    CHECK(close_to(out[8], 1.0f), "loop frame4 == 1.0");
}

static void test_fill_resample_halfrate() {
    // 24 kHz file at 48 kHz engine: ratio 0.5, so playhead advances half a frame
    // per output frame — linear interpolation gives midpoints.
    WavData w = make_wavdata(1, 24000, { 0.0f, 1.0f });
    double pos = 0.0;
    float out[4] = {0};
    wav_fill_stereo_block(w, pos, /*loop=*/false, 48000.f, 2, out);
    CHECK(close_to(out[0], 0.0f), "resample frame0 == 0.0 (pos 0.0)");
    CHECK(close_to(out[2], 0.5f), "resample frame1 == 0.5 (pos 0.5 interp)");
    CHECK(close_to(static_cast<float>(pos), 1.0f), "resample advances pos by 0.5/frame");
}

static void test_fill_empty_is_silent() {
    WavData w = make_wavdata(1, 48000, {});
    double pos = 0.0;
    float out[4] = { 9.f, 9.f, 9.f, 9.f };
    wav_fill_stereo_block(w, pos, true, 48000.f, 2, out);
    CHECK(close_to(out[0], 0.0f) && close_to(out[3], 0.0f), "empty wav yields silence");
}

int main() {
    std::printf("=== WAV reader unit tests (T9.1) ===\n");
    test_pcm16_stereo();
    test_pcm24_mono();
    test_float32_mono();
    test_rejects_non_riff();
    test_rejects_unsupported_bits();
    std::printf("--- wav_fill_stereo_block (T9.2) ---\n");
    test_fill_mono_to_stereo_same_rate();
    test_fill_oneshot_silence_past_end();
    test_fill_loop_wraps();
    test_fill_resample_halfrate();
    test_fill_empty_is_silent();
    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
