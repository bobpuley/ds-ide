#include "ipc_server.h"
#include "emulator_state.h"
#include "daisy/midi_event.h"
#include "session_recorder.h"
#include "session_player.h"
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

namespace daisy_emu {

// Publishes `new_wav` as the active WAV data via an atomic pointer swap and
// safely frees the previously-published WavData (FR-RTS-3). Runs on the IPC
// dispatch thread, never the RT thread, so it is free to block briefly while
// waiting for the audio engine to confirm it has moved off the old pointer
// (wav_data_in_use) before deleting it.
static void retire_wav_data(const WavData* new_wav) {
    const WavData* old = g_state.wav_data_ptr.exchange(new_wav, std::memory_order_acq_rel);
    if (!old) return;

    bool confirmed = false;
    for (int i = 0; i < 200; ++i) {  // up to ~200 ms
        if (g_state.wav_data_in_use.load(std::memory_order_acquire) != old) { confirmed = true; break; }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    if (!confirmed) {
        // Timed out — the engine may not be rendering at all right now (e.g.
        // transport stopped). Clear wav_data_in_use first so a future
        // allocation that happens to reuse this address can't be
        // misidentified as still in flight.
        const WavData* expected = old;
        g_state.wav_data_in_use.compare_exchange_strong(expected, static_cast<const WavData*>(nullptr));
    }
    delete old;
}

// ---- Minimal JSON field extraction ------------------------------------------
// Handles string, number, and one level of nested object values.
// Returns "" when key is absent.
//
// FR-EMU-6: walks the top-level object structurally (tracking key/value
// boundaries) instead of substring-searching for "\"key\":" — the previous
// substring search could match a key literal that happened to appear inside
// an unrelated field's *string value* (e.g. a "path" containing the literal
// text "type":), returning that field's trailing bytes instead of the real
// top-level value, or missing the real key entirely.

// Decodes a \uXXXX escape's 4 hex digits (pos points just past the 'u') into
// a code point and appends its UTF-8 encoding to `out` (FR-QA-EMU-6).
// Advances `pos` past the 4 hex digits and returns true, or leaves `pos`
// unchanged and returns false if fewer than 4 hex digits are present.
// Surrogate pairs (code points beyond the Basic Multilingual Plane) are not
// reconstructed — a lone surrogate is encoded as its raw 3-byte UTF-8 form —
// since IPC payloads on this channel are limited to config/path strings that
// don't need astral-plane characters (a real JSON tokenizer would be an
// architecture change; this is the minimum fix for the reported gap).
static bool decode_u_escape(const std::string& json, size_t& pos, std::string& out, bool matched) {
    if (pos + 4 > json.size()) return false;
    uint32_t code = 0;
    for (size_t i = 0; i < 4; ++i) {
        char c = json[pos + i];
        code <<= 4;
        if (c >= '0' && c <= '9') code |= static_cast<uint32_t>(c - '0');
        else if (c >= 'a' && c <= 'f') code |= static_cast<uint32_t>(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') code |= static_cast<uint32_t>(c - 'A' + 10);
        else return false;
    }
    pos += 4;
    if (!matched) return true;
    if (code <= 0x7F) {
        out += static_cast<char>(code);
    } else if (code <= 0x7FF) {
        out += static_cast<char>(0xC0 | (code >> 6));
        out += static_cast<char>(0x80 | (code & 0x3F));
    } else {
        out += static_cast<char>(0xE0 | (code >> 12));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
    }
    return true;
}

std::string json_get(const std::string& json, const std::string& key) {
    size_t pos = json.find('{');
    if (pos == std::string::npos) return {};
    ++pos;  // just past the opening brace — top-level object depth 1

    while (pos < json.size()) {
        while (pos < json.size() && (json[pos] == ' ' || json[pos] == ',')) ++pos;
        if (pos >= json.size() || json[pos] == '}') break;
        if (json[pos] != '"') break;  // malformed at this depth — stop rather than misparse

        // Parse this entry's key (honoring \" escapes, same as string values below).
        ++pos;
        std::string cur_key;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos + 1 < json.size()) { ++pos; cur_key += json[pos]; }
            else cur_key += json[pos];
            ++pos;
        }
        if (pos >= json.size()) break;  // unterminated key string — malformed
        ++pos;  // skip closing quote

        while (pos < json.size() && json[pos] == ' ') ++pos;
        if (pos >= json.size() || json[pos] != ':') break;
        ++pos;  // skip colon
        while (pos < json.size() && json[pos] == ' ') ++pos;
        if (pos >= json.size()) break;

        const bool matched = (cur_key == key);
        std::string value;

        if (json[pos] == '"') {
            // String value: scan to unescaped closing quote (AC-44: handle \" inside strings).
            // Always advances past escapes, even when this isn't the matched
            // key, so a "type": substring inside a skipped string's content
            // can never be mistaken for the next entry's key (FR-EMU-6).
            ++pos;
            bool terminated = false;
            while (pos < json.size()) {
                char c = json[pos];
                if (c == '\\' && pos + 1 < json.size()) {
                    // FR-QA-EMU-6: translate the standard JSON escape set
                    // instead of dropping the backslash and keeping the
                    // literal character after it.
                    ++pos;  // move to the escape-type character
                    char esc = json[pos];
                    switch (esc) {
                        case '"':  if (matched) value += '"';  ++pos; break;
                        case '\\': if (matched) value += '\\'; ++pos; break;
                        case '/':  if (matched) value += '/';  ++pos; break;
                        case 'n':  if (matched) value += '\n'; ++pos; break;
                        case 't':  if (matched) value += '\t'; ++pos; break;
                        case 'r':  if (matched) value += '\r'; ++pos; break;
                        case 'b':  if (matched) value += '\b'; ++pos; break;
                        case 'f':  if (matched) value += '\f'; ++pos; break;
                        case 'u':
                            ++pos;  // move past 'u' to the first hex digit
                            if (!decode_u_escape(json, pos, value, matched))
                                return {};  // malformed \u escape — reject
                            break;
                        default:
                            // Unrecognized escape — pass the character
                            // through as-is (lenient).
                            if (matched) value += esc;
                            ++pos;
                            break;
                    }
                    continue;
                } else if (c == '"') {
                    ++pos;
                    terminated = true;
                    break;
                } else {
                    if (matched) value += c;
                    ++pos;
                    continue;
                }
            }
            if (!terminated) return {};  // unterminated string — malformed, bail entirely
        } else if (json[pos] == '{') {
            // Object value: scan to matching closing brace.
            // Enforce a nesting-depth limit to reject pathological inputs (AC-44).
            static constexpr size_t MAX_DEPTH = 8;
            size_t depth = 0, start = pos;
            while (pos < json.size()) {
                if (json[pos] == '{') {
                    if (++depth > MAX_DEPTH) return {};  // reject — too deeply nested
                } else if (json[pos] == '}') {
                    if (--depth == 0) { ++pos; break; }
                }
                ++pos;
            }
            if (matched) value = json.substr(start, pos - start);
        } else {
            // Number / bool / null: scan to delimiter
            size_t start = pos;
            while (pos < json.size() && json[pos] != ',' && json[pos] != '}'
                   && json[pos] != ']' && json[pos] != ' ')
                ++pos;
            if (matched) value = json.substr(start, pos - start);
        }

        if (matched) return value;
    }
    return {};
}

// Escapes a string for embedding inside a JSON string literal (FR-EMU-6):
// backslash, double-quote, and control characters. Used for any value that
// isn't already known to be JSON-safe (e.g. exception text) before splicing
// it into outbound event JSON — without this, quote/backslash content
// produces malformed JSON on the wire.
std::string json_escape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char esc[8];
                    std::snprintf(esc, sizeof(esc), "\\u%04x", static_cast<unsigned char>(c));
                    out += esc;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

// Clamps a pot value to [0, 1] into `out` and returns true, or leaves `out`
// untouched and returns false if `v` is NaN/Inf (FR-QA-EMU-5) — matching
// outputVolume's existing clamp behavior, plus rejecting non-finite input
// that a plain `< 0.f` / `> 1.f` comparison would silently let through
// (NaN compares false against both bounds).
static bool clamp_pot_value(float v, float& out) {
    if (!std::isfinite(v)) return false;
    if (v < 0.f) v = 0.f;
    if (v > 1.f) v = 1.f;
    out = v;
    return true;
}

// Parse {"pot0":0.5,"btn3":1} and invoke cb(id, rawValueString) for each
// entry. The caller interprets the id and the value.
static void parse_kv_object(const std::string& obj,
                            void (*cb)(const std::string&, const std::string&)) {
    size_t pos = 0;
    while (pos < obj.size()) {
        auto ks = obj.find('"', pos);
        if (ks == std::string::npos) break;
        auto ke = obj.find('"', ks + 1);
        if (ke == std::string::npos) break;
        std::string key = obj.substr(ks + 1, ke - ks - 1);
        pos = obj.find(':', ke);
        if (pos == std::string::npos) break;
        ++pos;
        while (pos < obj.size() && obj[pos] == ' ') ++pos;
        auto vs = pos;
        while (pos < obj.size() && obj[pos] != ',' && obj[pos] != '}') ++pos;
        std::string val = obj.substr(vs, pos - vs);
        cb(key, val);
        ++pos;
    }
}

// Decodes a controlValue/controlSnapshot id (e.g. "pot3", "btn17", "tgl5",
// "enc5") into a device kind ('P' pot, 'B' button, 'T' toggle, 'E' encoder)
// plus its numeric index, or returns false for an unrecognized prefix,
// non-numeric suffix, or an index outside that kind's valid range
// (FR-DEV-1) — the id-side counterpart to clamp_pot_value's value-side
// rejection. This is the only place a device's identity is recovered from
// the wire; every other handler below is kind-agnostic.
bool decode_control_id(const std::string& id, char& kind, int& index) {
    size_t prefix_len;
    char k;
    int max;
    if (id.rfind("pot", 0) == 0) { prefix_len = 3; k = 'P'; max = 12; }
    else if (id.rfind("btn", 0) == 0) { prefix_len = 3; k = 'B'; max = EmulatorState::kNumGpioPins; }
    else if (id.rfind("tgl", 0) == 0) { prefix_len = 3; k = 'T'; max = EmulatorState::kNumGpioPins; }
    else if (id.rfind("enc", 0) == 0) { prefix_len = 3; k = 'E'; max = EmulatorState::kNumGpioPins; }
    else return false;

    if (id.size() <= prefix_len) return false;
    for (size_t i = prefix_len; i < id.size(); ++i) {
        if (!std::isdigit(static_cast<unsigned char>(id[i]))) return false;
    }
    try {
        int n = std::stoi(id.substr(prefix_len));
        if (n < 0 || n >= max) return false;
        kind = k;
        index = n;
        return true;
    } catch (...) { return false; }
}

// ---- JSON emitters ----------------------------------------------------------

static std::string build_status_json() {
    char buf[256];
    std::snprintf(buf, sizeof(buf),
        "{\"type\":\"status\",\"running\":%s,\"sampleRate\":%.1f,\"blockSize\":%zu}",
        g_state.transport_running.load() ? "true" : "false",
        g_state.sample_rate.load(),
        g_state.block_size.load());
    return buf;
}

// ---- Outbound event helper --------------------------------------------------
// Send a JSON line to the connected client (if any) from the dispatch thread.

static void emit_event(const std::string& msg) {
    std::lock_guard<std::mutex> lk(g_state.send_mutex);
    if (g_state.send_ipc) g_state.send_ipc(msg);
}

// ---- Message dispatch -------------------------------------------------------

void dispatch(const std::string& line) {
    try {
    std::string type = json_get(line, "type");
    if (type.empty()) return;

    if (type == "config") {
        auto sr = json_get(line, "sampleRate");
        auto bs = json_get(line, "blockSize");
        if (!sr.empty()) {
            try {
                float v = std::stof(sr);
                // Range-validate before storage (AC-43)
                if (v < 100.f || v > 384000.f) {
                    emit_event("{\"type\":\"event\",\"kind\":\"config_error\","
                               "\"msg\":\"sampleRate out of range\"}");
                } else {
                    g_state.sample_rate.store(v);
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: sampleRate\n"); }
        }
        if (!bs.empty()) {
            try {
                unsigned long v = std::stoul(bs);
                // Range-validate before storage (AC-43)
                if (v < 1 || v > 65536) {
                    emit_event("{\"type\":\"event\",\"kind\":\"config_error\","
                               "\"msg\":\"blockSize out of range\"}");
                } else {
                    g_state.block_size.store(static_cast<size_t>(v));
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stoul failed: blockSize\n"); }
        }
        // FR-EMU-7: wake the active mode loop so it re-reads sample_rate/
        // block_size instead of running the rest of the session on whatever
        // was captured when run_audio_engine() started (matching the
        // audioDevice handler's existing mode_cv.notify_all() pattern).
        g_state.config_generation.fetch_add(1, std::memory_order_relaxed);
        g_state.mode_cv.notify_all();
    }
    else if (type == "transport") {
        auto action = json_get(line, "action");
        if (action == "start") g_state.transport_running.store(true);
        else if (action == "stop") g_state.transport_running.store(false);
    }
    else if (type == "sine") {
        auto freq = json_get(line, "freq");
        auto amp  = json_get(line, "amplitude");
        if (!freq.empty()) {
            try { g_state.sine_freq.store(std::stof(freq)); }
            catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: sine.freq\n"); }
        }
        if (!amp.empty()) {
            try { g_state.sine_amp.store(std::stof(amp)); }
            catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: sine.amplitude\n"); }
        }
    }
    else if (type == "controlValue") {
        // FR-DEV-1: pot/potSnapshot/button/buttonSnapshot collapse into
        // controlValue/controlSnapshot — device identity now lives in the
        // id field (decode_control_id) rather than in the message type, so
        // adding a device here adds no new message kind.
        auto id  = json_get(line, "id");
        auto val = json_get(line, "value");
        if (!id.empty() && !val.empty()) {
            try {
                char kind; int idx;
                if (decode_control_id(id, kind, idx)) {
                    float raw = std::stof(val);
                    if (kind == 'P') {
                        // FR-QA-EMU-5: clamp to [0,1] and reject NaN/Inf, matching
                        // outputVolume's clamp behavior — a non-finite or wildly
                        // out-of-range pot value must never reach effect code.
                        float v;
                        if (clamp_pot_value(raw, v)) {
                            g_state.pot_values[idx].store(v);
                            // Hold recorder_mutex across active() check + enqueue to close TOCTOU (AC-46).
                            std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
                            if (g_state.recorder.active())
                                g_state.recorder.enqueuePot(static_cast<uint8_t>(idx), v);
                        }
                    } else if (kind == 'B' && std::isfinite(raw)) {
                        bool pr = (raw != 0.f);
                        g_state.button_states[idx].store(pr);
                        // Hold recorder_mutex across active() check + enqueue to close TOCTOU (AC-46).
                        std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
                        if (g_state.recorder.active())
                            g_state.recorder.enqueueButton(static_cast<uint8_t>(idx), pr);
                    } else if (kind == 'T' && std::isfinite(raw)) {
                        // FR-DEV-7: position is an integer 0/1/2; clamp defensively in
                        // case a malformed/out-of-range value reaches the wire.
                        int pos = static_cast<int>(std::lround(raw));
                        if (pos < 0) pos = 0;
                        if (pos > 2) pos = 2;
                        g_state.toggle_states[idx].store(pos);
                    } else if (kind == 'E' && std::isfinite(raw)) {
                        // FR-DEV-9: value is an accumulated position, wrapped defensively
                        // into [0, kEncoderPositionModulus) in case a malformed value
                        // reaches the wire — the shim derives deltas from this, not the
                        // wire, so wrapping here (rather than rejecting) keeps rotation
                        // from ever silently freezing on one bad message.
                        int32_t m = EmulatorState::kEncoderPositionModulus;
                        int32_t pos = static_cast<int32_t>(std::lround(raw)) % m;
                        if (pos < 0) pos += m;
                        g_state.encoder_positions[idx].store(pos);
                    }
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: controlValue\n"); }
        }
    }
    else if (type == "controlSnapshot") {
        auto obj = json_get(line, "values");
        if (!obj.empty()) {
            parse_kv_object(obj, [](const std::string& id, const std::string& v) {
                char kind; int idx;
                if (!decode_control_id(id, kind, idx)) return;
                try {
                    float raw = std::stof(v);
                    if (kind == 'P') {
                        float clamped;
                        if (clamp_pot_value(raw, clamped))
                            g_state.pot_values[idx].store(clamped);
                    } else if (kind == 'B' && std::isfinite(raw)) {
                        g_state.button_states[idx].store(raw != 0.f);
                    } else if (kind == 'T' && std::isfinite(raw)) {
                        int pos = static_cast<int>(std::lround(raw));
                        if (pos < 0) pos = 0;
                        if (pos > 2) pos = 2;
                        g_state.toggle_states[idx].store(pos);
                    }
                } catch (...) {}
            });
        }
    }
    else if (type == "midiEvent") {
        // M47 (FR-DEV-16/17): the first *inbound* peripheral message — a
        // note played on the virtual keyboard or forwarded by the host MIDI
        // bridge (FR-DEV-18), travelling extension -> emulator rather than
        // the other direction every prior message flows. Flat numeric fields
        // (not a byte array): json_get has no array parser, and every other
        // numeric field on this wire (value, freq, amplitude, ...) is
        // already flat.
        auto status_s = json_get(line, "status");
        auto data1_s   = json_get(line, "data1");
        auto data2_s   = json_get(line, "data2");
        if (!status_s.empty() && !data1_s.empty() && !data2_s.empty()) {
            try {
                float status_f = std::stof(status_s);
                float data1_f  = std::stof(data1_s);
                float data2_f  = std::stof(data2_s);
                if (std::isfinite(status_f) && std::isfinite(data1_f) && std::isfinite(data2_f)
                    && status_f >= 0.f && status_f <= 255.f
                    && data1_f  >= 0.f && data1_f  <= 255.f
                    && data2_f  >= 0.f && data2_f  <= 255.f) {
                    auto status = static_cast<uint8_t>(std::lround(status_f));
                    auto data1  = static_cast<uint8_t>(std::lround(data1_f));
                    auto data2  = static_cast<uint8_t>(std::lround(data2_f));

                    daisy::MidiEvent ev{};
                    daisy::parse_midi_event(status, data1, data2, ev);

                    if (!g_state.midi_in_queue.push(ev))
                        g_state.midi_in_drops.fetch_add(1, std::memory_order_relaxed);

                    // Emitted regardless of whether the effect has drained
                    // midi_in_queue yet, so the message monitor (FR-DEV-18)
                    // shows real-time traffic rather than only what's been
                    // popped.
                    char buf[96];
                    std::snprintf(buf, sizeof(buf),
                        "{\"type\":\"midiRx\",\"status\":%u,\"data1\":%u,\"data2\":%u,\"channel\":%u,\"midiType\":%d}",
                        status, data1, data2, ev.channel, static_cast<int>(ev.type));
                    if (!g_state.midi_rx_queue.push(buf))
                        g_state.midi_rx_queue_drops.fetch_add(1, std::memory_order_relaxed);
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: midiEvent\n"); }
        }
    }
    else if (type == "audioMode") {
        auto mode = json_get(line, "mode");
        int new_mode = (mode == "realtime") ? 1 : 0;
        {
            std::lock_guard<std::mutex> lk(g_state.mode_mutex);
            g_state.audio_mode.store(new_mode);
        }
        g_state.mode_cv.notify_all();
    }
    else if (type == "audioDevice") {
        auto sr = json_get(line, "sampleRate");
        auto bs = json_get(line, "bufferSize");
        if (!sr.empty()) {
            try {
                float v = std::stof(sr);
                if (v < 100.f || v > 384000.f)
                    emit_event("{\"type\":\"event\",\"kind\":\"config_error\","
                               "\"msg\":\"sampleRate out of range\"}");
                else
                    g_state.sample_rate.store(v);
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: audioDevice.sampleRate\n"); }
        }
        if (!bs.empty()) {
            try {
                unsigned long v = std::stoul(bs);
                if (v < 1 || v > 65536)
                    emit_event("{\"type\":\"event\",\"kind\":\"config_error\","
                               "\"msg\":\"bufferSize out of range\"}");
                else
                    g_state.rt_buffer_size.store(static_cast<size_t>(v));
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stoul failed: audioDevice.bufferSize\n"); }
        }
        // Notify audio engine of device config change
        {
            std::lock_guard<std::mutex> lk(g_state.mode_mutex);
        }
        g_state.mode_cv.notify_all();
    }
    else if (type == "recordStart") {
        auto path = json_get(line, "path");
        if (!path.empty()) {
            auto sr = static_cast<uint32_t>(g_state.sample_rate.load());
            auto bs = static_cast<uint32_t>(g_state.block_size.load());
            bool ok;
            {
                std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
                ok = g_state.recorder.start(path, sr, bs);
            }
            // A duplicate recordStart while already active is rejected by
            // start() rather than crashing (FR-RTS-5); tell the client so it
            // doesn't believe a second recording started.
            if (!ok) {
                emit_event("{\"type\":\"event\",\"kind\":\"record_error\"}");
            }
        }
    }
    else if (type == "recordStop") {
        uint32_t blocks;
        bool had_error;
        {
            std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
            g_state.recorder.stop();
            blocks     = g_state.recorder.blockCount();
            had_error  = g_state.recorder.hasWriteError();
        }
        // FR-EMU-4: report final status over IPC so the client can tell a
        // clean stop from one that silently truncated (ENOSPC/EIO mid-session).
        char buf[128];
        std::snprintf(buf, sizeof(buf),
            "{\"type\":\"event\",\"kind\":\"record_stopped\",\"blocks\":%u,\"error\":%s}",
            blocks, had_error ? "true" : "false");
        emit_event(buf);
    }
    else if (type == "replayStart") {
        auto path = json_get(line, "path");
        if (!path.empty()) {
            uint32_t sr = 0, bs = 0;
            bool ok;
            {
                std::lock_guard<std::mutex> lk(g_state.player_mutex);
                g_state.player.close();
                ok = g_state.player.open(path, sr, bs);
            }
            if (ok) {
                // FR-EMU-1: the recorded header's sample_rate/block_size may
                // diverge from the engine's current config — tell the client
                // rather than silently replaying at the wrong rate/framing.
                auto cur_sr = static_cast<uint32_t>(g_state.sample_rate.load());
                auto cur_bs = static_cast<uint32_t>(g_state.block_size.load());
                if (sr != cur_sr || bs != cur_bs) {
                    char buf[160];
                    std::snprintf(buf, sizeof(buf),
                        "{\"type\":\"event\",\"kind\":\"replay_rate_mismatch\","
                        "\"recordedSampleRate\":%u,\"recordedBlockSize\":%u,"
                        "\"engineSampleRate\":%u,\"engineBlockSize\":%u}",
                        sr, bs, cur_sr, cur_bs);
                    emit_event(buf);
                }
                // Ensure simulated mode and stop any active transport before replay
                {
                    std::lock_guard<std::mutex> lk(g_state.mode_mutex);
                    g_state.audio_mode.store(0);  // simulated
                }
                g_state.mode_cv.notify_all();
                g_state.replay_active.store(true);
                g_state.transport_running.store(true);
            } else {
                emit_event("{\"type\":\"event\",\"kind\":\"replay_error\"}");
            }
        }
    }
    else if (type == "replayStop") {
        g_state.replay_active.store(false);
        {
            std::lock_guard<std::mutex> lk(g_state.player_mutex);
            g_state.player.close();
        }
    }
    else if (type == "outputVolume") {
        auto vol = json_get(line, "volume");
        if (!vol.empty()) {
            try {
                float v = std::stof(vol);
                if (v < 0.f) v = 0.f;
                if (v > 1.f) v = 1.f;
                g_state.output_volume.store(v);
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stof failed: outputVolume\n"); }
        }
    }
    else if (type == "wavFile") {
        // {path, loop}: a non-empty path loads & activates WAV input; an empty
        // path deactivates it (the simulated loop reverts to the sine generator).
        auto path = json_get(line, "path");
        auto loop = json_get(line, "loop");
        g_state.wav_loop.store(loop == "true");

        if (path.empty()) {
            retire_wav_data(nullptr);
            g_state.wav_active.store(false);
            g_state.wav_generation.fetch_add(1);
        } else {
            auto* wav = new WavData();
            std::string err;
            if (load_wav_file(path, *wav, err)) {
                retire_wav_data(wav);
                g_state.wav_generation.fetch_add(1);
                g_state.wav_active.store(true);
            } else {
                delete wav;
                g_state.wav_active.store(false);
                emit_event("{\"type\":\"event\",\"kind\":\"wav_error\"}");
            }
        }
    }
    } catch (const std::exception& e) {
        emit_event(std::string("{\"type\":\"event\",\"kind\":\"dispatch_error\",\"msg\":\"")
                   + json_escape(e.what()) + "\"}");
    } catch (...) {
        emit_event("{\"type\":\"event\",\"kind\":\"dispatch_error\",\"msg\":\"unknown exception\"}");
    }
}

// ---- Helper: send a line to the active client (must hold send_mutex) --------
// Returns false on send failure (disconnect or EPIPE). AC-45.

static bool send_line(int fd, const std::string& msg) {
    std::string line = msg + '\n';
    ssize_t r = ::send(fd, line.c_str(), line.size(), 0);
    return r > 0;
}

// ---- Server loop ------------------------------------------------------------

void run_ipc_server(const char* socket_path) {
    ::unlink(socket_path);

    int server_fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (server_fd < 0) { std::perror("[daisy-emu] socket"); return; }

    // SO_NOSIGPIPE: prevent SIGPIPE when writing to a disconnected client (macOS)
#ifdef SO_NOSIGPIPE
    int opt = 1;
    ::setsockopt(server_fd, SOL_SOCKET, SO_NOSIGPIPE, &opt, sizeof(opt));
#endif

    // Reject paths that would be silently truncated by strncpy (FR-QA-6).
    if (std::strlen(socket_path) >= sizeof(sockaddr_un::sun_path)) {
        std::fprintf(stderr, "[daisy-emu] socket path too long (max %zu bytes): %s\n",
                     sizeof(sockaddr_un::sun_path) - 1, socket_path);
        ::close(server_fd);
        return;
    }

    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);

    if (::bind(server_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::perror("[daisy-emu] bind");
        ::close(server_fd);
        return;
    }
    ::listen(server_fd, 1);

    std::printf("DAISY_EMU_SOCKET:%s\n", socket_path);
    std::fflush(stdout);

    while (!g_state.shutdown.load()) {
        // Wait up to 100 ms for an incoming connection so we can check shutdown
        struct timeval tv{0, 100000};
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(server_fd, &rfds);
        if (::select(server_fd + 1, &rfds, nullptr, nullptr, &tv) <= 0) continue;

        int client_fd = ::accept(server_fd, nullptr, nullptr);
        if (client_fd < 0) continue;

#ifdef SO_NOSIGPIPE
        int copt = 1;
        ::setsockopt(client_fd, SOL_SOCKET, SO_NOSIGPIPE, &copt, sizeof(copt));
#endif

        // Register the IPC send function for this client.
        // On send failure (EPIPE / disconnect) close the fd (AC-45). send_ipc is
        // cleared below when the read loop exits after the fd is closed.
        auto client_dead = std::make_shared<std::atomic<bool>>(false);
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            g_state.send_ipc = [client_fd, client_dead](std::string msg) {
                if (client_dead->load(std::memory_order_relaxed)) return;
                std::string line = msg + '\n';
                ssize_t r = ::send(client_fd, line.c_str(), line.size(), 0);
                if (r <= 0) {
                    client_dead->store(true, std::memory_order_relaxed);
                }
            };
        }

        // FR-DEV-6: protocol version handshake — always the first line on a
        // new connection, before status or anything else, so the extension
        // can detect a stale emulator/extension pairing before any control
        // message is ever exchanged.
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            char vbuf[64];
            std::snprintf(vbuf, sizeof(vbuf),
                "{\"type\":\"protocolVersion\",\"version\":%d}", kProtocolVersion);
            send_line(client_fd, vbuf);
        }

        // Send initial status so the client knows the runtime is alive
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            send_line(client_fd, build_status_json());
        }

        // Read messages from client until disconnect, or until shutdown AND
        // the audio drain thread has finished flushing pending telemetry
        // (FR-EMU-11) — closing client_fd/nulling send_ipc the instant
        // `shutdown` flips (rather than waiting for telemetry_drained too)
        // raced ahead of and could cut off that flush before it reached the
        // client.
        char raw[4096];
        std::string partial;
        while (!g_state.telemetry_drained.load()) {
            struct timeval tv2{0, 50000};
            fd_set rfds2;
            FD_ZERO(&rfds2);
            FD_SET(client_fd, &rfds2);
            if (::select(client_fd + 1, &rfds2, nullptr, nullptr, &tv2) <= 0) continue;

            ssize_t n = ::recv(client_fd, raw, sizeof(raw) - 1, 0);
            if (n <= 0) break;  // disconnected
            raw[n] = '\0';
            partial.append(raw, static_cast<size_t>(n));

            // Guard against unbounded growth from malformed (no-newline) input (FR-QA-5).
            if (partial.size() > 1024u * 1024u) {
                std::fprintf(stderr, "[daisy-emu] IPC receive buffer exceeded 1 MB — disconnecting client\n");
                break;
            }

            size_t nl;
            while ((nl = partial.find('\n')) != std::string::npos) {
                std::string msg = partial.substr(0, nl);
                partial.erase(0, nl + 1);
                if (!msg.empty()) dispatch(msg);
            }
        }

        // Client disconnected — clear the send function
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            g_state.send_ipc = nullptr;
        }
        ::close(client_fd);
    }

    ::close(server_fd);
    ::unlink(socket_path);
}

}  // namespace daisy_emu
