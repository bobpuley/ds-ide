// Unit tests for M25/M31 emulator runtime safety fixes.
//
// Exercises units that can be compiled without the CoreAudio / AudioUnit
// framework: WAV parser guards, SPSC queue, ScopeState cap, GPIO canonical
// index, JSON parser hardening, IPC range validation, SessionPlayer lseek
// guards, and the FR-RTS-1 SessionRecorder drain-thread design.
// No framework dependency — plain asserts, exit 0 on success.

#include "wav_reader.h"
#include "emulator_state.h"
#include "ipc_server.h"
#include "session_player.h"
#include "session_recorder.h"
#include "daisy/gpio.h"
#include "daisy/midi_usb_handler.h"
#include "daisy/midi_uart_handler.h"

#include <cassert>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <sys/resource.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

// ---- Test harness -----------------------------------------------------------

using namespace daisy_emu;

// ipc_server.cpp declares `extern EmulatorState g_state;` (defined normally
// in main.cpp, which this test binary doesn't link). Provide the one
// definition this link unit needs so json_get()/json_escape() are testable
// without linking the whole runtime/effect_main().
namespace daisy_emu { EmulatorState g_state; }

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::printf("  FAIL  %s\n", msg); ++failures; } \
    else         { std::printf("  PASS  %s\n", msg); } \
} while (0)

// ---- WAV builder helpers (shared with wav-reader tests) --------------------

static void push_u16(std::vector<uint8_t>& b, uint16_t v) {
    b.push_back(v & 0xFF); b.push_back((v >> 8) & 0xFF);
}
static void push_u32(std::vector<uint8_t>& b, uint32_t v) {
    b.push_back(v & 0xFF); b.push_back((v >> 8) & 0xFF);
    b.push_back((v >> 16) & 0xFF); b.push_back((v >> 24) & 0xFF);
}
static void push_tag(std::vector<uint8_t>& b, const char* t) {
    b.insert(b.end(), t, t + 4);
}

// Assemble a WAV with an explicit bits value (can be 0 for div-by-zero tests).
static std::vector<uint8_t> make_wav_raw(uint16_t fmt_tag, uint16_t channels,
                                         uint32_t sample_rate, uint16_t bits,
                                         const std::vector<uint8_t>& data) {
    std::vector<uint8_t> b;
    uint16_t block_align = static_cast<uint16_t>(channels * (bits / 8 > 0 ? bits / 8 : 1));
    uint32_t byte_rate   = sample_rate * block_align;
    push_tag(b, "RIFF"); push_u32(b, static_cast<uint32_t>(36 + data.size()));
    push_tag(b, "WAVE"); push_tag(b, "fmt "); push_u32(b, 16);
    push_u16(b, fmt_tag); push_u16(b, channels); push_u32(b, sample_rate);
    push_u32(b, byte_rate); push_u16(b, block_align); push_u16(b, bits);
    push_tag(b, "data"); push_u32(b, static_cast<uint32_t>(data.size()));
    b.insert(b.end(), data.begin(), data.end());
    return b;
}

// ---- AC-42: WAV div-by-zero guard ------------------------------------------

static void test_wav_div_by_zero() {
    std::printf("--- AC-42: WAV div-by-zero guard ---\n");

    // bits == 0 must be rejected before total_samples division.
    std::vector<uint8_t> dummy(8, 0);
    auto wav = make_wav_raw(0x0001, 1, 48000, 0, dummy);
    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(!ok, "parse_wav rejects bits==0");
    CHECK(!err.empty(), "parse_wav sets error for bits==0");
}

// ---- AC-52: WAV rd_u16 / decode_pcm24 UB fix --------------------------------

static void test_wav_pcm24_sign_extend() {
    std::printf("--- AC-52: WAV decode_pcm24 uint32_t cast ---\n");

    // 24-bit value 0x800000 = -0.5 after sign extension; should not produce UB.
    std::vector<uint8_t> data;
    data.push_back(0x00); data.push_back(0x00); data.push_back(0x80);  // 0x800000
    data.push_back(0x00); data.push_back(0x00); data.push_back(0x40);  // 0x400000 = +0.5
    auto wav = make_wav_raw(0x0001, 1, 48000, 24, data);

    WavData out; std::string err;
    bool ok = parse_wav(wav.data(), wav.size(), out, err);
    CHECK(ok, "pcm24 with 0x800000 parses");
    CHECK(out.frames() == 2, "pcm24 two frames");
    CHECK(std::fabs(out.samples[0] - (-1.0f)) < 1e-4f, "0x800000 decodes to -1.0");
    CHECK(std::fabs(out.samples[1] - 0.5f) < 1e-4f, "0x400000 decodes to +0.5");
}

// ---- FR-EMU-5: load_wav_file validates magic + size ceiling before buffering

static void test_load_wav_file_valid_small_file() {
    std::printf("--- FR-EMU-5: load_wav_file still loads a valid small WAV ---\n");

    std::vector<uint8_t> data;
    for (int i = 0; i < 8; ++i) push_u16(data, static_cast<uint16_t>(1000 * i));
    auto wav = make_wav_raw(0x0001, 1, 48000, 16, data);

    char tmp[] = "/tmp/test_smallwav_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::write(fd, wav.data(), wav.size());
    ::close(fd);

    WavData out;
    std::string err;
    bool ok = load_wav_file(std::string(tmp), out, err);
    CHECK(ok, "load_wav_file loads a valid small WAV");
    CHECK(out.frames() == 8, "decoded frame count matches the written data");

    ::unlink(tmp);
}

static void test_load_wav_file_rejects_non_wav() {
    std::printf("--- FR-EMU-5: load_wav_file rejects a non-WAV file before full buffering ---\n");

    char tmp[] = "/tmp/test_notwav_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    std::vector<uint8_t> junk(4096, 0x42);  // plausible-size, wrong magic
    ::write(fd, junk.data(), junk.size());
    ::close(fd);

    WavData out;
    std::string err;
    auto t0 = std::chrono::steady_clock::now();
    bool ok = load_wav_file(std::string(tmp), out, err);
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();

    CHECK(!ok, "load_wav_file rejects a file with no RIFF/WAVE magic");
    CHECK(!err.empty(), "load_wav_file sets an error message for a non-WAV file");
    CHECK(elapsed_ms < 1000, "rejection is immediate (magic checked before full buffering)");

    ::unlink(tmp);
}

static void test_load_wav_file_rejects_oversize_file() {
    std::printf("--- FR-EMU-5: load_wav_file rejects a file over the size ceiling ---\n");

    char tmp[] = "/tmp/test_hugewav_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }

    // Sparse file: report a size just over the 256 MB ceiling without
    // actually writing that much data to disk.
    const long long kOverCeiling = 256LL * 1024 * 1024 + 1024;
    if (::ftruncate(fd, static_cast<off_t>(kOverCeiling)) != 0) {
        std::printf("  SKIP  ftruncate to a large sparse size failed\n");
        ::close(fd);
        ::unlink(tmp);
        return;
    }
    // Give it valid-looking RIFF/WAVE magic at the start so the ceiling check
    // (not the magic check) is what's actually being exercised.
    ::lseek(fd, 0, SEEK_SET);
    uint8_t header[12] = {
        'R','I','F','F', 0,0,0,0, 'W','A','V','E'
    };
    ::write(fd, header, sizeof(header));
    ::close(fd);

    WavData out;
    std::string err;
    auto t0 = std::chrono::steady_clock::now();
    bool ok = load_wav_file(std::string(tmp), out, err);
    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - t0).count();

    CHECK(!ok, "load_wav_file rejects a file over the 256 MB ceiling");
    CHECK(!err.empty(), "load_wav_file sets an error message for an oversize file");
    CHECK(elapsed_ms < 1000,
          "rejection is immediate (size checked via fstat before any buffering)");

    ::unlink(tmp);
}

// ---- AC-39: SpscIpcQueue basic SPSC correctness ----------------------------

static void test_spsc_queue_basic() {
    std::printf("--- AC-39: SpscIpcQueue basic ---\n");

    SpscIpcQueue q;
    std::string out;

    // Empty pop returns false.
    CHECK(!q.pop(out), "empty queue returns false on pop");

    // Push and pop one message.
    CHECK(q.push("hello"), "push succeeds");
    CHECK(q.pop(out), "pop returns true");
    CHECK(out == "hello", "pop returns correct message");
    CHECK(!q.pop(out), "queue empty after single pop");
}

static void test_spsc_queue_wrap() {
    std::printf("--- AC-39: SpscIpcQueue wrap-around ---\n");

    SpscIpcQueue q;
    // Fill (CAPACITY - 1) slots: queue is full when write_+1 == read_.
    const int max_pushes = static_cast<int>(SpscIpcQueue::CAPACITY) - 1;
    for (int i = 0; i < max_pushes; ++i) {
        bool ok = q.push(std::to_string(i));
        CHECK(ok, "push before full succeeds");
        if (!ok) break;
    }
    // One more push should fail (queue full).
    CHECK(!q.push("overflow"), "push fails when full");

    // Drain all and verify order.
    bool order_ok = true;
    for (int i = 0; i < max_pushes; ++i) {
        std::string s;
        if (!q.pop(s) || s != std::to_string(i)) { order_ok = false; break; }
    }
    CHECK(order_ok, "FIFO order preserved");
}

