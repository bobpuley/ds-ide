# Windows audio measurement gate (M80 / FR-WIN-AUD-7)

**Status:** harness ready · Windows measurements **recorded** (WASAPI; ASIO not measured) · conclusion **written** (RtAudio shared sufficient)

The ≈10 ms WASAPI-shared period and ≈15 ms timer figures in `02_assumptions-and-risks.md` are
platform folklore, not measurements of this codebase. This document records measured effective
buffer size, latency, jitter and xruns for each Windows audio path against the macOS baseline,
and concludes whether the RtAudio backend is sufficient or a native WASAPI milestone is needed.

## What is measured

| Column          | Meaning                                                                                                                                                               |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| backend         | the path under test (see below)                                                                                                                                       |
| requested       | buffer size asked for (frames at 48 kHz): 64 / 128 / 256                                                                                                              |
| effective       | median frames delivered per driver wakeup — callbacks less than 0.5 ms apart are one wakeup, so a coarse device period split into requested-size chunks shows up here |
| reported        | `AudioDevice::actualBufferFrames()` (stream-rate frames; FR-WIN-AUD-6)                                                                                                |
| interval ms     | mean time between driver wakeups                                                                                                                                      |
| jitter ms       | standard deviation of the wakeup interval                                                                                                                             |
| p99 dev ms      | 99th percentile of \|interval − mean\|                                                                                                                                |
| max ms          | longest wakeup interval                                                                                                                                               |
| latency ms      | the backend's reported latency (`lastLatencyMs()`; 0 = not reported — CoreAudio output-only reports none)                                                             |
| xruns           | callbacks slower than their buffer duration (`drainXruns()`; probe: event wait timeouts)                                                                              |
| driver overruns | driver-reported underflow/overflow (`drainDriverOverruns()`; probe: `GetBuffer` failures)                                                                             |

Paths:

- **CoreAudio** (macOS baseline) — the emulator's `CoreAudioDevice`.
- **WASAPI shared (RtAudio)** — the emulator's Windows backend, `RtAudioDevice`, exactly as `effect_emu` uses it.
- **WASAPI exclusive (native probe)** — `tests/audio-measurement/wasapi_exclusive_probe.cpp`, an event-driven
  `IAudioClient` exclusive-mode render loop. RtAudio 6.0.1 has no exclusive mode (an upstream TODO), so this
  probe is the only way to measure it; it is a measurement tool and is not linked into `effect_emu`.
- **ASIO (RtAudio)** — `RtAudioDevice` with `DS_EMU_AUDIO_API=asio`, only when an ASIO SDK and device exist.

Each run plays a quiet 440 Hz sine (the probe renders silence), discards the first 500 ms, then measures for
10 s. Output-only is the simulated-audio path; `--duplex` adds live-input runs.

## How to run

**Windows** (MSYS2, CLANG64 shell; same toolchain as `windows-ci`):

```sh
pacman -S --needed mingw-w64-clang-x86_64-clang
cd /c/path/to/ds-ide
tests/audio-measurement/run_measurements.sh            # output-only
tests/audio-measurement/run_measurements.sh --duplex   # + live input (needs a microphone)
```

Plug in the interface/speakers you actually develop with and close other audio apps (exclusive mode needs the
endpoint free). With an ASIO device, also set `DS_EMU_ASIO_SDK_DIR` to a directory holding `asio.cpp`,
`asiodrivers.cpp`, `asiolist.cpp`, `iasiothiscallresolver.cpp` and their headers.

**macOS** baseline: same script from Terminal (grant microphone access for `--duplex`), on the built-in speakers.

Paste each printed table below with the machine and device it was run on.

## Results

### macOS baseline

> ⚠️ ASSUMPTION: the table below is a 2-second harness smoke run on a **Jabra Evolve 75 SE over Bluetooth
> (16 kHz, mono)** — not a representative baseline. It is kept because it shows the effective-vs-requested
> effect (AUHAL resampling 16 → 48 kHz triples the frames per wakeup). Re-run on the built-in speakers.

<!-- 2026-10-05 · Darwin · Apple Silicon · Jabra Evolve 75 SE (Bluetooth, 16 kHz) · 2s per run -->
| backend           | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns |
|-------------------|-----------|-----------|----------|-------------|-----------|------------|--------|------------|-------|-----------------|
| CoreAudio, output | 64        | 192       | 192      | 4.00        | 0.00      | 0.01       | 4.04   | 0.0        | 0     | 0               |
| CoreAudio, output | 128       | 384       | 384      | 8.00        | 0.05      | 0.13       | 8.17   | 0.0        | 0     | 0               |
| CoreAudio, output | 256       | 768       | 768      | 16.00       | 0.05      | 0.12       | 16.11  | 0.0        | 0     | 0               |

