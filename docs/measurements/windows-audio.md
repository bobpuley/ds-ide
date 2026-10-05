# Windows audio measurement gate (M80 / FR-WIN-AUD-7)

**Status:** harness ready · Windows measurements **pending** · conclusion **pending**

The ≈10 ms WASAPI-shared period and ≈15 ms timer figures in `02_assumptions-and-risks.md` are
platform folklore, not measurements of this codebase. This document records measured effective
buffer size, latency, jitter and xruns for each Windows audio path against the macOS baseline,
and concludes whether the RtAudio backend is sufficient or a native WASAPI milestone is needed.

## What is measured

| Column | Meaning |
|---|---|
| backend | the path under test (see below) |
| requested | buffer size asked for (frames at 48 kHz): 64 / 128 / 256 |
| effective | median frames delivered per driver wakeup — callbacks less than 0.5 ms apart are one wakeup, so a coarse device period split into requested-size chunks shows up here |
| reported | `AudioDevice::actualBufferFrames()` (stream-rate frames; FR-WIN-AUD-6) |
| interval ms | mean time between driver wakeups |
| jitter ms | standard deviation of the wakeup interval |
| p99 dev ms | 99th percentile of \|interval − mean\| |
| max ms | longest wakeup interval |
| latency ms | the backend's reported latency (`lastLatencyMs()`; 0 = not reported — CoreAudio output-only reports none) |
| xruns | callbacks slower than their buffer duration (`drainXruns()`; probe: event wait timeouts) |
| driver overruns | driver-reported underflow/overflow (`drainDriverOverruns()`; probe: `GetBuffer` failures) |

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
| backend | requested | effective | reported | interval ms | jitter ms | p99 dev ms | max ms | latency ms | xruns | driver overruns |
|---|---|---|---|---|---|---|---|---|---|---|
| CoreAudio, output | 64 | 192 | 192 | 4.00 | 0.00 | 0.01 | 4.04 | 0.0 | 0 | 0 |
| CoreAudio, output | 128 | 384 | 384 | 8.00 | 0.05 | 0.13 | 8.17 | 0.0 | 0 | 0 |
| CoreAudio, output | 256 | 768 | 768 | 16.00 | 0.05 | 0.12 | 16.11 | 0.0 | 0 | 0 |

### Windows

_Pending — run on the developer's Windows PC (WASAPI only; no ASIO device/SDK available, so ASIO is recorded as
not measured)._

## Conclusion

_Pending the Windows measurements._

> ⚠️ ASSUMPTION: proposed decision rule, to be confirmed when the results are in — RtAudio (WASAPI shared) is
> **sufficient** if, at the smallest request it can honour, it shows no xruns/driver overruns over the run,
> wakeup jitter within ~1 ms, and reported latency within ~2× the native exclusive probe's; otherwise a native
> WASAPI (exclusive-capable) backend milestone is added to the registry through intake.