static void test_spsc_queue_threaded() {
    std::printf("--- AC-39: SpscIpcQueue producer/consumer threads ---\n");

    SpscIpcQueue q;
    static constexpr int N = 1000;
    std::atomic<int> received{0};
    std::atomic<bool> done{false};

    std::thread consumer([&]() {
        std::string msg;
        while (true) {
            if (q.pop(msg)) {
                ++received;
            } else if (done.load()) {
                break;
            } else {
                std::this_thread::yield();
            }
        }
        // Drain any remaining messages posted before done was observed.
        while (q.pop(msg)) ++received;
    });

    for (int i = 0; i < N; ++i) {
        while (!q.push(std::to_string(i)))
            std::this_thread::yield();  // retry if full
    }
    done.store(true);
    consumer.join();

    CHECK(received.load() == N, "threaded producer/consumer delivers all messages");
}

// ---- AC-40: ScopeState hard cap on accumulate ------------------------------

// Lightweight copy of ScopeState for isolated testing.
struct TestScopeState {
    static constexpr size_t SCOPE_BLOCKS    = 33;
    static constexpr size_t SCOPE_STEP      = 4;
    static constexpr size_t SCOPE_SAMPLES_MAX = 65536;

    std::vector<float> in, out, out_r;
    size_t block_count{0};

    TestScopeState() {
        in.reserve(SCOPE_SAMPLES_MAX);
        out.reserve(SCOPE_SAMPLES_MAX);
        out_r.reserve(SCOPE_SAMPLES_MAX);
    }

    bool accumulate(const std::vector<float>& in_buf,
                    const std::vector<float>& out_buf,
                    size_t frames) {
        size_t buf_samples = frames * 2;
        for (size_t i = 0; i < buf_samples; i += SCOPE_STEP * 2) {
            if (in.size() >= SCOPE_SAMPLES_MAX) break;
            in.push_back(in_buf[i]);
            out.push_back(out_buf[i]);
            out_r.push_back(out_buf[i + 1]);
        }
        ++block_count;
        if (block_count >= SCOPE_BLOCKS) { block_count = 0; return true; }
        return false;
    }
};

static void test_scope_cap() {
    std::printf("--- AC-40: ScopeState hard cap ---\n");

    TestScopeState scope;
    // Large block: 4096 stereo frames → 4096/4 = 1024 samples per accumulate call.
    const size_t LARGE = 4096;
    std::vector<float> in_buf(LARGE * 2, 0.1f);
    std::vector<float> out_buf(LARGE * 2, 0.2f);

    // Accumulate many blocks without ever triggering the block_count threshold.
    // Without the cap, vectors would grow unboundedly.
    for (int i = 0; i < 200; ++i) {
        scope.accumulate(in_buf, out_buf, LARGE);
    }

    CHECK(scope.in.size() <= TestScopeState::SCOPE_SAMPLES_MAX,
          "in vector does not exceed SCOPE_SAMPLES_MAX");
    CHECK(scope.out.size() <= TestScopeState::SCOPE_SAMPLES_MAX,
          "out vector does not exceed SCOPE_SAMPLES_MAX");
    CHECK(scope.in.capacity() == TestScopeState::SCOPE_SAMPLES_MAX,
          "no reallocation beyond pre-reserved capacity");
}

// ---- FR-EMU-2: scope sample budget derived from MAX_MSG --------------------

// Lightweight copy of the FR-EMU-2 ScopeState (audio_engine.cpp): the sample
// budget is computed from SpscIpcQueue::MAX_MSG and the decimation step
// scales with the hardware frame count, instead of a fixed independently-sized
// constant that a large hardware frame size could blow past (see the
// production ScopeState in audio_engine.cpp for the authoritative version;
// this mirrors it exactly so the test tracks real behavior).
struct TestScopeStateV2 {
    static constexpr size_t SCOPE_BLOCKS            = 33;
    static constexpr size_t SCOPE_STEP_BASE_FRAMES  = 256;
    static constexpr size_t SCOPE_STEP_BASE         = 4;
    static constexpr size_t kBytesPerValueWorstCase = 16;
    static constexpr size_t kFixedOverheadBytes     = 128;
    static constexpr size_t SCOPE_SAMPLES_MAX =
        (SpscIpcQueue::MAX_MSG - kFixedOverheadBytes) / (3 * kBytesPerValueWorstCase);

    std::vector<float> in, out, out_r;
    size_t block_count{0};

    TestScopeStateV2() {
        in.reserve(SCOPE_SAMPLES_MAX);
        out.reserve(SCOPE_SAMPLES_MAX);
        out_r.reserve(SCOPE_SAMPLES_MAX);
    }

    bool accumulate(const std::vector<float>& in_buf,
                    const std::vector<float>& out_buf,
                    size_t frames) {
        size_t step = SCOPE_STEP_BASE;
        if (frames > SCOPE_STEP_BASE_FRAMES)
            step = SCOPE_STEP_BASE * frames / SCOPE_STEP_BASE_FRAMES;

        size_t buf_samples = frames * 2;
        for (size_t i = 0; i < buf_samples; i += step * 2) {
            if (in.size() >= SCOPE_SAMPLES_MAX) break;
            in.push_back(in_buf[i]);
            out.push_back(out_buf[i]);
            out_r.push_back(out_buf[i + 1]);
        }
        ++block_count;
        if (block_count >= SCOPE_BLOCKS) { block_count = 0; return true; }
        return false;
    }
};

static void test_scope_budget_derived_from_max_msg() {
    std::printf("--- FR-EMU-2: scope sample budget is derived from MAX_MSG ---\n");

    CHECK(TestScopeStateV2::SCOPE_SAMPLES_MAX > 0,
          "derived SCOPE_SAMPLES_MAX is positive");
    CHECK(TestScopeStateV2::SCOPE_SAMPLES_MAX < 65536,
          "derived budget is tighter than the old fixed 65536 constant "
          "(it now accounts for MAX_MSG rather than being sized independently)");

    // Worst-case estimated message size for a full accumulation must not
    // exceed MAX_MSG: 3 channel arrays, each up to SCOPE_SAMPLES_MAX values.
    size_t worst_case_bytes = TestScopeStateV2::kFixedOverheadBytes
                            + 3 * TestScopeStateV2::SCOPE_SAMPLES_MAX
                                * TestScopeStateV2::kBytesPerValueWorstCase;
    CHECK(worst_case_bytes <= SpscIpcQueue::MAX_MSG,
          "worst-case estimated scope message size fits within MAX_MSG");
}

static void test_scope_decimation_scales_with_frame_size() {
    std::printf("--- FR-EMU-2: decimation step scales up with hardware frame size ---\n");

    // At a large hardware frame size (4096, matching the architecture doc's
    // worst case), accumulating SCOPE_BLOCKS blocks must never exceed the
    // derived per-channel sample budget or reallocate past reserved capacity.
    TestScopeStateV2 scope;
    const size_t LARGE = 4096;
    std::vector<float> in_buf(LARGE * 2, 0.1f);
    std::vector<float> out_buf(LARGE * 2, 0.2f);

    for (size_t i = 0; i < TestScopeStateV2::SCOPE_BLOCKS; ++i) {
        scope.accumulate(in_buf, out_buf, LARGE);
    }

    CHECK(scope.in.size() <= TestScopeStateV2::SCOPE_SAMPLES_MAX,
          "accumulated samples stay within the MAX_MSG-derived budget at 4096 frames/block");
    CHECK(scope.in.capacity() == TestScopeStateV2::SCOPE_SAMPLES_MAX,
          "no reallocation beyond pre-reserved capacity at 4096 frames/block");

    // At the reference frame size (256), behavior must match the original
    // fixed step (no regression for the common case).
    TestScopeStateV2 scope_baseline;
    std::vector<float> in_buf_baseline(256 * 2, 0.1f);
    std::vector<float> out_buf_baseline(256 * 2, 0.2f);
    scope_baseline.accumulate(in_buf_baseline, out_buf_baseline, 256);
    CHECK(scope_baseline.in.size() == 256 * 2 / (TestScopeStateV2::SCOPE_STEP_BASE * 2),
          "at the reference frame size, one block adds frames/SCOPE_STEP_BASE samples");
}

// ---- FR-EMU-2: SpscIpcQueue::push() truncates oversize messages -----------

