#pragma once
// Statistics for the Windows audio measurement gate (M80 / FR-WIN-AUD-7).
// Pure and header-only: shared by measure_backend.cpp, the WASAPI exclusive
// probe and their unit tests.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace audio_measure {

// One audio callback: when it started (ms, steady clock) and how many frames
// it carried.
struct CallbackSample {
    double   tMs;
    uint32_t frames;
};

struct Stats {
    size_t   callbacks{0};
    // Callbacks closer than kBurstGapMs are one driver wakeup: a backend that
    // splits a coarse device period into requested-size chunks (RtAudio over
    // WASAPI shared) calls back-to-back within one period.
    size_t   wakeups{0};
    uint32_t effectiveBufferFrames{0};  // median frames per wakeup
    double   meanIntervalMs{0};         // mean time between wakeups
    double   jitterMs{0};               // standard deviation of the wakeup interval
    double   p99DeviationMs{0};         // 99th percentile of |interval - mean|
    double   maxIntervalMs{0};
};

constexpr double kBurstGapMs = 0.5;

inline Stats compute_stats(const std::vector<CallbackSample>& samples, uint32_t /*sampleRate*/,
                           double burstGapMs = kBurstGapMs) {
    Stats st;
    st.callbacks = samples.size();
    if (samples.empty()) return st;

    std::vector<double>   starts;
    std::vector<uint32_t> frames;
    for (size_t i = 0; i < samples.size(); ++i) {
        if (i == 0 || samples[i].tMs - samples[i - 1].tMs >= burstGapMs) {
            starts.push_back(samples[i].tMs);
            frames.push_back(samples[i].frames);
        } else {
            frames.back() += samples[i].frames;
        }
    }
    st.wakeups = starts.size();

    std::vector<uint32_t> sorted = frames;
    std::sort(sorted.begin(), sorted.end());
    st.effectiveBufferFrames = sorted[sorted.size() / 2];

    if (starts.size() < 2) return st;
    std::vector<double> intervals;
    for (size_t i = 1; i < starts.size(); ++i) intervals.push_back(starts[i] - starts[i - 1]);
    double sum = 0;
    for (double v : intervals) sum += v;
    st.meanIntervalMs = sum / static_cast<double>(intervals.size());
    double var = 0;
    std::vector<double> dev;
    for (double v : intervals) {
        var += (v - st.meanIntervalMs) * (v - st.meanIntervalMs);
        dev.push_back(std::fabs(v - st.meanIntervalMs));
        st.maxIntervalMs = std::max(st.maxIntervalMs, v);
    }
    st.jitterMs = std::sqrt(var / static_cast<double>(intervals.size()));
    std::sort(dev.begin(), dev.end());
    st.p99DeviationMs = dev[std::min(dev.size() - 1, static_cast<size_t>(dev.size() * 0.99))];
    return st;
}

// What a run was and what the backend reported about it.
struct RunInfo {
    std::string label;               // e.g. "WASAPI shared (RtAudio)"
    uint32_t    requestedFrames;
    uint32_t    sampleRate;
    uint32_t    actualBufferFrames;  // as reported by the backend (0 = unknown)
    float       latencyMs;           // as reported by the backend (0 = unknown)
    uint32_t    xruns;
    uint32_t    driverOverruns;
};

inline const char* table_header() {
    return "| backend | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms "
           "| latency ms | xruns | driver overruns |\n"
           "|---|---|---|---|---|---|---|---|---|---|---|";
}

inline std::string format_row(const RunInfo& info, const Stats& st) {
    char buf[256];
    std::snprintf(buf, sizeof(buf), "| %s | %u | %u | %u | %.2f | %.2f | %.2f | %.2f | %.1f | %u | %u |",
                  info.label.c_str(), info.requestedFrames, st.effectiveBufferFrames,
                  info.actualBufferFrames, st.meanIntervalMs, st.jitterMs, st.p99DeviationMs,
                  st.maxIntervalMs, static_cast<double>(info.latencyMs), info.xruns, info.driverOverruns);
    return buf;
}

}  // namespace audio_measure
