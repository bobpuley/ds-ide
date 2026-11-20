# Multiplatform Plan — macOS + Windows

Survey of what would need to change to make ds-ide (extension + emulator) work on Windows
in addition to macOS. This is a research snapshot, not a committed roadmap — no milestone
exists for this yet (see `docs/05_dev-plan.md`).

> ⚠️ ASSUMPTION: scope is "runs correctly on Windows," not necessarily an identical
> feature set everywhere. The MIDI host bridge (§4) is currently macOS-only by explicit
> past product decision rather than a technical wall — the goal for this plan is to keep
> a uniform, cross-platform approach where feasible; platform-specific edge cases are
> deferred to a future intake rather than decided in this survey.

## 1. Emulator (C++, `emulator/`) — structural changes

These aren't `#ifdef` patches; they require an abstraction layer with a Windows-side
implementation.

| File | Problem | Direction |
|---|---|---|
| `emulator/runtime/core_audio_device.cpp` / `.h` | Real-time audio I/O is CoreAudio/AudioToolbox (`AudioUnit`, `AudioBufferList`, Mach-tick timing) | Introduce a common `AudioDevice` interface; keep native CoreAudio on macOS and add a Windows backend (RtAudio first, native WASAPI only if measurements require it) — see §1.3 |
| `emulator/runtime/ipc_server.cpp` | Extension↔emulator IPC is a Unix domain socket (`AF_UNIX`, `sockaddr_un`, `<sys/socket.h>`, `<sys/un.h>`) | Replace with Windows named pipes or a TCP loopback socket, abstracted identically on the C++ server and the TS client (`src/emulator/manager.ts`) |

### 1.1 Audio backend — verified findings (`core_audio_device.cpp`)

**Mach timing is not a blocker.** `mach_absolute_time()` is used only for xrun detection:
`processBlock` is bracketed by two calls (in `renderCallback` and `renderCallbackOutputOnly`),
and `elapsed_ms > budget_ms` (`frames / sampleRate * 1000`) increments the `xruns` atomic.
It does not drive pacing or the audio clock. `latencyMs` is not measured either: it is fixed
at `budget_ms * 2.0` in the duplex callback. All uses (4 calls + `compute_mach_ns_per_tick()`)
are in this one file and are replaceable with `std::chrono::steady_clock`, independent of
the audio library choice.

**RtAudio/PortAudio would replace the I/O layer, not the timing.** Real migration cost is
the device setup code (~480 lines), specifically:

| CoreAudio usage | Migration note |
|---|---|
| `kAudioDevicePropertyBufferFrameSizeRange` (`query_max_buffer_frames`, FR-RTS-1) | RtAudio takes the buffer size at `openStream` and returns the actual value; max-size query must be rethought. The in-callback buffer growth (`silentInput.assign`, `workOut.resize`) should be removed regardless (allocation on the RT thread). |
| Separate default input/output device queries | RtAudio supports duplex with two devices, but less robustly than AUHAL on some backends; verify. |
| `queriedInputSampleRate()` / `sample_rate_mismatch` event (FR-EMU-3) | RtAudio returns the actual opened rate; event must be reimplemented. |
| `drainRenderErrors()` (`AudioUnitRender` failures) | No equivalent; metric dropped or mapped to `RtAudioStreamStatus` flags. |
| `start()` vs `start_output_only()` (mic permission) | Preserved by not opening an input stream. |
| Manual deinterleave of CoreAudio non-interleaved buffers | Removed; RtAudio supports interleaved streams. |

**Xrun semantics change.** Our xrun = CPU budget overrun (useful DSP metric, backend-
independent). RtAudio's `RTAUDIO_INPUT_OVERFLOW` / `RTAUDIO_OUTPUT_UNDERFLOW` flags are
driver-level and a different set. Keep both as separate metrics or document the distinction.

### 1.2 Latency and time-accuracy risks

> ⚠️ ASSUMPTION: Windows figures below (≈10 ms WASAPI shared period, ≈15 ms default timer
> resolution) are known platform characteristics, not measurements on this codebase. They
> must be confirmed by the measurements listed at the end of this section.

**Introduced by the migration (RtAudio/PortAudio, Windows)**

1. **Effective buffer size.** CoreAudio sets the device buffer directly
   (`kAudioDevicePropertyBufferFrameSize`); RtAudio treats it as a request and may return a
   different value. WASAPI shared mode has a typical minimum period of ~10 ms, so small buffers
   (64/128 frames, closer to real Daisy behaviour) may be unreachable without WASAPI exclusive
   mode or ASIO, which have usage implications.
2. **Reported latency.** `latencyMs` is a fixed `budget_ms * 2.0` estimate, even less
   representative across backends. Prefer RtAudio `getStreamLatency()`.
3. **Variable callback size / rate.** The callback may receive a frame count different from the
   one requested. Today this is handled by growing buffers inside the callback
   (`silentInput.assign`, `workOut.resize`): a heap allocation on the RT thread. Remove it
   before migrating.
4. **Windows scheduler jitter.** Default timer resolution (~15 ms) and no MMCSS priority for
   the audio thread unless the library sets it; verify.
5. **Xrun semantics.** Our xrun only measures `processBlock` CPU time; driver-level underruns
   are reported separately by the library (see §1.1).

**Already present today (platform-sensitive)**

1. **No-device fallback loop** (`audio_engine.cpp` ~652–663): pacing via `sleep_for`,
   compensated for execution time (AC-54, ±5%) but not for sleep jitter. ~1 ms on macOS,
   up to ~15 ms on Windows with default timers. This is the headless/CI path.
2. **`session_player.cpp` / `session_recorder.cpp`**: `sleep_for` of 1 ms and 500 µs; the
   500 µs value is not honoured on Windows.
3. **Recorder file I/O** (`::write`): off the RT thread, but syscall/antivirus cost is higher on
   Windows; watch SPSC queue drops.