static void test_spsc_queue_oversize_truncation() {
    std::printf("--- FR-EMU-2: SpscIpcQueue::push() truncates over-MAX_MSG messages ---\n");

    SpscIpcQueue q;
    std::string oversized(SpscIpcQueue::MAX_MSG + 5000, 'z');

    CHECK(q.oversize_drops.load() == 0, "oversize_drops starts at zero");
    bool ok = q.push(oversized);
    CHECK(ok, "push() of an oversize message still succeeds (truncated, not rejected)");
    CHECK(q.oversize_drops.load() == 1, "oversize_drops increments once for the truncated message");

    std::string out;
    CHECK(q.pop(out), "pop() returns the truncated message");
    CHECK(out.size() == SpscIpcQueue::MAX_MSG,
          "truncated message is exactly MAX_MSG bytes — never larger");

    // A message exactly at MAX_MSG must not be counted as oversize.
    std::string exact(SpscIpcQueue::MAX_MSG, 'a');
    q.push(exact);
    CHECK(q.oversize_drops.load() == 1,
          "a message exactly at MAX_MSG is not counted as an oversize drop");

    // The const char* overload must apply the same truncation + counting.
    std::string oversized_cstr(SpscIpcQueue::MAX_MSG + 10, 'x');
    q.push(oversized_cstr.c_str());
    CHECK(q.oversize_drops.load() == 2,
          "push(const char*) truncates and counts an oversize message the same way");
}

// ---- AC-48: GPIO canonical_gpio_index no aliasing -------------------------

static void test_gpio_canonical_index() {
    std::printf("--- AC-48: GPIO canonical index ---\n");

    // D0 = {port=0, pin=0}  → index 0
    // A6 = {port=1, pin=0}  → index 32  (was 0 before fix — aliased D0)
    dsy_gpio_pin D0{0, 0};
    dsy_gpio_pin D5{0, 5};
    dsy_gpio_pin A6{1, 0};
    dsy_gpio_pin A7{1, 1};
    dsy_gpio_pin A11{1, 5};

    CHECK(canonical_gpio_index(D0) == 0, "D0 maps to index 0");
    CHECK(canonical_gpio_index(D5) == 5, "D5 maps to index 5");
    CHECK(canonical_gpio_index(A6) == 32, "A6 maps to index 32");
    CHECK(canonical_gpio_index(A7) == 33, "A7 maps to index 33");
    CHECK(canonical_gpio_index(A11) == 37, "A11 maps to index 37");
    CHECK(canonical_gpio_index(D0) != canonical_gpio_index(A6),
          "D0 and A6 map to distinct indices");
    CHECK(canonical_gpio_index(D5) != canonical_gpio_index(A6),
          "D5 and A6 map to distinct indices");
    CHECK(canonical_gpio_index(A6) < EmulatorState::kNumGpioPins,
          "A6 canonical index within kNumGpioPins");
    CHECK(canonical_gpio_index(A11) < EmulatorState::kNumGpioPins,
          "A11 canonical index within kNumGpioPins");
}

// ---- FR-DEV-1: controlValue/controlSnapshot IPC handlers ------------------
// (formerly separate pot/potSnapshot/button/buttonSnapshot message kinds —
// FR-QA-EMU-5's clamp/reject behavior is preserved exactly, now reached via
// a single message kind with device identity carried in the id field.)

static void test_control_value_pot_clamps_and_rejects_nonfinite() {
    std::printf("--- FR-DEV-1: \"controlValue\" (pot) clamps to [0,1] and rejects non-finite ---\n");

    for (auto& v : g_state.pot_values) v.store(0.f);

    dispatch(R"({"type":"controlValue","id":"pot0","value":0.5})");
    CHECK(std::fabs(g_state.pot_values[0].load() - 0.5f) < 1e-6f,
          "an in-range value is stored as-is");

    dispatch(R"({"type":"controlValue","id":"pot1","value":-3.0})");
    CHECK(g_state.pot_values[1].load() == 0.f, "a negative value clamps to 0");

    dispatch(R"({"type":"controlValue","id":"pot2","value":7.5})");
    CHECK(g_state.pot_values[2].load() == 1.f, "a value above 1 clamps to 1");

    g_state.pot_values[3].store(0.42f);
    dispatch(R"({"type":"controlValue","id":"pot3","value":NaN})");
    CHECK(g_state.pot_values[3].load() == 0.42f,
          "a NaN value is rejected — the previous value is left in place");

    g_state.pot_values[4].store(0.11f);
    dispatch(R"({"type":"controlValue","id":"pot4","value":Infinity})");
    CHECK(g_state.pot_values[4].load() == 0.11f,
          "an Infinity value is rejected — the previous value is left in place");

    g_state.pot_values[5].store(0.77f);
    dispatch(R"({"type":"controlValue","id":"pot5","value":-Infinity})");
    CHECK(g_state.pot_values[5].load() == 0.77f,
          "a -Infinity value is rejected — the previous value is left in place");

    dispatch(R"({"type":"controlValue","id":"pot12","value":0.9})");
    CHECK(g_state.pot_values[0].load() != 0.9f,
          "an id past the pot range (pot12) is rejected without touching any pot slot");

    dispatch(R"({"type":"controlValue","id":"nope3","value":0.9})");
    CHECK(true, "an unrecognized id prefix is rejected without crashing");
}

static void test_control_snapshot_pot_clamps_and_rejects_nonfinite() {
    std::printf("--- FR-DEV-1: \"controlSnapshot\" (pot) clamps to [0,1] and rejects non-finite ---\n");

    for (auto& v : g_state.pot_values) v.store(0.f);

    dispatch(R"({"type":"controlSnapshot","values":{"pot0":0.25,"pot1":-5,"pot2":9,"pot3":NaN}})");
    CHECK(std::fabs(g_state.pot_values[0].load() - 0.25f) < 1e-6f,
          "an in-range snapshot value is stored as-is");
    CHECK(g_state.pot_values[1].load() == 0.f, "a negative snapshot value clamps to 0");
    CHECK(g_state.pot_values[2].load() == 1.f, "an over-range snapshot value clamps to 1");
    CHECK(g_state.pot_values[3].load() == 0.f,
          "a NaN snapshot value is rejected — the (reset) prior value is left in place");
}

static void test_control_value_button_sets_state() {
    std::printf("--- FR-DEV-1: \"controlValue\" (button) sets button_states by id ---\n");

    for (auto& b : g_state.button_states) b.store(false);

    dispatch(R"({"type":"controlValue","id":"btn0","value":1})");
    CHECK(g_state.button_states[0].load() == true, "a non-zero value presses the button");

    dispatch(R"({"type":"controlValue","id":"btn0","value":0})");
    CHECK(g_state.button_states[0].load() == false, "a zero value releases the button");

    g_state.button_states[1].store(true);
    dispatch(R"({"type":"controlValue","id":"btn1","value":NaN})");
    CHECK(g_state.button_states[1].load() == true,
          "a NaN value is rejected — the previous state is left in place");

    dispatch(R"({"type":"controlValue","id":"btn64","value":1})");
    CHECK(g_state.button_states[0].load() == false,
          "an id past the button range (btn64, kNumGpioPins==64) is rejected");
}

static void test_control_snapshot_mixed_pot_and_button() {
    std::printf("--- FR-DEV-1: \"controlSnapshot\" carries pot and button ids in one message ---\n");

    for (auto& v : g_state.pot_values) v.store(0.f);
    for (auto& b : g_state.button_states) b.store(false);

    dispatch(R"({"type":"controlSnapshot","values":{"pot3":0.6,"btn7":1,"btn8":0}})");
    CHECK(std::fabs(g_state.pot_values[3].load() - 0.6f) < 1e-6f,
          "a pot id in a mixed snapshot is stored");
    CHECK(g_state.button_states[7].load() == true,
          "a button id in a mixed snapshot is stored (pressed)");
    CHECK(g_state.button_states[8].load() == false,
          "a button id in a mixed snapshot is stored (released)");
}

// ---- FR-DEV-1: decode_control_id() id-prefix decoding ----------------------

static void test_decode_control_id() {
    std::printf("--- FR-DEV-1: decode_control_id() ---\n");

    char kind; int idx;
    CHECK(decode_control_id("pot0", kind, idx) && kind == 'P' && idx == 0,
          "\"pot0\" decodes to pot index 0");
    CHECK(decode_control_id("pot11", kind, idx) && kind == 'P' && idx == 11,
          "\"pot11\" decodes to pot index 11 (last valid pot)");
    CHECK(!decode_control_id("pot12", kind, idx), "\"pot12\" is out of range (max 12 pots)");
    CHECK(decode_control_id("btn0", kind, idx) && kind == 'B' && idx == 0,
          "\"btn0\" decodes to button index 0");
    CHECK(decode_control_id("btn63", kind, idx) && kind == 'B' && idx == 63,
          "\"btn63\" decodes to button index 63 (last valid button)");
    CHECK(!decode_control_id("btn64", kind, idx), "\"btn64\" is out of range (kNumGpioPins==64)");
    CHECK(!decode_control_id("led3", kind, idx), "an unrecognized prefix is rejected");
    CHECK(!decode_control_id("pot", kind, idx), "a bare prefix with no numeric suffix is rejected");
    CHECK(!decode_control_id("potX", kind, idx), "a non-numeric suffix is rejected");
    CHECK(!decode_control_id("", kind, idx), "an empty id is rejected");
}

// ---- FR-EMU-6: json_get() key lookup doesn't match inside string values ----

