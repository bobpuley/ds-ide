#include "ipc_server.h"
#include "emulator_state.h"
#include "session_recorder.h"
#include "session_player.h"
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>

namespace daisy_emu {

// ---- Minimal JSON field extraction ------------------------------------------
// Handles string, number, and one level of nested object values.
// Returns "" when key is absent.

static std::string json_get(const std::string& json, const std::string& key) {
    std::string needle = "\"" + key + "\":";
    auto pos = json.find(needle);
    if (pos == std::string::npos) return {};
    pos += needle.size();
    while (pos < json.size() && json[pos] == ' ') ++pos;
    if (pos >= json.size()) return {};

    if (json[pos] == '"') {
        // String value: scan to unescaped closing quote (AC-44: handle \" inside strings).
        ++pos;
        std::string result;
        while (pos < json.size()) {
            char c = json[pos];
            if (c == '\\' && pos + 1 < json.size()) {
                ++pos;  // skip escape character
                result += json[pos];
            } else if (c == '"') {
                break;
            } else {
                result += c;
            }
            ++pos;
        }
        return result;
    }
    if (json[pos] == '{') {
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
        return json.substr(start, pos - start);
    }
    // Number / bool / null: scan to delimiter
    auto start = pos;
    while (pos < json.size() && json[pos] != ',' && json[pos] != '}'
           && json[pos] != ']' && json[pos] != ' ')
        ++pos;
    return json.substr(start, pos - start);
}

// Parse {"0":0.5,"1":0.3} (numbers) or {"28":true,...} (bools) and invoke
// cb(key, rawValueString) for each entry. The caller interprets the value.
static void parse_kv_object(const std::string& obj,
                            void (*cb)(int, const std::string&)) {
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
        try { cb(std::stoi(key), val); } catch (...) {}
        ++pos;
    }
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

static void dispatch(const std::string& line) {
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
    else if (type == "pot") {
        auto ch  = json_get(line, "channel");
        auto val = json_get(line, "value");
        if (!ch.empty() && !val.empty()) {
            try {
                int c = std::stoi(ch);
                if (c >= 0 && c < 12) {
                    float v = std::stof(val);
                    g_state.pot_values[c].store(v);
                    // Hold recorder_mutex across active() check + enqueue to close TOCTOU (AC-46).
                    std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
                    if (g_state.recorder.active())
                        g_state.recorder.enqueuePot(static_cast<uint8_t>(c), v);
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stoi/stof failed: pot\n"); }
        }
    }
    else if (type == "potSnapshot") {
        auto obj = json_get(line, "values");
        if (!obj.empty()) {
            parse_kv_object(obj, [](int c, const std::string& v) {
                if (c >= 0 && c < 12) {
                    try { g_state.pot_values[c].store(std::stof(v)); } catch (...) {}
                }
            });
        }
    }
    else if (type == "button") {
        auto pin     = json_get(line, "gpioPin");
        auto pressed = json_get(line, "pressed");
        if (!pin.empty()) {
            try {
                int p = std::stoi(pin);
                if (p >= 0 && p < EmulatorState::kNumGpioPins) {
                    bool pr = (pressed == "true");
                    g_state.button_states[p].store(pr);
                    // Hold recorder_mutex across active() check + enqueue to close TOCTOU (AC-46).
                    std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
                    if (g_state.recorder.active())
                        g_state.recorder.enqueueButton(static_cast<uint8_t>(p), pr);
                }
            } catch (...) { std::fprintf(stderr, "[daisy-emu] stoi failed: button.gpioPin\n"); }
        }
    }
    else if (type == "buttonSnapshot") {
        auto obj = json_get(line, "values");
        if (!obj.empty()) {
            parse_kv_object(obj, [](int p, const std::string& v) {
                if (p >= 0 && p < EmulatorState::kNumGpioPins)
                    g_state.button_states[p].store(v == "true");
            });
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
            std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
            g_state.recorder.start(path, sr, bs);
        }
    }
    else if (type == "recordStop") {
        std::lock_guard<std::mutex> lk(g_state.recorder_mutex);
        g_state.recorder.stop();
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
            {
                std::lock_guard<std::mutex> lk(g_state.wav_mutex);
                g_state.wav_data.reset();
            }
            g_state.wav_active.store(false);
            g_state.wav_generation.fetch_add(1);
        } else {
            auto wav = std::make_shared<WavData>();
            std::string err;
            if (load_wav_file(path, *wav, err)) {
                {
                    std::lock_guard<std::mutex> lk(g_state.wav_mutex);
                    g_state.wav_data = wav;
                }
                g_state.wav_generation.fetch_add(1);
                g_state.wav_active.store(true);
            } else {
                g_state.wav_active.store(false);
                emit_event("{\"type\":\"event\",\"kind\":\"wav_error\"}");
            }
        }
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
                    ::close(client_fd);
                }
            };
        }

        // Send initial status so the client knows the runtime is alive
        {
            std::lock_guard<std::mutex> lk(g_state.send_mutex);
            send_line(client_fd, build_status_json());
        }

        // Read messages from client until disconnect or shutdown
        char raw[4096];
        std::string partial;
        while (!g_state.shutdown.load()) {
            struct timeval tv2{0, 50000};
            fd_set rfds2;
            FD_ZERO(&rfds2);
            FD_SET(client_fd, &rfds2);
            if (::select(client_fd + 1, &rfds2, nullptr, nullptr, &tv2) <= 0) continue;

            ssize_t n = ::recv(client_fd, raw, sizeof(raw) - 1, 0);
            if (n <= 0) break;  // disconnected
            raw[n] = '\0';
            partial.append(raw, static_cast<size_t>(n));

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