4. **IPC over TCP loopback** (if chosen in §1): the RT thread does not send directly
   (`ipc_send` → SPSC queue, `drain_send` with mutex on the drain thread), so audio latency
   is unaffected, but scope/spectrum delivery delay grows if the socket is slower. Set
   `TCP_NODELAY` and bind to `127.0.0.1`.

**Not at risk:** the RT callback is already clean (SPSC queues, no mutex; FFT/JSON on the
non-RT drain thread per FR-EMU-10; atomic WAV pointer per FR-RTS-3). Mach timing only feeds
statistics (§1.1).

**Mitigations / measurements**
- Measure real latency and jitter on Windows with WASAPI shared, exclusive, and ASIO before
  choosing the backend.
- Remove RT-thread allocations in the render callbacks before the migration.
- Use a high-resolution timer on Windows (`timeBeginPeriod(1)` or waitable timer) for the
  no-device loop, or drive it from the audio clock.
- `TCP_NODELAY` + `127.0.0.1` bind for the IPC socket.

### 1.3 Chosen strategy: common interface, per-platform backends (two phases)

Decision: keep the macOS backend on native CoreAudio and give Windows a backend behind the
same interface. Windows starts on RtAudio and is replaced by a native WASAPI backend only if
measurements require it.

**Why this is feasible.** `CoreAudioDevice` already exposes a small surface (`start`,
`start_output_only`, `stop`, `isRunning`, `drainXruns`, `drainRenderErrors`, `lastLatencyMs`,
`queriedInputSampleRate`) and a single interleaved-stereo `ProcessFn`. Extracting an abstract
`AudioDevice` is near-mechanical; `audio_engine.cpp` should only need the type name changed.

Call-site verification: see §1.4 (assumption confirmed, with caveats).

**Phase 1 — interface + RtAudio Windows backend** (estimate: low-medium)
1. Extract abstract `AudioDevice` + factory (`#ifdef` confined to the factory); rename
   `CoreAudioDevice` → macOS implementation. ~0.5 day.
2. Remove RT-thread allocations from the macOS render callbacks (§1.2).
3. Implement the Windows backend on RtAudio (WASAPI API; ASIO as an option), output-only first,
   then duplex.
4. CMake split (CoreAudio on Apple, RtAudio on Windows), Windows CI and tests. ~2–3 days.
5. Replace `mach_absolute_time` with `std::chrono::steady_clock` (§1.1).

**Gate — measure before Phase 2.** On Windows, measure effective buffer size, real latency
(`getStreamLatency()`), jitter, and xruns for WASAPI shared, exclusive, and ASIO, compared
against the macOS baseline. If these meet the needs of effect development, stop here.

**Phase 2 — native WASAPI backend (only if the gate fails)** (estimate: 1–2 weeks)
Replace only the Windows backend; the interface and the rest of the emulator are untouched.
Main costs: COM initialisation per thread, event-driven audio thread with MMCSS ("Pro Audio"),
shared-mode format conversion (sample rate / channels), and duplex as two separate clients with
independent clocks (sync and drift handling that AUHAL hides on macOS). Output-only is roughly
half the effort of duplex; duplex is the main risk.

**Trade-offs.** Native backends give full control of exclusive mode, buffer period, and thread
priority with no external dependency, at the cost of maintaining two real-time implementations
(and a third for Linux later). RtAudio carries that logic already but gives less control.

### 1.4 Call-site verification of the `AudioDevice` extraction

**Confirmed: the class is used through its public header only, from a single place.**
Files referencing `CoreAudioDevice` / `core_audio_device`: `emulator/runtime/audio_engine.cpp`
(sole consumer), `emulator/CMakeLists.txt`, `tests/core-audio-device/` (unit test + runner),
`tests/build-flags/check_compile_flags.py` (file-name list). Nothing in `src/` (TypeScript) or
in other emulator files references it.

`audio_engine.cpp` usage, exhaustive:
- `run_simulated()` (~l.619): `CoreAudioDevice device;` → `start_output_only(sr, hw_buf, cb)` (l.638), `stop()` (l.695).
- `run_realtime()` (~l.724): `CoreAudioDevice device;` → `start(sr, buffer_size, cb)` (l.817),
  `queriedInputSampleRate()` (l.833), `stop()` (l.853); inside the callback: `drainXruns()`
  (l.789), `lastLatencyMs()` (l.797), `drainRenderErrors()` (l.807).
- The device is captured **by reference** in the `processBlock` lambda (it calls `device.drain*`
  from the callback) → the interface must remain non-copyable/non-movable and outlive the
  stream; `stop()` must guarantee the callback has finished before the device is destroyed.

**What the abstraction must preserve (contract, from tests and callers)**
- Non-copyable (`tests/core-audio-device/test_core_audio_device.cpp`, FR-QA-EMU-2);
  never-started device: `isRunning()==false`, `lastLatencyMs()==0`, `drainXruns()==0`;
  repeated `stop()` is a safe no-op.
- Fixed interleaved **stereo** `ProcessFn` regardless of hardware channel count (mono mics are
  duplicated to both channels, inside the backend). A new backend must do the same.
- `start()` failure returns `false` and the engine falls back to simulated mode with a
  `realtime_unavailable` event; `start_output_only()` failure falls back to the silent
  software loop. Both fallbacks already exist and must be kept.

**Findings that change the plan**
1. **Non-Apple stub already exists** (`core_audio_device.cpp` l.531–550: `start*` return
   `false`). On Windows today the emulator would compile and run with *no audio output*
   (silent simulated loop), not fail to build. Useful as an incremental milestone: the
   Windows build can ship before any backend exists, with audio degraded.
2. **A second RT-thread allocation, in `audio_engine.cpp`:** the `run_realtime()`
   `processBlock` lambda calls `in_buf.resize / out_buf.resize / local_*.resize` when
   `frames * 2 > in_buf.size()` (l.~716–723). §1.2 mentioned only the allocations inside
   `core_audio_device.cpp`; both must be removed (pre-size to the backend's reported maximum
   buffer, or clamp and zero-fill the tail). `run_simulated()` has no equivalent resize.