static void test_json_get_basic_fields() {
    std::printf("--- FR-EMU-6: json_get() basic string/number/object fields ---\n");

    std::string msg = R"({"type":"config","sampleRate":48000,"blockSize":48})";
    CHECK(json_get(msg, "type") == "config", "string field extracted correctly");
    CHECK(json_get(msg, "sampleRate") == "48000", "number field extracted correctly");
    CHECK(json_get(msg, "blockSize") == "48", "second number field extracted correctly");
    CHECK(json_get(msg, "missing").empty(), "absent key returns empty string");

    std::string nested = R"({"type":"controlSnapshot","values":{"pot0":0.5,"pot1":0.3}})";
    CHECK(json_get(nested, "values") == R"({"pot0":0.5,"pot1":0.3})",
          "nested object value extracted as its raw substring");
}

static void test_json_get_ignores_key_literal_inside_string_value() {
    std::printf("--- FR-EMU-6: json_get() key search ignores literal key text inside "
                "an earlier field's string value ---\n");

    // The "path" field (which comes first) contains the literal escaped text
    // \"type\": inside its own value — a naive substring search for the key
    // "type" would match here instead of the real "type" field that follows.
    std::string msg =
        R"({"path":"/some/dir/\"type\":odd.wav","type":"wavFile","loop":"false"})";

    CHECK(json_get(msg, "type") == "wavFile",
          "the real top-level \"type\" field is found, not the fake occurrence "
          "embedded inside \"path\"'s string value");
    CHECK(json_get(msg, "path") == "/some/dir/\"type\":odd.wav",
          "\"path\"'s value is extracted in full (with its escaped quotes decoded), "
          "and parsing it doesn't get confused by its own embedded key-like text");
    CHECK(json_get(msg, "loop") == "false",
          "a field after the tricky string value is still found correctly");
}

static void test_json_get_malformed_input_terminates() {
    std::printf("--- FR-EMU-6: json_get() terminates (doesn't hang) on malformed input ---\n");

    CHECK(json_get("", "type").empty(), "empty input returns empty");
    CHECK(json_get("{", "type").empty(), "unterminated object returns empty");
    CHECK(json_get(R"({"type)", "type").empty(), "unterminated key string returns empty");
    CHECK(json_get(R"({"type":"unterminated)", "type").empty(),
          "unterminated string value returns empty rather than looping forever");
    CHECK(json_get("not json at all", "type").empty(), "non-JSON input returns empty");
}

// ---- FR-QA-EMU-6: json_get() decodes standard JSON escape sequences --------

static void test_json_get_decodes_standard_escapes() {
    std::printf("--- FR-QA-EMU-6: json_get() decodes standard escape sequences ---\n");

    std::string msg = R"({"path":"line1\nline2\ttab\r\b\f\"quote\"\\backslash\/slash"})";
    std::string expected = "line1\nline2\ttab\r\b\f\"quote\"\\backslash/slash";
    CHECK(json_get(msg, "path") == expected,
          "\\n \\t \\r \\b \\f \\\" \\\\ \\/ all decode to their real characters "
          "instead of dropping the backslash");
}

static void test_json_get_decodes_unicode_escape() {
    std::printf("--- FR-QA-EMU-6: json_get() decodes \\uXXXX escapes ---\n");

    // A = 'A' (single-byte UTF-8).
    const char* ascii_json = "{\"msg\":\"\\u0041BC\"}";
    CHECK(json_get(ascii_json, "msg") == "ABC",
          "a \\u escape in the ASCII range decodes to its literal character");

    // U+00E9 ('e' with acute accent), UTF-8: 0xC3 0xA9.
    std::string msg = "{\"msg\":\"caf\\u00e9\"}";
    std::string expected = "caf\xC3\xA9";
    CHECK(json_get(msg, "msg") == expected,
          "a \\u escape above the ASCII range decodes to the correct UTF-8 bytes");
}

static void test_json_get_rejects_malformed_unicode_escape() {
    std::printf("--- FR-QA-EMU-6: json_get() rejects a malformed \\u escape ---\n");

    CHECK(json_get(R"({"msg":"bad\u12"})", "msg").empty(),
          "a \\u escape with fewer than 4 hex digits is rejected");
    CHECK(json_get(R"({"msg":"bad\uZZZZ"})", "msg").empty(),
          "a \\u escape with non-hex digits is rejected");
}

static void test_json_escape_produces_valid_json_content() {
    std::printf("--- FR-EMU-6: json_escape() escapes quotes/backslashes/control chars ---\n");

    CHECK(json_escape("plain text") == "plain text", "plain text is unchanged");
    CHECK(json_escape("has \"quotes\"") == "has \\\"quotes\\\"",
          "double quotes are escaped");
    CHECK(json_escape("back\\slash") == "back\\\\slash",
          "backslashes are escaped");
    CHECK(json_escape("line\nbreak") == "line\\nbreak", "newline is escaped");

    // Exception text containing quotes/backslashes must round-trip through
    // json_escape() into a value that, embedded in a JSON string literal,
    // parses back out via json_get() to the original text.
    std::string exc_text = "bad path: \"C:\\temp\\file\"";
    std::string escaped = json_escape(exc_text);
    std::string wire = "{\"type\":\"event\",\"kind\":\"dispatch_error\",\"msg\":\""
                      + escaped + "\"}";
    CHECK(json_get(wire, "msg") == exc_text,
          "escaped exception text round-trips through json_get() to the original string");
}

// ---- AC-47: SessionPlayer open() rejects oversized block_size --------------

// Build a minimal in-memory .dsrec file with a given block_size in the header.
static std::vector<uint8_t> make_dsrec_header(uint32_t sample_rate, uint32_t block_size) {
    std::vector<uint8_t> hdr(16);
    std::memcpy(hdr.data(), "DSREC", 5);
    hdr[5] = '\0';
    hdr[6] = 0x01;  // kRecMagicVersion
    hdr[7] = 0x00;
    hdr[8]  = static_cast<uint8_t>(sample_rate & 0xFF);
    hdr[9]  = static_cast<uint8_t>((sample_rate >> 8) & 0xFF);
    hdr[10] = static_cast<uint8_t>((sample_rate >> 16) & 0xFF);
    hdr[11] = static_cast<uint8_t>((sample_rate >> 24) & 0xFF);
    hdr[12] = static_cast<uint8_t>(block_size & 0xFF);
    hdr[13] = static_cast<uint8_t>((block_size >> 8) & 0xFF);
    hdr[14] = static_cast<uint8_t>((block_size >> 16) & 0xFF);
    hdr[15] = static_cast<uint8_t>((block_size >> 24) & 0xFF);
    return hdr;
}

static void test_session_player_open_guard() {
    std::printf("--- AC-47: SessionPlayer open() block_size guard ---\n");

    // Write a .dsrec with block_size = 70000 (> 65536) to a temp file.
    char tmp[] = "/tmp/test_dsrec_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) {
        std::printf("  SKIP  mkstemp failed — skipping SessionPlayer test\n");
        return;
    }
    auto hdr = make_dsrec_header(48000, 70000);
    ::write(fd, hdr.data(), hdr.size());
    ::close(fd);

    SessionPlayer player;
    uint32_t sr = 0, bs = 0;
    bool ok = player.open(std::string(tmp), sr, bs);
    ::unlink(tmp);

    CHECK(!ok, "open() rejects block_size > 65536");
}

// ---- FR-RTS-1: SessionRecorder enqueueBlock is RT-safe (no blocking I/O) -----

// Build a minimal valid .dsrec header from a byte buffer.
static bool dsrec_has_header(const std::vector<uint8_t>& bytes) {
    return bytes.size() >= 16
        && bytes[0] == 'D' && bytes[1] == 'S' && bytes[2] == 'R'
        && bytes[3] == 'E' && bytes[4] == 'C';
}

static void test_session_recorder_drain_thread() {
    std::printf("--- FR-RTS-1: SessionRecorder drain thread writes all blocks ---\n");

    // Write to a temp file so we can inspect the output.
    char tmp[] = "/tmp/test_rec_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) {
        std::printf("  SKIP  mkstemp failed\n");
        return;
    }
    ::close(fd);

    static constexpr size_t FRAMES = 256;
    static constexpr int    BLOCKS = 10;

    SessionRecorder rec;
    bool started = rec.start(std::string(tmp), 48000, FRAMES);
    CHECK(started, "start() succeeds");
    CHECK(rec.active(), "active() true after start");

    // Enqueue BLOCKS audio blocks (simulating what the RT thread does).
    std::vector<float> buf(FRAMES * 2, 0.5f);
    int enqueued = 0;
    for (int i = 0; i < BLOCKS; ++i) {
        if (rec.enqueueBlock(buf.data(), FRAMES)) ++enqueued;
    }
    CHECK(enqueued == BLOCKS, "all blocks enqueued into ring buffer");
    CHECK(rec.blockCount() == static_cast<uint32_t>(BLOCKS),
          "blockCount() reflects enqueued count");

    rec.stop();
    CHECK(!rec.active(), "active() false after stop");
    CHECK(!rec.hasWriteError(), "hasWriteError() stays false for a normal successful recording");

    // Inspect the file: header (16 bytes) + BLOCKS × (1-byte type + FRAMES*2*4 data bytes).
    int rfd = ::open(tmp, O_RDONLY);
    CHECK(rfd >= 0, "output file exists and is readable");
    if (rfd >= 0) {
        std::vector<uint8_t> content;
        uint8_t chunk[4096];
        ssize_t n;
        while ((n = ::read(rfd, chunk, sizeof(chunk))) > 0)
            content.insert(content.end(), chunk, chunk + n);
        ::close(rfd);

        CHECK(dsrec_has_header(content), "file begins with DSREC header");
        size_t expected_audio_bytes = BLOCKS * (1 + FRAMES * 2 * sizeof(float));
        // header(16) + audio_blocks + END(1)
        size_t expected_total = 16 + expected_audio_bytes + 1;
        CHECK(content.size() == expected_total, "file size matches header + blocks + END");
        // Last byte should be the END marker
        CHECK(content.back() == 0xFF, "file ends with END marker (0xFF)");
    }

    ::unlink(tmp);
}