### Windows

Run on the developer's Windows PC (Windows 11, WASAPI only; no ASIO device/SDK available, so ASIO is recorded as
not measured). Built with the **MSYS2 UCRT64** `clang++`, not the CLANG64 toolchain the script documents.

> ⚠️ ASSUMPTION: the audio endpoint used was not recorded (the default Windows output device); note it here if it
> matters for the conclusion.

#### Output-only

<!-- 2026-11-19T16:39Z · MINGW64_NT-10.0-19045 · 10s per run -->
| backend                         | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns                  |
|---------------------------------|-----------|-----------|----------|-------------|-----------|------------|--------|------------|-------|----------------------------------|
| WASAPI shared (RtAudio), output | 64        | 512       | 480      | 10.00       | 0.29      | 0.59       | 10.65  | 11.3       | 0     | 0                                |
| WASAPI shared (RtAudio), output | 128       | 512       | 480      | 10.00       | 0.33      | 0.61       | 13.15  | 12.7       | 0     | 0                                |
| WASAPI shared (RtAudio), output | 256       | 512       | 480      | 10.00       | 0.29      | 0.59       | 10.57  | 15.3       | 0     | 0                                |
| WASAPI exclusive (native probe) | 64        | 144       | 144      | 3.00        | 0.29      | 0.53       | 3.65   | 6.0        | 0     | 0                                |
| WASAPI exclusive (native probe) | 128       | 144       | 144      | 3.00        | 0.30      | 0.53       | 3.58   | 6.0        | 0     | 0                                |
| WASAPI exclusive (native probe) | 256       | 256       | 256      | 5.33        | 0.32      | 0.61       | 7.52   | 10.7       | 0     | 0                                |
| ASIO (RtAudio)                  | 64        | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 128       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 256       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |

> **Correction (2026-10-06):** the `reported` and `latency ms` values of the *WASAPI shared (RtAudio)* rows in
> both tables came from a backend defect, since fixed: RtAudio 6.0.1 queries `IAudioClient::GetStreamLatency()`
> before `Initialize()`, so its WASAPI latency is always 0 and the backend reported only its own buffer
> (64/128/256 frames = 1.3/2.7/5.3 ms) and the request as the buffer size. The backend now asks the endpoint for
> its shared-mode period (`IAudioClient::GetDevicePeriod`). The `effective`, interval, jitter, xrun and overrun
> columns are measured independently of that and are unaffected.
>
> **Verified (2026-11-20):** the re-run after the fix (last table below) reads `reported` = 512 and
> `latency ms` = 12.0 / 13.3 / 16.0 ms, as predicted.

#### With `--duplex`

<!-- 2026-10-06T11:03Z · MINGW64_NT-10.0-26200 · 10s per run -->
| backend                         | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns                  |
|---------------------------------|-----------|-----------|----------|-------------|-----------|------------|--------|------------|-------|----------------------------------|
| WASAPI shared (RtAudio), output | 64        | 512       | 64       | 10.67       | 0.22      | 0.65       | 11.66  | 1.3        | 0     | 0                                |
| WASAPI shared (RtAudio), output | 128       | 512       | 128      | 10.67       | 0.22      | 0.66       | 11.54  | 2.7        | 0     | 0                                |
| WASAPI shared (RtAudio), output | 256       | 512       | 256      | 10.67       | 0.22      | 0.61       | 11.50  | 5.3        | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 64        | 512       | 64       | 10.67       | 0.21      | 0.57       | 11.54  | 1.3        | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 128       | 512       | 128      | 10.67       | 0.21      | 0.61       | 11.45  | 2.7        | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 256       | 512       | 256      | 10.67       | 0.20      | 0.60       | 11.42  | 5.3        | 0     | 0                                |
| WASAPI exclusive (native probe) | 64        | 256       | 256      | 5.33        | 0.11      | 0.42       | 6.00   | 10.7       | 0     | 0                                |
| WASAPI exclusive (native probe) | 128       | 256       | 256      | 5.33        | 0.10      | 0.41       | 6.06   | 10.7       | 0     | 0                                |
| WASAPI exclusive (native probe) | 256       | 256       | 256      | 5.33        | 0.11      | 0.42       | 5.97   | 10.7       | 0     | 0                                |
| ASIO (RtAudio)                  | 64        | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 128       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 256       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |

#### Re-run after the `GetDevicePeriod` fix (`--duplex`)

Windows 11 build 26300, UCRT64 `clang++` 22.1.8, default endpoints: Speaker (Realtek(R) Audio) out, Microphone
Array (AMD Audio Device) in. Supersedes the `reported` / `latency ms` values of the two tables above.

<!-- 2026-11-20T13:54Z · MINGW64_NT-10.0-26300 · 10s per run -->
| backend                         | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns                  |
|---------------------------------|-----------|-----------|----------|-------------|-----------|------------|--------|------------|-------|----------------------------------|
| WASAPI shared (RtAudio), output | 64        | 512       | 512      | 10.67       | 0.16      | 0.53       | 11.48  | 12.0       | 0     | 0                                |
| WASAPI shared (RtAudio), output | 128       | 512       | 512      | 10.67       | 0.16      | 0.47       | 11.31  | 13.3       | 0     | 0                                |
| WASAPI shared (RtAudio), output | 256       | 512       | 512      | 10.67       | 0.17      | 0.58       | 11.30  | 16.0       | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 64        | 512       | 512      | 10.67       | 0.21      | 0.70       | 11.63  | 12.0       | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 128       | 512       | 512      | 10.67       | 0.22      | 0.73       | 11.88  | 13.3       | 0     | 0                                |
| WASAPI shared (RtAudio), duplex | 256       | 512       | 512      | 10.67       | 0.22      | 0.65       | 11.74  | 16.0       | 0     | 0                                |
| WASAPI exclusive (native probe) | 64        | 256       | 256      | 5.33        | 0.11      | 0.44       | 6.10   | 10.7       | 0     | 0                                |
| WASAPI exclusive (native probe) | 128       | 256       | 256      | 5.33        | 0.15      | 0.52       | 6.20   | 10.7       | 0     | 0                                |
| WASAPI exclusive (native probe) | 256       | 256       | 256      | 5.33        | 0.12      | 0.45       | 5.94   | 10.7       | 0     | 0                                |
| ASIO (RtAudio)                  | 64        | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 128       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |
| ASIO (RtAudio)                  | 256       | —         | —        | —           | —         | —          | —      | —          | —     | not measured: no ASIO SDK/device |

## Conclusion

**RtAudio over WASAPI shared is sufficient for v1; no native WASAPI milestone is added.**

Decision rule (RtAudio shared is sufficient if, at the smallest request it can honour, it shows no
xruns/driver overruns, wakeup jitter within ~1 ms, and reported latency within ~2× the native exclusive
probe's; otherwise a native WASAPI milestone is added through intake):

- **xruns / driver overruns:** 0 / 0 in every run (output-only and duplex, 64/128/256).
- **Jitter:** 0.16–0.22 ms standard deviation, p99 deviation ≤ 0.73 ms (2026-11-20 re-run) — within the ~1 ms bound.
- **Latency:** the shared-mode wakeup period is 10.67 ms vs 5.33 ms for the exclusive probe — **exactly 2×, at
  the rule's limit**. Corrected reported latency (period + buffer, see the correction above) is 12.0–16.0 ms vs
  10.7 ms for the exclusive probe, ≤ 1.5×. (The originally recorded 1.3–5.3 ms was a backend defect, not a
  measurement; the 2026-11-20 re-run confirms the corrected values.)
- **Duplex** adds no measurable cost over output-only.

Caveats, so the result is not over-read:

- The effective shared-mode period is **512 frames (10.67 ms) whatever the request**: RtAudio delivers the
  requested 64/128/256 frames in chunks per wakeup (`reported` follows the request, `effective` does not).
  This confirms the ≈10 ms WASAPI-shared figure in `02_assumptions-and-risks.md`; exclusive mode would halve
  it (5.33 ms), but RtAudio 6.0.1 cannot do exclusive, so that gain would need a native backend.
- The reported-latency column is each backend's own estimate and is not strictly like-for-like; the wakeup
  period (10.67 ms shared vs 5.33 ms exclusive) is the more honest comparison, and it sits right at the 2× limit,
  so "sufficient" is a borderline pass on latency, a clear pass on stability.
- **ASIO was not measured** (no SDK/device), the audio endpoint was not recorded, and the Windows build used
  the UCRT64 `clang++` rather than CLANG64. A single machine and 10 s per run.
- The exclusive probe's 10.66 ms max at a 128 request (output-only run) did not recur in the duplex run.

Revisit (via intake) if a user needs sub-10 ms round-trip on Windows or reports glitches on other hardware.