3. **Backend must report a maximum callback size** to size those buffers up front — the
   interface needs something like `maxCallbackFrames()` (CoreAudio today answers this via
   `kAudioDevicePropertyBufferFrameSizeRange`; RtAudio does not expose it directly).
4. **Latency/xrun accounting is done in `run_realtime()`'s callback** (once per
   `ScopeState::SCOPE_BLOCKS`), so the new interface must keep `drainXruns()` /
   `lastLatencyMs()` cheap and RT-safe (atomics), and `lastLatencyMs()` should become a real
   backend value (§1.1/§1.2) — the TS side only displays it.
5. **Buffer policy lives in the engine, not the device:** `run_simulated()` forces
   `hw_buf = max(block_size, 256)` ("12 000 callbacks/s overwhelm the kernel scheduler");
   `rt_buffer_size` defaults to 256 and is user-configurable via the `audioDevice` IPC
   message (valid range 1–65536; `sampleRate` 100–384000). WASAPI shared mode (~10 ms
   period, §1.2) may be unable to honour small values: the backend should return the
   *actual* buffer size, and the engine/UI should surface a mismatch (like
   `sample_rate_mismatch`).
6. **User-facing message is macOS-specific:** `src/webview/scope-webview.ts:912` shows
   "Live input unavailable — check microphone permission". On Windows the likely causes
   differ (privacy settings, exclusive-mode contention, no input device). Text should be
   made platform-neutral or driven by a reason field on the event.
7. **No bundle/entitlement handling found** (no Info.plist, entitlements or codesign in
   `emulator/` or `src/`), so macOS microphone permission is not configured in-repo; nothing
   to port, but also nothing that would let the Windows side ask for/diagnose consent.

**Tests/build that need touching**
- `tests/core-audio-device/` — rename/generalise (it compiles `core_audio_device.cpp` directly
  via a POSIX `run_tests.sh`); keep a backend-agnostic contract test (non-copyable, defaults,
  idempotent `stop`) that every backend must pass; backend-specific tests stay per platform.
- `tests/build-flags/check_compile_flags.py` — hard-coded `RUNTIME_BASENAMES` list must follow
  the file renames/additions.
- `emulator/CMakeLists.txt` — `core_audio_device.cpp` is listed unconditionally in `RUNTIME_SRC`
  (l.69) and the frameworks are linked under `if(APPLE)` (l.150–155): needs per-platform source
  selection + `else()` branch for RtAudio (`find_package`/FetchContent) on Windows. Note the
  current flags (`-O0 -g -Wall -Wno-...`) are GCC/Clang syntax and will not parse under MSVC.
- No unit/integration test currently exercises real-time mode, xruns, latency events or
  `rt_buffer_size` end-to-end in `tests/` (only `tests/runtime/test_config_reload.py` mentions
  them) → there is no regression net for the audio path; add one (e.g. a fake backend
  implementing `AudioDevice` that drives the callback deterministically) before refactoring.
- TS side: `manager.test.ts`, `scope-panel.test.ts`, `narrow.test.ts` pin the `xrun`, `latency`,
  `audioMode`, `audioDevice` message shapes. These shapes should stay unchanged by the
  refactor (protocol-neutral change).

**Net assessment.** Interface extraction itself is confirmed as low risk (single consumer,
small surface). The real extra work found is: (a) removing the second RT allocation in
`audio_engine.cpp`, (b) adding a max-callback-size query to the interface, (c) building a fake
backend for tests because none exists, and (d) MSVC-compatible build flags.

## 2. Emulator (C++) — mechanical changes

| File | Problem |
|---|---|
| `emulator/CMakeLists.txt` | `if(APPLE) find_library(CoreAudio...)` block needs a Windows counterpart linking the chosen audio backend's libraries |
| `emulator/runtime/wav_reader.cpp` | `<unistd.h>`, `<sys/stat.h>` |
| `emulator/runtime/session_player.cpp` | `<unistd.h>` |
| `emulator/runtime/session_recorder.cpp` | `<unistd.h>` |
| `emulator/shim/src/fatfs_host.cpp` | `::mkdir(path, 0755)` — POSIX permission bits don't exist in Windows `_mkdir` |

Files checked with no POSIX dependency found (should be fine once the above is resolved,
but need recompiling/testing on Windows): `emulator/runtime/audio_engine.cpp`,
`emulator/runtime/session_player.h`, `emulator/runtime/emulator_state.h`.

## 3. Extension (TypeScript, `src/`) — process/tooling on Windows

| File | Problem |
|---|---|
| `src/emulator/manager.ts` | Process lifecycle via POSIX signals (`process.kill(pid, 'SIGTERM'/'SIGKILL'/0)`) — signals are only partially emulated on Windows; needs `taskkill`-based termination or an equivalent liveness check, plus a `.exe` executable path |
| `src/hardware/toolchain.ts` | Hardcoded macOS toolchain search paths (`/opt/homebrew/bin/...`, `/usr/local/bin/...`, `/usr/bin/...` for `arm-none-eabi-gcc` and `dfu-util`); detection uses the POSIX `which` command | Needs a Windows search-path list and `where` instead of `which` |
| `src/debug/debug-adapter.ts` | Hardcoded macOS `lldb-dap` paths (Xcode Command Line Tools / Xcode.app locations); resolution uses `xcrun --find` (macOS-only) and `which` | Needs Windows-side `lldb-dap` discovery (LLVM install path or bundled binary) and `where` instead of `which`; also confirm the DAP flow (PID-attach/detach SIGSTOP interception, see comments in file) behaves the same under Windows lldb |

### 3.1 Verified detail (code read-through)