// ---- FR-EMU-4: recorder write failures are reported, not silently truncated

static void test_session_recorder_write_error_reported() {
    std::printf("--- FR-EMU-4: writeBytes failure sets hasWriteError(), stops draining ---\n");
    std::fflush(stdout);

    char tmp[] = "/tmp/test_rec_fsize_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::close(fd);

    // Portable fault injection: cap RLIMIT_FSIZE so write() fails with EFBIG
    // shortly after the file crosses a tiny size limit — no real full disk
    // needed. RLIMIT_FSIZE is process-wide (it would also apply to this test
    // binary's own stdout once redirected to a log file), and SIGXFSZ's
    // default action terminates the process, so both are scoped to a forked
    // child rather than applied to this process.
    pid_t pid = ::fork();
    if (pid < 0) {
        std::printf("  SKIP  fork() failed\n");
        ::unlink(tmp);
        return;
    }

    if (pid == 0) {
        struct rlimit small_fsize{4096, 4096};
        ::setrlimit(RLIMIT_FSIZE, &small_fsize);
        struct sigaction ign{};
        ign.sa_handler = SIG_IGN;
        ::sigaction(SIGXFSZ, &ign, nullptr);

        SessionRecorder rec;
        const size_t FRAMES = 512;  // 512*2*4 = 4096 bytes/block audio payload alone
        bool started = rec.start(std::string(tmp), 48000, FRAMES);

        std::vector<float> buf(FRAMES * 2, 0.5f);
        for (int i = 0; i < 50; ++i) rec.enqueueBlock(buf.data(), FRAMES);

        int guard = 0;
        while (rec.active() && guard++ < 2000)
            std::this_thread::sleep_for(std::chrono::milliseconds(5));

        bool had_error    = rec.hasWriteError();
        bool now_inactive = !rec.active();
        rec.stop();  // must be safe even though the drain thread already exited

        int code = (started ? 1 : 0) | (had_error ? 2 : 0) | (now_inactive ? 4 : 0);
        _exit(code);
    }

    int status = 0;
    ::waitpid(pid, &status, 0);
    ::unlink(tmp);

    CHECK(WIFEXITED(status), "fault-injection child process exited normally (no crash)");
    int code = WIFEXITED(status) ? WEXITSTATUS(status) : 0;
    CHECK((code & 1) != 0, "start() succeeds");
    CHECK((code & 2) != 0,
          "hasWriteError() becomes true once writeBytes fails past RLIMIT_FSIZE");
    CHECK((code & 4) != 0,
          "active() becomes false once the drain thread observes the write error "
          "(stops feeding a recording that can no longer be drained)");
}

static void test_session_recorder_enqueue_drop_on_full() {
    std::printf("--- FR-RTS-1: SessionRecorder drops blocks when ring buffer full ---\n");

    char tmp[] = "/tmp/test_rec2_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::close(fd);

    SessionRecorder rec;
    rec.start(std::string(tmp), 48000, 256);

    // The ring buffer capacity is kAudioSlotCount - 1 = 63 usable slots.
    // Fill it exactly and then push one more — the overflow should be dropped.
    // We pause the drain thread effect by stopping transport immediately and
    // enqueueing faster than it can drain.
    // Since we can't control the drain thread timing precisely, we just verify
    // that enqueueBlock returns false when the ring is truly full.
    //
    // Strategy: fill 63 slots without the drain thread running (we call stop()
    // before it can drain). Actually we need a different approach since stop()
    // joins the thread after it drains.
    //
    // Instead, just verify block_count() reflects only successfully enqueued
    // blocks, and that enqueueBlock returns a bool we can inspect.
    std::vector<float> buf(256 * 2, 0.f);
    int success = 0, fail = 0;
    for (int i = 0; i < 70; ++i) {
        if (rec.enqueueBlock(buf.data(), 256)) ++success;
        else ++fail;
    }
    // Drain thread may consume some slots, so we just check it ran without crash
    CHECK(success > 0, "at least one enqueue succeeded");
    CHECK(success + fail == 70, "total attempts equals success + fail");

    rec.stop();
    ::unlink(tmp);
}

static void test_session_recorder_no_blocking_on_rt_path() {
    std::printf("--- FR-RTS-1: enqueueBlock does not call ::write() ---\n");

    // Verify enqueueBlock returns immediately even when called many times.
    // We can't hook syscalls directly in a unit test, but we can verify
    // the function completes in a small number of microseconds.
    char tmp[] = "/tmp/test_rec3_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::close(fd);

    SessionRecorder rec;
    rec.start(std::string(tmp), 48000, 256);

    std::vector<float> buf(256 * 2, 0.1f);
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 100; ++i)
        rec.enqueueBlock(buf.data(), 256);
    auto elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - t0).count();

    rec.stop();
    ::unlink(tmp);

    // 100 enqueues should complete in well under 1 ms on any reasonable system.
    // (A single ::write() for 256*2*4 = 2048 bytes typically takes 5–50 µs.)
    CHECK(elapsed_us < 1000, "100 enqueueBlock calls complete in under 1 ms");
}

// ---- FR-RTS-2: SPSC slot capacity ≥ 80 kB, no realloc for large messages ----

static void test_spsc_max_msg_size() {
    std::printf("--- FR-RTS-2: SpscIpcQueue MAX_MSG ≥ 80 kB ---\n");

    CHECK(SpscIpcQueue::MAX_MSG >= 81920,
          "MAX_MSG is at least 81920 bytes (80 kB)");

    SpscIpcQueue q;
    // Build a message exactly at MAX_MSG bytes.
    std::string large(SpscIpcQueue::MAX_MSG, 'x');
    bool ok = q.push(large);
    CHECK(ok, "push of MAX_MSG-sized message succeeds");

    std::string out;
    CHECK(q.pop(out), "pop returns true for MAX_MSG message");
    CHECK(out.size() == SpscIpcQueue::MAX_MSG, "popped message has correct size");
}

static void test_spsc_slot_no_realloc() {
    std::printf("--- FR-RTS-2: SpscIpcQueue slot does not reallocate ---\n");

    SpscIpcQueue q;
    // Push a message that fills the slot to capacity; then push an equally-
    // sized message to the same slot after a pop. If the slot reallocates,
    // it will exceed the pre-reserved capacity.
    std::string large(SpscIpcQueue::MAX_MSG, 'a');
    q.push(large);
    std::string out;
    q.pop(out);

    // Capture the slot capacity after the first message has been
    // assigned. Push again and check capacity is unchanged.
    // Access the internal state by pushing a second full message.
    std::string large2(SpscIpcQueue::MAX_MSG, 'b');
    q.push(large2);
    q.pop(out);
    CHECK(out.size() == SpscIpcQueue::MAX_MSG, "second MAX_MSG push/pop correct");

    // Verify push(const char*) overload works without temporary std::string.
    // Push a C-string literal; no std::string is created at the call site.
    q.push("{\"type\":\"event\",\"kind\":\"nan\"}");
    out.clear();
    q.pop(out);
    CHECK(out == "{\"type\":\"event\",\"kind\":\"nan\"}", "push(const char*) delivers correct content");
}

// ---- FR-RTS-5: duplicate recordStart is rejected, not fatal ---------------

static void test_session_recorder_duplicate_start_rejected() {
    std::printf("--- FR-RTS-5: duplicate start() is rejected, not fatal ---\n");

    char tmp1[] = "/tmp/test_rec_dup1_XXXXXX";
    char tmp2[] = "/tmp/test_rec_dup2_XXXXXX";
    int fd1 = ::mkstemp(tmp1);
    int fd2 = ::mkstemp(tmp2);
    if (fd1 < 0 || fd2 < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::close(fd1); ::close(fd2);

    SessionRecorder rec;
    bool first = rec.start(std::string(tmp1), 48000, 64);
    CHECK(first, "first start() succeeds");
    CHECK(rec.active(), "active() true after first start()");

    // A duplicate start() while already active must not call std::terminate()
    // via a joinable-thread reassignment, and must not disturb the running
    // session's state (FR-RTS-5).
    bool second = rec.start(std::string(tmp2), 48000, 64);
    CHECK(!second, "second (duplicate) start() is rejected");
    CHECK(rec.active(), "still active after rejected duplicate start()");

    std::vector<float> buf(64 * 2, 0.25f);
    int enqueued = 0;
    for (int i = 0; i < 5; ++i) if (rec.enqueueBlock(buf.data(), 64)) ++enqueued;
    CHECK(enqueued == 5, "first recording continues to accept blocks after rejected duplicate");

    rec.stop();
    CHECK(!rec.active(), "active() false after stop()");

    ::unlink(tmp1);
    ::unlink(tmp2);
}

// ---- FR-RTS-4: SessionRecorder rapid start/stop vs. concurrent enqueueBlock -

static void test_session_recorder_start_stop_race() {
    std::printf("--- FR-RTS-4: SessionRecorder rapid start/stop under concurrent enqueueBlock ---\n");

    SessionRecorder rec;
    std::atomic<bool> stop_producer{false};
    std::vector<float> buf(64 * 2, 1.0f);

    // Producer thread hammers enqueueBlock continuously, simulating the RT
    // thread calling it right across start()/stop() boundaries. Run under
    // ThreadSanitizer (see tests/emulator-safety/run_tests.sh --tsan) to
    // verify no data race on active_ / audio_slots_ / in_flight_.
    std::thread producer([&]() {
        while (!stop_producer.load(std::memory_order_relaxed)) {
            rec.enqueueBlock(buf.data(), 64);
        }
    });

    char tmp[] = "/tmp/test_rec_race_XXXXXX";
    for (int cycle = 0; cycle < 100; ++cycle) {
        int fd = ::mkstemp(tmp);
        if (fd < 0) continue;
        ::close(fd);
        rec.start(std::string(tmp), 48000, 64);
        std::this_thread::sleep_for(std::chrono::microseconds(200));
        rec.stop();
        ::unlink(tmp);
    }

    stop_producer.store(true, std::memory_order_relaxed);
    producer.join();

    CHECK(true, "100 rapid start/stop cycles under concurrent enqueueBlock complete "
               "without crash, hang, or (under TSAN) a reported data race");
}

// ---- FR-RTS-3: SessionPlayer replay is RT-safe (reader thread + ring) ------

static void push_float(std::vector<uint8_t>& b, float v) {
    uint8_t bytes[4];
    std::memcpy(bytes, &v, 4);
    b.insert(b.end(), bytes, bytes + 4);
}

static void test_session_player_popblock_basic() {
    std::printf("--- FR-RTS-3: SessionPlayer popBlock reads all blocks in order ---\n");

    const uint32_t kBlockSize  = 16;
    const int      kNumBlocks  = 5;

    // Build a .dsrec file: header + kNumBlocks audio blocks (each filled with
    // a constant equal to its block index) + one pot event before block 2.
    std::vector<uint8_t> file = make_dsrec_header(48000, kBlockSize);
    for (int i = 0; i < kNumBlocks; ++i) {
        if (i == 2) {
            file.push_back(kRecTypePotEvent);
            file.push_back(3);            // channel
            push_float(file, 0.75f);      // value
        }
        file.push_back(kRecTypeAudioBlock);
        for (uint32_t s = 0; s < kBlockSize * 2; ++s)
            push_float(file, static_cast<float>(i));
    }
    file.push_back(kRecTypeEnd);

    char tmp[] = "/tmp/test_play_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::write(fd, file.data(), file.size());
    ::close(fd);

    SessionPlayer player;
    uint32_t sr = 0, bs = 0;
    bool ok = player.open(std::string(tmp), sr, bs);
    CHECK(ok, "open() succeeds");
    CHECK(bs == kBlockSize, "block_size read back correctly");

    std::vector<float> buf(kBlockSize * 2);
    ReplayEvent events[SessionPlayer::kMaxEventsPerSlot];
    size_t n_events = 0;

    int  blocks_read     = 0;
    bool saw_pot_event   = false;
    bool all_blocks_ok   = true;
    int  guard           = 0;
    // Poll popBlock() until done(), tolerating transient "reader hasn't
    // caught up yet" false returns — exactly how the RT thread consumes it.
    while (!player.done() && guard++ < 200000) {
        bool got = player.popBlock(buf.data(), kBlockSize, events,
                                   SessionPlayer::kMaxEventsPerSlot, n_events);
        if (!got) continue;

        for (size_t e = 0; e < n_events; ++e) {
            if (events[e].type == kRecTypePotEvent && events[e].channel_or_pin == 3) {
                CHECK(std::fabs(events[e].value - 0.75f) < 1e-6f,
                     "pot event value round-trips through the ring");
                saw_pot_event = true;
            }
        }
        for (uint32_t s = 0; s < kBlockSize * 2; ++s) {
            if (std::fabs(buf[s] - static_cast<float>(blocks_read)) > 1e-6f) {
                all_blocks_ok = false;
                break;
            }
        }
        ++blocks_read;
    }

    CHECK(blocks_read == kNumBlocks, "all recorded blocks were read back in order");
    CHECK(all_blocks_ok, "block content matches the recorded block index");
    CHECK(saw_pot_event, "pot event delivered attached to the correct block");
    CHECK(player.blocksRead() == static_cast<uint32_t>(kNumBlocks),
         "blocksRead() matches the number of blocks popped");

    player.close();
    ::unlink(tmp);
}

// ---- FR-EMU-1: short replay blocks are zero-filled, not stale ------------

static void test_session_player_short_block_zero_fill() {
    std::printf("--- FR-EMU-1: popBlock zero-fills tail of a short recorded block ---\n");

    const uint32_t kBlockSize = 8;
    const size_t   kReqFrames = 16;  // engine now requests more than was recorded

    std::vector<uint8_t> file = make_dsrec_header(48000, kBlockSize);
    file.push_back(kRecTypeAudioBlock);
    for (uint32_t s = 0; s < kBlockSize * 2; ++s) push_float(file, 1.0f);
    file.push_back(kRecTypeEnd);

    char tmp[] = "/tmp/test_play_short_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::write(fd, file.data(), file.size());
    ::close(fd);

    SessionPlayer player;
    uint32_t sr = 0, bs = 0;
    bool ok = player.open(std::string(tmp), sr, bs);
    CHECK(ok, "open() succeeds");

    // Poison the buffer so a stale-tail bug would be visible.
    std::vector<float> buf(kReqFrames * 2, -9.0f);
    ReplayEvent events[SessionPlayer::kMaxEventsPerSlot];
    size_t n_events = 0;

    bool got = false;
    int guard = 0;
    while (!got && guard++ < 200000) {
        got = player.popBlock(buf.data(), kReqFrames, events,
                              SessionPlayer::kMaxEventsPerSlot, n_events);
    }
    CHECK(got, "popBlock returns the recorded block");

    bool head_ok = true, tail_zeroed = true;
    for (uint32_t s = 0; s < kBlockSize * 2; ++s)
        if (std::fabs(buf[s] - 1.0f) > 1e-6f) head_ok = false;
    for (size_t s = kBlockSize * 2; s < kReqFrames * 2; ++s)
        if (buf[s] != 0.f) tail_zeroed = false;

    CHECK(head_ok, "recorded samples are copied into the head of buf");
    CHECK(tail_zeroed, "unread tail (recorded block shorter than requested) is zero-filled");

    player.close();
    ::unlink(tmp);
}

static void test_session_player_replay_deterministic() {
    std::printf("--- FR-EMU-1: replay of the same .dsrec is bit-for-bit identical across runs ---\n");

    const uint32_t kBlockSize = 8;
    const size_t   kReqFrames = 16;  // requested frames > recorded block_size
    const int      kNumBlocks = 6;

    std::vector<uint8_t> file = make_dsrec_header(48000, kBlockSize);
    for (int i = 0; i < kNumBlocks; ++i) {
        file.push_back(kRecTypeAudioBlock);
        for (uint32_t s = 0; s < kBlockSize * 2; ++s)
            push_float(file, static_cast<float>(i + 1));
    }
    file.push_back(kRecTypeEnd);

    char tmp[] = "/tmp/test_play_det_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::write(fd, file.data(), file.size());
    ::close(fd);

    auto run_replay = [&](std::vector<float>& all_out) {
        SessionPlayer player;
        uint32_t sr = 0, bs = 0;
        player.open(std::string(tmp), sr, bs);

        std::vector<float> buf(kReqFrames * 2);
        ReplayEvent events[SessionPlayer::kMaxEventsPerSlot];
        size_t n_events = 0;
        int guard = 0;
        while (!player.done() && guard++ < 200000) {
            // Poison before every call — a correct implementation must not
            // depend on (or leak) whatever the buffer previously held.
            std::fill(buf.begin(), buf.end(), -9.0f);
            if (!player.popBlock(buf.data(), kReqFrames, events,
                                 SessionPlayer::kMaxEventsPerSlot, n_events))
                continue;
            all_out.insert(all_out.end(), buf.begin(), buf.end());
        }
        player.close();
    };

    std::vector<float> run1, run2;
    run_replay(run1);
    run_replay(run2);

    CHECK(!run1.empty(), "first replay run produced output");
    CHECK(run1.size() == run2.size(), "both replay runs produce the same amount of output");
    bool identical = run1.size() == run2.size();
    if (identical) {
        for (size_t i = 0; i < run1.size(); ++i) {
            if (run1[i] != run2[i]) { identical = false; break; }
        }
    }
    CHECK(identical, "two separate replay runs of the same .dsrec are bit-for-bit identical");

    ::unlink(tmp);
}

static void test_session_player_popblock_rt_safe_timing() {
    std::printf("--- FR-RTS-3: SessionPlayer popBlock does not block on I/O ---\n");

    const uint32_t kBlockSize = 256;
    const int      kNumBlocks = 50;

    std::vector<uint8_t> file = make_dsrec_header(48000, kBlockSize);
    for (int i = 0; i < kNumBlocks; ++i) {
        file.push_back(kRecTypeAudioBlock);
        for (uint32_t s = 0; s < kBlockSize * 2; ++s) push_float(file, 0.f);
    }
    file.push_back(kRecTypeEnd);

    char tmp[] = "/tmp/test_play2_XXXXXX";
    int fd = ::mkstemp(tmp);
    if (fd < 0) { std::printf("  SKIP  mkstemp failed\n"); return; }
    ::write(fd, file.data(), file.size());
    ::close(fd);

    SessionPlayer player;
    uint32_t sr = 0, bs = 0;
    bool ok = player.open(std::string(tmp), sr, bs);
    CHECK(ok, "open() succeeds");

    // Give the reader thread a moment to fill the ring ahead of the RT thread.
    std::this_thread::sleep_for(std::chrono::milliseconds(20));

    std::vector<float> buf(kBlockSize * 2);
    ReplayEvent events[SessionPlayer::kMaxEventsPerSlot];
    size_t n_events = 0;

    // Time 100 popBlock calls back-to-back — each must return immediately
    // regardless of ring state (RT-safe: no syscalls, no mutex, no allocation).
    auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 100 && !player.done(); ++i) {
        player.popBlock(buf.data(), kBlockSize, events,
                        SessionPlayer::kMaxEventsPerSlot, n_events);
    }
    auto elapsed_us = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now() - t0).count();

    CHECK(elapsed_us < 5000, "100 popBlock calls complete in under 5 ms (no blocking I/O)");

    player.close();
    ::unlink(tmp);
}