**Emulator lifecycle (`src/emulator/manager.ts`, `emulator/runtime/main.cpp`)**
1. **Stale-process check uses `ps`** (`isEffectEmuProcess`, l.57–61: `ps -p <pid> -o comm=`). `ps` does
   not exist on Windows → check always resolves false → a stale `effect_emu` is never reclaimed
   (silent, no error). Also compares `endsWith('effect_emu')`, which misses `effect_emu.exe`.
   Replacement: `tasklist /FI "PID eq N"` / `wmic`/PowerShell, or a cross-platform approach
   (e.g. the emulator exposes its identity through the IPC handshake / a lock file).
2. **Graceful shutdown depends on SIGTERM** (`main.cpp` l.21–36 installs `SIGTERM`/`SIGINT`
   handlers; comment: this is "the only reliable point a normal IDE stop" flushes state — recorder
   file I/O, thread joins). On Windows `process.kill(pid,'SIGTERM')` is `TerminateProcess`: the
   handler **never runs**, so the recorder/session flush (FR-EMU-8) is skipped. Needs an explicit
   IPC `shutdown` message (graceful) with kill as the fallback, on all platforms.
3. **`std::signal(SIGPIPE, SIG_IGN)`** (`main.cpp` l.34): `SIGPIPE` is not defined on Windows →
   compile error, not just a behaviour difference. `SO_NOSIGPIPE` (ipc_server.cpp l.773–814) is
   already guarded by `#ifdef`. Winsock sends do not raise a signal, so the call can simply be
   `#ifndef _WIN32`.
4. **Executable name/path:** `path.join(buildDir, 'effect_emu')` (l.181) → needs `.exe`; with
   multi-config generators (Visual Studio) the binary lands in `<buildDir>/Debug|Release/`.
5. **cmake `--build ... -- -j<N>`** (l.171): the `-j` after `--` is forwarded to the native build
   tool; fine for Make/Ninja, **invalid for MSBuild/Visual Studio** (`/m` there). Use
   `cmake --build -j N` (CMake ≥ 3.12) or pin the generator (`-G Ninja`).
6. **Compiler assumption.** CMake uses GCC/Clang-style flags (`-O0 -g -Wall ...`), `-fsanitize`
   options, and `CMAKE_CXX_STANDARD 17`; the effect project's `Makefile`-oriented sources and
   DaisySP are compiled by the same CMake. Decision needed: **clang/MinGW-w64 on Windows
   (flags and DWARF debug info keep working) vs MSVC (flags, PDB, sanitizers all differ)**. This
   choice also drives §6 (lldb) and should be made before the CMake work in §2.
7. **IPC announce protocol** (`DAISY_EMU_SOCKET:<path>` on stdout, parsed at l.~230): carries a
   filesystem path today; for TCP loopback it becomes `host:port` (or port + token). The
   TS `IpcClient` (`net.Socket.connect(path)`) switches to `connect(port, host)`; `.sock`
   cleanup in `extension.ts` l.~1161 and `workspaceRuntimeDir` (the ~103-byte `AF_UNIX` path
   limit rationale) become unnecessary. Since only the `net` API changes in TS, this is a small
   edit; the C++ side is the larger one (below).
8. **`ipc_server.cpp` Winsock port** — beyond replacing `AF_UNIX`: `<sys/select.h>`, `<unistd.h>`
   (`close`, `unlink`) → `<winsock2.h>`, `closesocket`; `WSAStartup`/`WSACleanup`; `recv`/`send`
   types (`ssize_t`); `select()` is usable (Winsock ignores `nfds`). `session_recorder.cpp` /
   `session_player.cpp` additionally include `<fcntl.h>` (POSIX `open`/`O_*` flags, not just
   `<unistd.h>` as §2 listed) → `_open`/`std::fstream`; `wav_reader.cpp` `<sys/stat.h>` → `std::filesystem`.

**Hardware build / flash**
9. **`hardware-build.ts` l.150: PATH is extended with a hard-coded `:` separator**
   (`${binDir}:${existingPath}`) → breaks on Windows (`;`). Use `path.delimiter`. Same file
   spawns plain `make` (l.162): not available on a stock Windows install (needs MSYS2/MinGW
   `make`, or the xPack build tools); the project `Makefile` itself (libDaisy/ARM) must also
   be proven to run there — not verified.
10. **`toolchain.ts`:** besides `which`/hard-coded paths, the configured-path logic builds
    `…/arm-none-eabi-gcc` with a forward slash and a `/$` strip (→ `path.join`), and looks for
    `arm-none-eabi-gcc` without `.exe`. Windows candidates to add: Arm GNU Toolchain default
    install (`C:\Program Files (x86)\Arm GNU Toolchain …\bin`), xPack, MSYS2; use `where.exe`.
    Install hints mention Homebrew only.
11. **`dfu-util` on Windows needs a WinUSB driver** bound to the STM32 DFU device (typically via
    Zadig); this is an external, user-side step with no equivalent on macOS. `board-detect.ts`
    (`dfu-util -l`, USB id `0483:df11`) and `dfu-flash.ts` (`-a 0 -s <addr> -D`) are otherwise
    portable. The special-cased exit code 74 (dfu-util 0.9–0.11, "device disconnects after
    download") is documented for Homebrew/Debian builds; Windows builds' behaviour is unverified.
    A "driver missing" diagnostic should be added to the install hint.

**Debug adapter (`src/debug/debug-adapter.ts`)**
12. **`MuteOnBreakpointTracker` is portable** — it only reacts to DAP `stopped` / `continued` /
    `exited` / `terminated` events and switches the audio clock; no platform dependence.
13. **The `isSpuriousDetachSigstop` filter becomes a no-op, not a bug** — Windows has no
    `SIGSTOP`; the regex simply never matches. The real question is whether Windows lldb emits a
    comparable spurious stop on attach (unknown, see §6).
14. **Discovery code is macOS/Linux only**: `xcrun --find`, Xcode paths, `which`; the failure
    message ("Install Xcode Command Line Tools: xcode-select --install") is macOS-specific.
    There is already a Linux branch (`lldb-dap-14…20` version-suffixed names), so a
    per-platform resolver table is the natural extension.
15. **Attach flow is by PID** (`run-config-provider.ts` l.88–92, `request: 'attach', pid`), after
    the extension spawns `effect_emu` itself. No Windows-specific concern in the provider.
16. **Wider `child_process` audit:** all spawning is via `execFile`/`spawn` without a shell
    (good — no quoting issues on `cmd.exe`). Only `manager.ts`, `toolchain.ts`,
    `debug-adapter.ts`, `board-detect.ts`, `dfu-flash.ts`, `hardware-build.ts` and `line-buffer.ts`
    use `child_process`. On Windows, `spawn` of `.cmd`/`.bat` shims (e.g. an npm-installed tool)
    requires `shell:true` or the explicit `.cmd` — not currently an issue since all targets are `.exe`.

## 4. MIDI host bridge (`src/midi/host-bridge.ts`)

Currently hard-gated to `process.platform === 'darwin'`:

```ts
if (this.platform !== 'darwin') return;
```

On any other platform the bridge no-ops and the user falls back to the on-screen MIDI
keyboard (which already works everywhere).

**Origin of the gate** — this was a deliberate scope decision, not a technical wall:

- v14 (M47/FR-DEV-18, `docs/v14/02_assumptions-and-risks.md`, archived): *"Host MIDI
  bridging is viable on macOS via CoreMIDI, and a virtual on-screen keyboard is an
  acceptable fallback everywhere else. Consistent with the project's macOS-first test
  priority; Linux/Windows MIDI bridging is an accepted pragmatic gap for v14."*
- v16 (M51/FR-DEV-19, `docs/v16/02_assumptions-and-risks.md`, archived) surfaced a second,
  independent problem: the `midi` package's native addon uses NAN bindings, which are
  **not ABI-stable across Node.js versions** — a VS Code update that bumps its bundled
  Electron/Node `NODE_MODULE_VERSION` silently breaks the addon until rebuilt, even with
  no extension update at all. The existing `try/catch` degrades this to a console warning
  rather than a crash, but the bridge stays unavailable until rebuilt.
- The packaged `.vsix` also only ships the `.node` binary prebuilt for whatever
  platform/arch ran `npm install` (today: macOS/Apple Silicon) — installing on a different
  OS/arch fails to load it. Multi-arch prebuilt-binary distribution was flagged in v14 as
  unaddressed.

**Goal for a Windows port: keep a uniform approach where possible.** `midi`/RtMidi
already supports CoreMIDI (macOS), ALSA (Linux) and WinMM/WinRT (Windows) — the platform
gate in `host-bridge.ts` is scope, not a library limitation. The default direction is to
lift the `darwin`-only check and treat host MIDI bridging as a first-class cross-platform
feature rather than adding a second, Windows-specific code path.

What that uniform approach requires, at minimum:
- Removing/generalizing the `platform !== 'darwin'` gate.
- Resolving multi-arch native-binary distribution (prebuilt binaries for both platforms
  in the packaged `.vsix`, or fetching the right one at install/activation time) — this
  is the same unresolved gap called out in v14, now blocking, not just macOS-specific.
- Deciding how the NODE_MODULE_VERSION/ABI fragility (v16) is handled across *all*
  platforms, not just documented as a macOS-only known limitation.

**Deferred to intake:** platform-specific edge cases (e.g. differences between WinMM and
WinRT MIDI backends, ALSA-specific quirks if Linux is ever in scope, per-platform device
enumeration/permission prompts) are not resolved here — they'll be worked through when
this is formally scoped as an intake item, not decided upfront in this survey.

### 4.1 Verified detail (code read-through)

1. **The gate is in three places, not one.** (a) `host-bridge.ts` `start()`:
   `if (this.platform !== 'darwin') return;`; (b) `scripts/rebuild-midi-native.sh` exits early
   when `uname -s` is not `Darwin`; (c) the `package.json` `postinstall`/`package` scripts call
   that script (`|| true` on install). Lifting only (a) leaves the addon unbuilt for Windows.
2. **The script itself is Bash** (`#!/usr/bin/env bash`, `uname`, `BASH_SOURCE`, `npx`) and is
   invoked as `bash scripts/rebuild-midi-native.sh` from npm scripts → not runnable from a plain
   Windows `cmd`/PowerShell shell without Git-Bash/WSL. Port to a Node script (also lets it
   branch on platform/arch).
3. **Packaging is a single-binary design.** `.vscodeignore` carves in exactly
   `node_modules/midi/build/Release/midi.node` — one prebuilt binary, for whatever machine ran
   `npm install`/`package`. A cross-platform VSIX therefore needs either (i) **platform-specific
   VSIX builds** (`vsce package --target win32-x64 darwin-arm64 …`, each built on/for its
   target, and the Marketplace serves the right one), or (ii) bundling several binaries and
   selecting by `process.platform-arch` at load. Option (i) matches the emulator packaging in
   §1 (the emulator also needs a per-platform `effect_emu` or a build-on-install path); the two
   should be decided together (decisions and toolchain options: §4.2). Today the emulator is **built on the user's machine** from shipped
   sources (`emulator/**` packaged, FR-PKG-1), which needs CMake + a C++ toolchain on the user's
   Windows machine — a substantial new prerequisite compared with macOS (Xcode CLT) and a real
   point for the plan (see §6).
4. **ABI anchor:** the Electron target is a hand-maintained
   `scripts/electron-target-version.txt`; the same file would apply to every platform's rebuild,
   so the maintenance burden is not multiplied, but the CI/build matrix is (one rebuild per OS/arch).
5. **Alternative to evaluate at intake:** a N-API (ABI-stable) MIDI binding or a Web MIDI path
   would remove the Electron-ABI fragility on all platforms at once — noted, not investigated.
6. **Engine requirement `vscode ^1.85.0`** and no `os`/`cpu` restrictions or
   `extensionKind` in `package.json` — nothing blocks installation on Windows today.

### 4.2 Decisions taken and Windows toolchain distribution options

**Decisions recorded (user, this survey):**
- Windows compiler: **clang/MinGW** (DWARF debug info; keeps GCC/Clang-style flags and
  sanitizer options; resolves §6 item 2 as a non-issue pending lldb verification).
- Packaging: **platform-specific VSIX** (`vsce package --target …`).
- `lldb-dap`: **ship it rather than rely on PATH discovery** (§6 item 1). With Option C below
  it arrives with the managed toolchain download, not inside the VSIX.
- Windows toolchain delivery: **Option C — download on first use** (decided; details below).

**Correction to earlier wording — "prebuilt binaries" cannot cover `effect_emu`.** The CMake
target `effect_emu` compiles the emulator runtime/shim *together with the user's effect source*
(`-DEFFECT_SRC`), so the final executable only exists after a build on the user's machine.
Only the runtime/shim could be shipped precompiled (static library); the effect must still be
compiled and linked locally. Hence **every Windows user needs a clang/MinGW toolchain + CMake +
Ninja available**, and the real question is how they get it:

| Option | Description | VSIX size (Windows) | Pros | Cons |
|---|---|---|---|---|
| **A. Bundled** | VSIX ships llvm-mingw (x86_64 only), CMake, Ninja, and `lldb-dap` | **~130–200 MB** (revised, see §4.2 download-source check) | Zero setup; works offline; `lldb-dap` comes with the toolchain | Large VSIX; every extension update re-downloads it; possible Marketplace size limit (unverified); LLVM/MinGW-w64 licence obligations (unverified) |
| **B. User-installed** | User installs toolchain; extension detects it (as for `arm-none-eabi-gcc`) | ~1–2 MB | Small VSIX; no redistribution concerns | Worst first-run experience; version drift; more support burden |
| **C. Download on first use** | Small VSIX; on first Windows activation/build, download a pinned toolchain archive from an official source, verify its hash, extract into the extension's global storage | ~1–2 MB | Option-A experience without VSIX weight; toolchain updates independent of extension releases; pinned version is reproducible | Needs network on first run; download/verify/extract + progress + failure/retry UI to build; extraction path/AV/antivirus interaction on Windows; must handle offline and proxy cases; one stored copy per toolchain version (disk use) |

Size sources/assumptions: **llvm-mingw 20260922 ucrt x86_64 zip = 190.7 MB (measured)**; the
2023 figure of ≈129 MB quoted earlier is outdated. Trimmed to the x86_64 target (dropping
i686/aarch64/armv7 sysroots, ≈39 MB zip) ≈ 150 MB (estimate), maybe ~130 MB if the 45 MB
`python/` tree can be dropped (risky: liblldb needs `libpython3`); CMake ≈ 15–40 MB (estimate,
not found); Ninja ≈ 0.3 MB; current macOS VSIX 0.17.7 = 1.03 MB (measured).

> ⚠️ ASSUMPTION: the VS Code Marketplace per-VSIX size limit, the exact licence obligations for
> redistributing LLVM/MinGW-w64, and whether llvm-mingw's `lldb-dap` reads MinGW DWARF
> correctly are all unverified. Verify before choosing A.

**Decision: Option C — download on first use.** The VSIX stays small (~1–2 MB); on first
Windows activation/build the extension downloads a pinned toolchain archive, verifies its
hash, and extracts it into the extension's global storage.

Implications to design at intake (none implemented or verified yet):
- **Pinned manifest:** a version + URL + SHA-256 per archive (llvm-mingw, CMake, Ninja), kept in
  the repo and bumped deliberately; the download is refused on hash mismatch.
- **Official sources only**, over HTTPS; no execution of anything before verification.
- **Storage:** `context.globalStorageUri`, one directory per toolchain version; old versions
  cleaned up after a successful switch. Extract to a temp directory and rename atomically so a
  partial download/extraction is never mistaken for a valid install.
- **Discovery order for the toolchain lookup** (shared with `toolchain.ts` /
  `debug-adapter.ts`): user-configured path → toolchain already on PATH (this is the
  "Option B" case, kept as an override) → the managed download → prompt to download.
  `lldb-dap` is resolved from the same managed toolchain.
- **UX:** explicit consent prompt with the download size, progress notification with cancel
  (reuse the existing `CancellationToken` pattern, FR-EXT-16), retry, and a clear offline /
  proxy failure message; manual "install toolchain from local archive" fallback for
  air-gapped machines.
- **Platform scope:** Windows only; macOS keeps the Xcode CLT/Homebrew flow unchanged.
- **Download/disk cost is large:** ≈130–190 MB to download and ≈450–750 MB extracted (llvm-mingw
  alone). Consider trimming unused target sysroots after extraction, downloading only what is
  needed, a progress UI that handles several hundred MB, and a free-disk-space check before
  extracting. Extraction of ~9,300 small files on Windows is slow with antivirus scanning.
- **Concerns to resolve:** antivirus/SmartScreen behaviour on freshly extracted executables;
  long-path limits for the extraction directory; disk use from multiple versions; behaviour when
  the download source is unavailable (no mirror policy decided).

**Download-source check (web search, not tested by downloading anything):**

| Component | Source | Finding |
|---|---|---|
| llvm-mingw | GitHub Releases of `mstorsjo/llvm-mingw` | **Confirmed:** native Windows toolchains are published as `llvm-mingw-<date>-ucrt-x86_64.zip` (latest seen in results: `20251104`, LLVM 21.1.5). No hash file seen in the results. |
| CMake | GitHub Releases of `Kitware/CMake` / cmake.org | **Confirmed:** `cmake-<ver>-windows-x86_64.zip` is published alongside a `cmake-<ver>-SHA-256.txt`. |
| Ninja | GitHub Releases of `ninja-build/ninja` | **Confirmed:** `https://github.com/ninja-build/ninja/releases/download/<tag>/ninja-win.zip`. Published hash file not confirmed. |

- All three are versioned release assets under stable, tag-based URLs, which suits a pinned
  manifest. Since the manifest pins our *own* SHA-256 (computed when a version is adopted),
  an upstream-published hash is a cross-check, not a requirement.
- **Confirmed (by listing the zip's central directory over HTTP range requests, no full
  download):** `llvm-mingw-20260922-ucrt-x86_64.zip` contains `bin/lldb-dap.exe` (0.75 MB), plus
  `liblldb.dll` (17 MB), `lldb.exe`, `lldb-server.exe`, `lld`/`clang` and `libpython3*.dll`.
  So a separate `lldb-dap` source is **not** needed for this release. Still unverified: that this
  `lldb-dap` runs and reads MinGW DWARF correctly (needs execution on Windows), and that
  `liblldb.dll` loads without a separate Python install (it ships `libpython3.14.dll` and a
  `python/` directory, but this was not exercised).
- **Size correction:** the current release asset is **190.7 MB** (`20260922`), not ~129 MB
  (that was the 2023 release). Contents (zip / uncompressed): `bin` 78 / 203 MB, `lib` 27 / 106 MB,
  `include` 13 / 109 MB, `python` 16 / 45 MB, and four target sysroots —
  `aarch64` 16 / 89 MB, `i686` 14 / 70 MB, `x86_64` 13 / 70 MB, `armv7` 10 / 55 MB. Total
  188 MB zip, **~750 MB extracted**.
- **Not checked:** long-term retention of old release assets (GitHub releases can be
  deleted by maintainers) — consider mirroring pinned archives (e.g. a ds-ide release asset)
  as a fallback source.

> ⚠️ ASSUMPTION (remaining): the shipped `lldb-dap.exe` runs standalone and reads MinGW DWARF
> correctly; upstream asset naming/retention stays stable. The licence
> question for downloading directly from upstream is low-risk but not reviewed.

Option B (detect user-installed toolchain + clear install hint) is retained as the override
path above and as the natural **first implementation step**; C is then layered on.

## 5. Areas checked and found clean
- No other `process.platform`/`darwin`/`win32` branches in `src/` outside `host-bridge.ts`.
- No hardcoded `/`-only path construction found elsewhere in `src/` (VS Code's `Uri.joinPath`/`fsPath` is used consistently).
- `src/commands/create-effect-project.ts` and `src/debug/run-config-provider.ts` reference `cmake` only in generated template text / comments — no platform-specific invocation logic there.
- `src/wiring/controls-writer.ts`, `src/diagnostics/non-portable.ts`, `src/diagnostics/memory-region-diagnostics.ts`, `src/ipc/control-values.ts`, `src/controllers/controls-convention-parser.ts`, `src/devices/codegen/midi-usb.ts`, `src/devices/codegen/oled.ts` — matched an initial grep for "exec(" but are all regex `.exec()` calls, not `child_process` usage. Not relevant here.

## 6. Open questions

**Resolved by read-through (see §3.1)**
- *Build integration quoting/paths:* no shell is ever used (`execFile`/`spawn` with argument
  arrays), so there is no `cmd.exe` quoting problem. Real issues found instead: `-j` after `--`
  (MSBuild), the `.exe`/multi-config output path, the hard-coded `:` PATH separator in
  `hardware-build.ts`, and `ps`/SIGTERM semantics in `manager.ts`.

**Still open — need a Windows machine or external confirmation (not verifiable from this repo)**
1. **Does the Windows LLVM distribution ship `lldb-dap`, and which one?** (Decision: `lldb-dap` comes from the managed toolchain download (§4.2) — still to confirm that the pinned llvm-mingw release includes it.) Official LLVM Windows
   installers, MSYS2 (`mingw-w64-*-lldb`), and the VS-bundled LLVM differ in whether `lldb-dap.exe`
   is present. Needed to decide: discover-on-PATH vs bundle a binary with the VSIX.
2. **PDB vs DWARF** — largely resolved by choosing clang/MinGW (DWARF); remaining check: lldb-dap reads MinGW DWARF correctly.
   (Original concern: MSVC emits PDB, which lldb reads only with the Windows-specific
   (DIA/native PDB) support; clang/MinGW emits DWARF. Debugging quality depends on the compiler
   decision in §3.1 item 6 — breakpoints and variables in effect code are the product's core value.)
3. **Does lldb on Windows produce a spurious stop on PID attach/detach** comparable to macOS's
   SIGSTOP (FR-UX-7)? If it emits something different, `isSpuriousDetachSigstop` needs a
   Windows variant; if nothing, the filter is harmlessly inert.
4. **Does the audio thread behave under a Windows debugger** (mute-on-breakpoint switches to the
   simulated clock, which relies on the `sleep_for` loop whose accuracy is a known Windows weak
   point, §1.2)?
5. **Does the ARM `Makefile` build (libDaisy + project) work with the Windows toolchain and
   `make`?** Not in the emulator scope but needed for "Build & Flash" parity.
   **Answered 2026-11-18 (M81, Windows 10 x64):** yes, with no change to the `Makefile`. DaisyExamples
   (libDaisy + DaisySP, unmodified) built with xPack `arm-none-eabi-gcc` 15.2.1 and MSYS2
   `make` 4.4.1 (`C:\msys64\usr\bin`, a Cygwin build): `make` in `libDaisy` (about 50 s, `-j8`),
   `make` in `DaisySP`, then plain `make` in `seed/Blink` produced `Blink.elf` / `Blink.bin`
   (68 796 B) and the `Memory region` table the extension parses. The environment was the one
   `buildEnv()` builds (compiler directory, then make's directory, in front of the system `PATH`);
   both tools were found by the extension's own lookup (xPack and MSYS2 known locations).
   MSYS2 has no `arm-none-eabi-gcc` package, so the Windows install hint names the Arm GNU
   Toolchain installer and xPack instead. Not exercised: the Arm GNU Toolchain installer location
   (found only by listing a versioned directory).
6. **dfu-util Windows exit code / WinUSB behaviour** (§3.1 item 11).
   **Partly handled in M81, still unverified:** when the board enumerates without a WinUSB driver
   the extension now says so and points to Zadig (detection and flash). That relies on dfu-util's
   `Cannot open DFU device <id>` line, which is dfu-util's own wording but has not been captured
   on a Windows machine, and the exit-code-74 `:leave` special case is unchanged and unverified
   on Windows. Both need a Windows `dfu-util` and a Daisy Seed (M84).
7. **Toolchain delivery on Windows** — `effect_emu` cannot be prebuilt (it embeds the user's
   effect), so a clang/MinGW + CMake + Ninja toolchain is always required on the user's
   machine. Decision: download-on-first-use (Option C), see §4.2.
8. **Extension host on Windows:** whether any reliance on POSIX path semantics exists in the
   TypeScript unit tests (they stub `fs`/`child_process`, so passing on macOS does not imply
   passing on Windows) — worth running the vitest suite on a Windows CI runner early; cheap and
   independent of every other item.
9. **`effect_emu.exe` needs the MinGW runtime DLLs at run time** (found in the M81 manual test,
   2026-11-18): it imports `libc++.dll` and `libwinpthread-1.dll`; started without
   `C:\msys64\clang64\bin` on `PATH` it exits at once with `0xC0000135` (DLL not found), and with it
   on `PATH` it starts and announces its TCP port. Harmless while the user's own MSYS2/LLVM is on the
   system `PATH`, but a managed toolchain (M82) would have to add its `bin` directory to the
   emulator's environment or link the runtime statically (`-static`). To settle in M82.

**Verification results (M84, 2026-11-20; evidence in `docs/measurements/windows-verification.md`)**
- Items 1–4, 7, 9: **closed.** `lldb-dap` is available (pinned llvm-mingw manifest; MSYS2 CLANG64's binary run standalone with a reduced PATH, no separate Python); MinGW DWARF breakpoints and variables work; no spurious stop on attach/detach was observed; mute-on-breakpoint works under the debugger; the managed toolchain download passed on a fresh profile and `effect_emu.exe` runs.
- Item 6 (`dfu-util` exit code / WinUSB): **deferred** — needs a Daisy Seed and a Windows `dfu-util` run, none available during M84. The M81 handling stays unverified on hardware.
- Host MIDI bridge with a physical controller, and ASIO measurements: **deferred** (no controller; no ASIO SDK/device). The `midi` addon load is covered by the `package` workflow.

## Suggested priority order

Revised after the call-site, toolchain and MIDI verification (§1.4, §3.1, §4.1, §6).

0. **Decisions that gate everything else** (no code):
   - ✅ Windows compiler: **clang/MinGW** (decided).
   - ✅ Packaging: **platform-specific VSIX** (decided). `effect_emu` itself cannot be
     prebuilt (it embeds the user's effect), so the open point is toolchain delivery.
   - ✅ **Windows toolchain delivery: C, download on first use** (§4.2); built in two steps —
     detection of a user-installed toolchain first (Option B path, doubles as override), then
     the managed download.
   - Early, cheap, independent: run the vitest suite on a Windows CI runner (§6 item 8) —
     the TypeScript tests stub `fs`/`child_process`, so passing on macOS says nothing about
     Windows.
1. **Windows can compile and run silently** — first shippable milestone. Mechanical (§2, §3.1
   items 3–5, 8): POSIX headers, `SIGPIPE` guard, `.exe`/output path, `cmake --build -j`, CMake
   platform split, MSVC/clang flag handling. The existing non-Apple audio stub (§1.4 finding 1)
   already gives a build with no audio output.
2. **IPC transport + lifecycle** (§1, §3.1 items 1–2, 7): TCP loopback (`TCP_NODELAY`, bind
   `127.0.0.1`), Winsock port of `ipc_server.cpp`, announce protocol `host:port`, **graceful IPC
   `shutdown` message** (replaces SIGTERM reliance), cross-platform stale-process check
   (replaces `ps`). Required before `manager.ts` changes are meaningful.
3. **Audio backend abstraction** (§1.1–§1.4): common `AudioDevice` + fake test backend first
   (no regression net exists today), remove both RT-thread allocations, add max-callback-size
   query, then the RtAudio Windows backend → measurement gate → native WASAPI only if needed.
   Biggest structural risk, but best done after 1–2 so it can be tested end to end on Windows.
4. **Toolchain / debug / flash discovery** (§3, §3.1 items 9–14, §4.2): Windows search paths and
   `where.exe`, `path.delimiter`, `make` availability, `lldb-dap` discovery (blocks "F5 to
   debug" on Windows until done), WinUSB/Zadig hint for `dfu-util`. Sub-steps: (4a) detect a
   user-installed clang/MinGW + CMake + Ninja + `lldb-dap` with clear install hints;
   (4b) managed download-on-first-use toolchain (§4.2 Option C): pinned manifest, hash
   verification, global-storage install, consent/progress/offline UX.
5. **MIDI host bridge** (§4, §4.1): lift all three gates (code, rebuild script, npm scripts),
   port the rebuild script from Bash to Node, per-platform VSIX or multi-binary loading, decide
   ABI-fragility handling. Not required for a first Windows milestone; scope as a proper intake
   item. Platform edge cases (WinMM vs WinRT, device enumeration/permissions) resolved there.
6. **Open verification items** (§6 items 1–6) — resolve on a Windows machine as each area
   above is reached; items 1–2 should be answered before step 4.