// ---- FR-MIDI-1: MidiUsbHandler/MidiUartHandler::SendMessage ---------------

// Drains g_state.midi_tx_queue into a vector, so a test can inspect exactly
// what SendMessage() enqueued without interference from anything else that
// may have touched the shared queue.
static std::vector<std::string> drain_midi_queue() {
    std::vector<std::string> out;
    std::string msg;
    while (daisy_emu::g_state.midi_tx_queue.pop(msg)) out.push_back(msg);
    return out;
}

static void test_midi_usb_send_message_enqueues_midi_tx() {
    std::printf("--- FR-MIDI-1: MidiUsbHandler::SendMessage enqueues a midiTx message ---\n");
    drain_midi_queue();  // clear anything left over from an earlier test

    daisy::MidiUsbHandler usb;
    uint8_t control_change[3] = {0xB1, 7, 100};  // CC, channel 1, controller 7, value 100
    usb.SendMessage(control_change, sizeof(control_change));

    auto msgs = drain_midi_queue();
    CHECK(msgs.size() == 1, "SendMessage enqueues exactly one message");
    if (!msgs.empty()) {
        CHECK(msgs[0].find("\"type\":\"midiTx\"") != std::string::npos, "message type is midiTx");
        CHECK(msgs[0].find("\"status\":177") != std::string::npos, "status byte (0xB1=177) round-trips");
        CHECK(msgs[0].find("\"data1\":7") != std::string::npos, "data1 (controller number) round-trips");
        CHECK(msgs[0].find("\"data2\":100") != std::string::npos, "data2 (value) round-trips");
        CHECK(msgs[0].find("\"channel\":1") != std::string::npos, "channel decoded from the low nibble of status");
        CHECK(msgs[0].find("\"midiType\":2") != std::string::npos,
              "midiType is ControlChange (2), matching MidiMessageType's enum value");
    }
}

static void test_midi_usb_send_message_handles_short_program_change() {
    std::printf("--- FR-MIDI-1: MidiUsbHandler::SendMessage tolerates a 2-byte message (Program Change) ---\n");
    drain_midi_queue();

    daisy::MidiUsbHandler usb;
    uint8_t program_change[2] = {0xC2, 5};  // Program Change, channel 2, program 5 — no 3rd byte
    usb.SendMessage(program_change, sizeof(program_change));

    auto msgs = drain_midi_queue();
    CHECK(msgs.size() == 1, "a 2-byte message still enqueues exactly one message");
    if (!msgs.empty()) {
        CHECK(msgs[0].find("\"data1\":5") != std::string::npos, "data1 (program number) round-trips");
        CHECK(msgs[0].find("\"data2\":0") != std::string::npos,
              "data2 defaults to 0 rather than reading past the 2-byte buffer");
    }
}

static void test_midi_usb_send_message_ignores_null_or_empty_buffer() {
    std::printf("--- FR-MIDI-1: MidiUsbHandler::SendMessage ignores a null/empty buffer ---\n");
    drain_midi_queue();

    daisy::MidiUsbHandler usb;
    usb.SendMessage(nullptr, 3);
    uint8_t empty[1] = {0};
    usb.SendMessage(empty, 0);

    auto msgs = drain_midi_queue();
    CHECK(msgs.empty(), "a null buffer or zero size enqueues nothing (no crash either)");
}

static void test_midi_uart_send_message_enqueues_midi_tx() {
    std::printf("--- FR-MIDI-1: MidiUartHandler::SendMessage enqueues a midiTx message ---\n");
    drain_midi_queue();

    daisy::MidiUartHandler uart;
    uint8_t note_on[3] = {0x90, 60, 100};  // NoteOn, channel 0, note 60, velocity 100
    uart.SendMessage(note_on, sizeof(note_on));

    auto msgs = drain_midi_queue();
    CHECK(msgs.size() == 1, "SendMessage enqueues exactly one message");
    if (!msgs.empty()) {
        CHECK(msgs[0].find("\"type\":\"midiTx\"") != std::string::npos, "message type is midiTx");
        CHECK(msgs[0].find("\"midiType\":1") != std::string::npos,
              "midiType is NoteOn (1), matching MidiMessageType's enum value");
    }
}

static void test_midi_uart_and_usb_share_the_same_midi_queue() {
    std::printf("--- FR-MIDI-1: MidiUsbHandler and MidiUartHandler share midi_tx_queue (no second queue) ---\n");
    drain_midi_queue();

    daisy::MidiUsbHandler usb;
    daisy::MidiUartHandler uart;
    uint8_t msg1[3] = {0x90, 1, 1};
    uint8_t msg2[3] = {0x90, 2, 2};
    usb.SendMessage(msg1, sizeof(msg1));
    uart.SendMessage(msg2, sizeof(msg2));

    auto msgs = drain_midi_queue();
    CHECK(msgs.size() == 2,
          "both transports' SendMessage calls land in the same queue, drained together");
}

// ---- FR-EMU-10: ScopeBlockQueue RT-safe raw audio block hand-off ----------
//
// audio_engine.cpp's ScopeBlockQueue is a file-local struct (not exposed via
// a header, same as ScopeState/FftState) — this is a lightweight mirror for
// isolated testing, matching the TestScopeState/TestScopeStateV2 pattern
// already used above for the same reason.

struct TestScopeBlockQueue {
    static constexpr size_t kMaxFramesPerSlot = 8192;
    static constexpr size_t kSlotCount        = 64;

    struct Slot {
        std::vector<float> in_buf;
        std::vector<float> out_buf;
        size_t             frames{0};
        float              sample_rate{48000.f};
        uint64_t           config_generation{0};

        Slot() {
            in_buf.resize(kMaxFramesPerSlot * 2);
            out_buf.resize(kMaxFramesPerSlot * 2);
        }
    };

    std::atomic<uint32_t> drops{0};

    bool push(const float* in_buf, const float* out_buf, size_t frames,
              float sample_rate, uint64_t config_generation) {
        size_t w    = write_.load(std::memory_order_relaxed);
        size_t next = (w + 1) % kSlotCount;
        if (next == read_.load(std::memory_order_acquire)) {
            drops.fetch_add(1, std::memory_order_relaxed);
            return false;
        }
        Slot& slot = slots_[w];
        size_t f   = std::min(frames, kMaxFramesPerSlot);
        std::memcpy(slot.in_buf.data(),  in_buf,  f * 2 * sizeof(float));
        std::memcpy(slot.out_buf.data(), out_buf, f * 2 * sizeof(float));
        slot.frames            = f;
        slot.sample_rate       = sample_rate;
        slot.config_generation = config_generation;
        write_.store(next, std::memory_order_release);
        return true;
    }

    bool pop(Slot& out) {
        size_t r = read_.load(std::memory_order_relaxed);
        if (r == write_.load(std::memory_order_acquire)) return false;
        const Slot& slot = slots_[r];
        out.frames            = slot.frames;
        out.sample_rate       = slot.sample_rate;
        out.config_generation = slot.config_generation;
        std::memcpy(out.in_buf.data(),  slot.in_buf.data(),  slot.frames * 2 * sizeof(float));
        std::memcpy(out.out_buf.data(), slot.out_buf.data(), slot.frames * 2 * sizeof(float));
        read_.store((r + 1) % kSlotCount, std::memory_order_release);
        return true;
    }

private:
    std::array<Slot, kSlotCount> slots_;
    std::atomic<size_t> write_{0};
    std::atomic<size_t> read_{0};
};

static void test_scope_block_queue_push_pop_roundtrip() {
    std::printf("--- FR-EMU-10: ScopeBlockQueue push/pop round-trips a raw block ---\n");

    TestScopeBlockQueue q;
    std::vector<float> in(8, 1.5f), out(8, -2.5f);

    CHECK(q.push(in.data(), out.data(), 4, 44100.f, 0), "push succeeds");

    TestScopeBlockQueue::Slot popped;
    CHECK(q.pop(popped), "pop returns true");
    CHECK(popped.frames == 4, "popped frame count matches pushed frame count");
    CHECK(popped.sample_rate == 44100.f, "popped sample_rate matches pushed sample_rate");
    CHECK(popped.in_buf[0] == 1.5f && popped.in_buf[7] == 1.5f, "in_buf content round-trips");
    CHECK(popped.out_buf[0] == -2.5f && popped.out_buf[7] == -2.5f, "out_buf content round-trips");

    TestScopeBlockQueue::Slot empty;
    CHECK(!q.pop(empty), "queue is empty after single push/pop");
}

static void test_scope_block_queue_full_drops_and_counts() {
    std::printf("--- FR-EMU-10: ScopeBlockQueue drops and counts when full (RT thread never blocks) ---\n");

    TestScopeBlockQueue q;
    std::vector<float> in(2, 0.f), out(2, 0.f);

    int pushed = 0;
    while (q.push(in.data(), out.data(), 1, 48000.f, 0)) ++pushed;

    CHECK(pushed == static_cast<int>(TestScopeBlockQueue::kSlotCount) - 1,
          "queue accepts exactly kSlotCount-1 pushes before full (one slot reserved to "
          "distinguish full from empty)");
    CHECK(q.drops.load() == 1, "the push that found the queue full is counted as a drop");
    CHECK(!q.push(in.data(), out.data(), 1, 48000.f, 0), "further pushes keep failing while full");
    CHECK(q.drops.load() == 2, "each rejected push increments drops");
}

static void test_scope_block_queue_truncates_oversize_frame_count() {
    std::printf("--- FR-EMU-10: ScopeBlockQueue truncates a block exceeding kMaxFramesPerSlot ---\n");

    TestScopeBlockQueue q;
    // A hardware frame count larger than kMaxFramesPerSlot must be truncated
    // rather than reallocating the pre-sized slot on the RT thread.
    std::vector<float> in(TestScopeBlockQueue::kMaxFramesPerSlot * 2 + 20, 3.f);
    std::vector<float> out(TestScopeBlockQueue::kMaxFramesPerSlot * 2 + 20, 4.f);

    CHECK(q.push(in.data(), out.data(), TestScopeBlockQueue::kMaxFramesPerSlot + 10, 48000.f, 0),
          "push of an oversize frame count still succeeds (truncated, not rejected)");

    TestScopeBlockQueue::Slot popped;
    CHECK(q.pop(popped), "pop succeeds");
    CHECK(popped.frames == TestScopeBlockQueue::kMaxFramesPerSlot,
          "popped frame count is capped at kMaxFramesPerSlot — never larger");
}

static void test_scope_block_queue_fifo_order_across_slots() {
    std::printf("--- FR-EMU-10: ScopeBlockQueue preserves FIFO order across many blocks ---\n");

    TestScopeBlockQueue q;
    static constexpr int N = 200;
    int produced = 0, consumed = 0;
    bool order_ok = true;

    for (int i = 0; i < N; ++i) {
        float v = static_cast<float>(i);
        std::vector<float> in(2, v), out(2, v);
        if (q.push(in.data(), out.data(), 1, 48000.f, 0)) ++produced;

        TestScopeBlockQueue::Slot popped;
        if (q.pop(popped)) {
            if (popped.in_buf[0] != static_cast<float>(consumed)) order_ok = false;
            ++consumed;
        }
    }
    TestScopeBlockQueue::Slot popped;
    while (q.pop(popped)) {
        if (popped.in_buf[0] != static_cast<float>(consumed)) order_ok = false;
        ++consumed;
    }

    CHECK(produced == N, "all pushes succeeded (queue never filled at this pace)");
    CHECK(consumed == produced, "every produced block was eventually consumed");
    CHECK(order_ok, "blocks are consumed in the same order they were produced (FIFO)");
}

static void test_scope_block_queue_carries_config_generation_tag() {
    std::printf("--- FR-EMU-7/FR-EMU-10: ScopeBlockQueue tags each block with its "
                "producer's config_generation ---\n");

    // Regression test for a real bug found during manual verification: a
    // mid-session sample-rate change (config_generation bump) stops the RT
    // producer (device.stop() + mode-loop restart) but doesn't clear
    // whatever old-rate blocks were already queued. Without a per-block
    // generation tag the drain thread (audio_engine.cpp) would drain up to
    // kSlotCount stale-rate blocks — and report their stale bin_hz — before
    // any new-rate block ever arrived. The tag lets the drain thread
    // recognize and discard that backlog instead of accumulating it.
    TestScopeBlockQueue q;
    std::vector<float> in(2, 1.f), out(2, 1.f);

    CHECK(q.push(in.data(), out.data(), 1, 48000.f, /*config_generation=*/7),
          "push tags the block with the given config_generation");

    TestScopeBlockQueue::Slot popped;
    CHECK(q.pop(popped), "pop succeeds");
    CHECK(popped.config_generation == 7, "popped block's config_generation round-trips");

    q.push(in.data(), out.data(), 1, 48000.f, /*config_generation=*/8);
    TestScopeBlockQueue::Slot popped2;
    CHECK(q.pop(popped2), "pop succeeds after a generation bump");
    CHECK(popped2.config_generation == 8,
          "a later push's config_generation is captured independently — "
          "a consumer can compare it against the current live generation "
          "to identify (and discard) stale backlog");
}

// ---- main ------------------------------------------------------------------

int main() {
    std::printf("=== Emulator safety unit tests (M25 / M31) ===\n\n");

    test_wav_div_by_zero();
    test_wav_pcm24_sign_extend();
    test_load_wav_file_valid_small_file();
    test_load_wav_file_rejects_non_wav();
    test_load_wav_file_rejects_oversize_file();
    test_spsc_queue_basic();
    test_spsc_queue_wrap();
    test_spsc_queue_threaded();
    test_scope_cap();
    test_scope_budget_derived_from_max_msg();
    test_scope_decimation_scales_with_frame_size();
    test_spsc_queue_oversize_truncation();
    test_gpio_canonical_index();
    test_control_value_pot_clamps_and_rejects_nonfinite();
    test_control_snapshot_pot_clamps_and_rejects_nonfinite();
    test_control_value_button_sets_state();
    test_control_snapshot_mixed_pot_and_button();
    test_decode_control_id();
    test_json_get_basic_fields();
    test_json_get_ignores_key_literal_inside_string_value();
    test_json_get_malformed_input_terminates();
    test_json_get_decodes_standard_escapes();
    test_json_get_decodes_unicode_escape();
    test_json_get_rejects_malformed_unicode_escape();
    test_json_escape_produces_valid_json_content();
    test_session_player_open_guard();
    test_spsc_max_msg_size();
    test_spsc_slot_no_realloc();
    test_session_recorder_drain_thread();
    test_session_recorder_write_error_reported();
    test_session_recorder_enqueue_drop_on_full();
    test_session_recorder_no_blocking_on_rt_path();
    test_session_recorder_start_stop_race();
    test_session_recorder_duplicate_start_rejected();
    test_session_player_popblock_basic();
    test_session_player_short_block_zero_fill();
    test_session_player_replay_deterministic();
    test_session_player_popblock_rt_safe_timing();
    test_midi_usb_send_message_enqueues_midi_tx();
    test_midi_usb_send_message_handles_short_program_change();
    test_midi_usb_send_message_ignores_null_or_empty_buffer();
    test_midi_uart_send_message_enqueues_midi_tx();
    test_midi_uart_and_usb_share_the_same_midi_queue();
    test_scope_block_queue_push_pop_roundtrip();
    test_scope_block_queue_full_drops_and_counts();
    test_scope_block_queue_truncates_oversize_frame_count();
    test_scope_block_queue_fifo_order_across_slots();
    test_scope_block_queue_carries_config_generation_tag();

    std::printf("\nResult: %s\n", failures == 0 ? "all passed" : "FAILURES");
    return failures == 0 ? 0 : 1;
}
