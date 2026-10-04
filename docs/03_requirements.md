# 03 — Requirements (v25)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).
>
> **v24 complete** — all v24 requirements implemented; ACs green.
> Archived: [`docs/v24/03_requirements.md`](v24/03_requirements.md).

## Windows support — `FR-WIN-*` (intake 2026-10-04)

Source: `01_input-ideas.md`, 2026-10-04; `multiplatform_plan.md`. Milestones: **M77–M84**.

**Decisions recorded 2026-10-04:** see `02_assumptions-and-risks.md` (clang/MinGW; platform-specific VSIX; download-on-first-use toolchain; `AudioDevice` interface with RtAudio first on Windows; Unix socket on macOS + TCP loopback on Windows; branch `feat/windows-support` as base, nothing merged to `main` until the end).

### Git workflow and release

**FR-WIN-GIT-1 — Branching model.** All Windows work is based on `feat/windows-support` (already on `origin`). Each milestone M77–M84 is developed on its own branch created from `feat/windows-support` (`feat/m<N>-<slug>`) and, at milestone close, merged into `feat/windows-support` — never into `main`. The sprint-close protocol's "merge → tag → push" applies to `feat/windows-support`, not to `main`. `feat/windows-support` is merged into `main` only once, at the end (FR-WIN-VER-2), after the user explicitly approves.

**FR-WIN-GIT-2 — macOS non-regression at every milestone close.** Before a milestone branch is merged into `feat/windows-support`, the full existing macOS suites pass: TypeScript unit tests, the emulator C++ test runners under `tests/`, `tests/build-flags`, and the runtime/functional tests, with no test removed or weakened to make them pass. A change to shared code (POSIX cleanup, signals, transport, audio interface, shutdown message) states in its task how macOS behaviour is preserved.

**FR-WIN-GIT-3 — Pre-release versioning.** At milestone close the branch is tagged `0.25.0-win.<N>` (N = 1 for M77 … 8 for M84) on `feat/windows-support`, with a `CHANGELOG.md` entry per milestone. The tag for the merge into `main` (a real semver, to be proposed then) is created only at FR-WIN-VER-2.

### Build foundations (M77)

**FR-WIN-BLD-1 — Windows CI for TypeScript tests.** A CI workflow runs the TypeScript unit tests (`vitest`) on a Windows runner and fails on any failure. The fixes from `chore/windows-compat` (`b86d7bc`) are reviewed and reused if still valid. Tests that cannot pass on Windows for a legitimate reason are skipped explicitly with a reason, never silently.

**FR-WIN-BLD-2 — No POSIX-only headers outside platform layers.** `wav_reader.cpp`, `session_player.cpp`, `session_recorder.cpp` and `fatfs_host.cpp` no longer include `<unistd.h>`, `<sys/stat.h>` or `<fcntl.h>` directly; file and directory operations use `std::filesystem`/standard I/O or a small platform shim, and `mkdir` no longer relies on POSIX permission bits. macOS behaviour (including file creation modes the recorder relies on) is unchanged.

**FR-WIN-BLD-3 — Portable process setup.** `main.cpp` compiles on Windows: `SIGPIPE` handling is guarded (`#ifndef _WIN32`), and the shutdown flag path does not depend on POSIX-only signals.

**FR-WIN-BLD-4 — Platform-split CMake.** `emulator/CMakeLists.txt` selects sources and libraries per platform (CoreAudio/AudioToolbox on Apple; the Windows audio and Winsock libraries on Windows; the existing non-Apple audio stub until M80). Under clang/MinGW the existing GCC/Clang-style flags and the ASan/UBSan/TSan options keep working or are explicitly handled per platform.

**FR-WIN-BLD-5 — Build invocation and binary path.** The extension builds the emulator with `cmake --build <dir> -j <N>` (not `-- -jN`), pins a generator on Windows (Ninja), and locates `effect_emu.exe` (including a multi-config output directory if one is ever used). The same code path on macOS finds `effect_emu` as today.

### IPC transport and process lifecycle (M78)

**FR-WIN-IPC-1 — Transport abstraction.** The emulator's IPC server and the extension's `IpcClient`/`EmulatorManager` use a transport abstraction with two implementations: a Unix domain socket (macOS, unchanged) and TCP loopback (Windows: bind `127.0.0.1`, ephemeral port, `TCP_NODELAY`). The announce line carries either a socket path or `host:port`; the line protocol and all message shapes are unchanged. On Windows `ipc_server.cpp` uses Winsock (`WSAStartup`/`WSACleanup`, `closesocket`, no `<sys/un.h>`/`<unistd.h>`).

**FR-WIN-IPC-2 — Session token on TCP.** On the TCP transport the emulator accepts a connection only after the client presents a per-session token passed to the emulator at spawn (not on a public command line visible to other users where avoidable); a connection without a valid token is closed. The Unix socket path is unaffected.

**FR-WIN-IPC-3 — Graceful shutdown message.** A host-to-emulator `shutdown` message makes the emulator stop the audio engine, flush the session recorder and exit with status 0. The extension sends it first on every platform and falls back to terminating the process after a grace period. Signal handlers on POSIX keep working. `PROTOCOL_VERSION` handling for the new message/announce format is defined and tested (a new extension with an old emulator fails clearly, as today).

**FR-WIN-IPC-4 — Cross-platform stale-process check.** Reclaiming a stale `effect_emu` recorded in `emu.pid` checks the process identity through one function with a per-platform query — `ps -p <pid> -o comm=` on macOS (unchanged), `tasklist` on Windows (matching `effect_emu.exe`) — so it works on both platforms, the executable name is matched exactly (not by suffix), a garbled pid file is ignored, and an unrelated process that reused the PID is never killed. The stale `.sock` cleanup remains macOS-only behaviour; Windows has no equivalent files to clean.

> Decision 2026-10-04 (M78): the original wording "no longer shells out to `ps`" was replaced — macOS has no `ps`-free way to read a PID's executable name (no `/proc`, nothing in Node), and an IPC-based identity check would leave an emulator with a dead IPC thread unreclaimed. `ps` stays on macOS; Windows uses `tasklist`.

### Audio backends (M79–M80)

**FR-WIN-AUD-1 — `AudioDevice` interface.** An abstract `AudioDevice` (non-copyable, non-movable) with a factory replaces direct use of `CoreAudioDevice`: `start`, `start_output_only`, `stop`, `isRunning`, `drainXruns`, `drainRenderErrors`, `lastLatencyMs`, `queriedInputSampleRate`, plus a maximum-callback-size query. `ProcessFn` stays stereo-interleaved regardless of hardware channels. `#ifdef` is confined to the factory. The macOS CoreAudio backend behaves exactly as before; the existing fallbacks (`realtime_unavailable` → simulated mode; output-only failure → silent software loop) are preserved.

**FR-WIN-AUD-2 — No allocation on the real-time thread.** The `resize`/`assign` calls in both render callbacks (`core_audio_device.cpp`) and in the `run_realtime()` `processBlock` lambda (`audio_engine.cpp`) are removed: work buffers are sized up front from the backend's reported maximum callback size, and a larger-than-expected callback is clamped with the tail zero-filled.

**FR-WIN-AUD-3 — Portable timing.** `mach_absolute_time()` and `compute_mach_ns_per_tick()` are replaced by `std::chrono::steady_clock`. The xrun definition (callback CPU time exceeding the buffer duration) is unchanged; driver-level overflow/underflow reported by a backend is counted and documented separately.

**FR-WIN-AUD-4 — Real-time path regression net.** A fake `AudioDevice` drives the callback deterministically so that tests cover real-time mode end to end: xrun accounting, latency events, render errors, `sample_rate_mismatch`, `realtime_unavailable` fallback, `rt_buffer_size`/`audioDevice` handling, and mute-on-breakpoint mode switching — written and passing on macOS **before** the interface extraction and RT-allocation changes land.

**FR-WIN-AUD-5 — Windows RtAudio backend.** On Windows an RtAudio-based backend implements `AudioDevice` (output-only first, then duplex), using the WASAPI API (ASIO as an option), interleaved stereo, no microphone stream in output-only mode. Mono/multichannel hardware is adapted inside the backend.

**FR-WIN-AUD-6 — Reported buffer, rate and latency.** Backends report the *actual* buffer size, sample rate and latency (RtAudio `getStreamLatency()` on Windows); a requested-vs-actual buffer mismatch is surfaced to the user like `sample_rate_mismatch`. The `realtime_unavailable` message shown in the Scope no longer mentions only the macOS microphone permission.

**FR-WIN-AUD-7 — Measurement gate.** Latency, jitter, xruns and effective buffer size are measured on Windows for WASAPI shared, WASAPI exclusive and ASIO against the macOS baseline, with the results recorded in the repo. The outcome decides whether the RtAudio backend is sufficient or a native WASAPI backend (a separate, later milestone) is needed.

### Toolchain, debug and flash (M81–M82)

**FR-WIN-TCH-1 — Windows tool discovery.** `arm-none-eabi-gcc`, `dfu-util` and `make` are found on Windows via `where.exe`, the configured path, PATH and known install locations (Arm GNU Toolchain, xPack, MSYS2), with `.exe` handling and `path.join`/`path.delimiter` instead of hard-coded `/` and `:`. macOS discovery is unchanged. Install hints are per platform.

**FR-WIN-TCH-2 — Hardware build on Windows.** `hardware-build.ts` extends PATH with `path.delimiter`, and reports a clear error when `make` is not available. Whether the project's ARM `Makefile` builds with the Windows toolchain is verified and any required adjustment is made or documented.

**FR-WIN-TCH-3 — dfu-util on Windows.** Board detection and flashing work on Windows when a WinUSB driver is bound to the DFU device; when it is not, the user gets a diagnostic that names the missing driver (Zadig) instead of a generic failure. The exit-code-74 special case is verified against a Windows `dfu-util` build.

**FR-WIN-DBG-1 — `lldb-dap` discovery per platform.** `lldb-dap` is resolved through a per-platform resolver (macOS: `xcrun`/Xcode paths; Linux: existing versioned names; Windows: the managed or user-installed clang/MinGW toolchain). The "not found" message names the right remedy for the current platform.

**FR-WIN-TCH-4 — Managed Windows toolchain (download on first use).** On Windows, when no usable toolchain is found, the extension offers to download a pinned set — llvm-mingw (clang, lld, lldb, `lldb-dap`), CMake and Ninja — described by a manifest of version, URL and SHA-256 kept in the repo. It asks for consent showing the download size, checks free disk space, downloads over HTTPS with a cancellable progress notification, verifies the hash before extracting, extracts to a temporary directory and renames atomically into `context.globalStorageUri/<toolchain-version>/`, prunes unused target sysroots, and removes superseded versions. Failure (offline, proxy, hash mismatch, disk full) gives a clear message and a retry; an "install from local archive" path covers air-gapped machines. Pinned archives are mirrored as ds-ide release assets as a fallback source.

**FR-WIN-TCH-5 — One toolchain lookup order.** All consumers (emulator build, hardware build, debug adapter) resolve tools in the same order: user-configured path → toolchain on PATH → managed download → prompt to download. A user-installed toolchain therefore works as an override and is the first implementation step (M81) before the download exists (M82).

### MIDI and packaging (M83)

**FR-WIN-MIDI-1 — Host MIDI bridge on Windows.** The `platform !== 'darwin'` gate in `host-bridge.ts`, the Darwin check in `scripts/rebuild-midi-native.sh`, and the macOS-only wiring in the npm scripts are lifted so the bridge works on Windows (and macOS unchanged). The rebuild script is a Node script, not Bash. Failure to load the native addon still degrades to a console warning and the on-screen keyboard.

**FR-WIN-PKG-1 — Platform-specific VSIX.** The extension is packaged per platform (`vsce package --target win32-x64` and `darwin-arm64`), each VSIX carrying the `midi.node` built for that OS/arch and the emulator sources; a CI job builds and smoke-tests both. The Electron ABI target (`scripts/electron-target-version.txt`) is shared; the rebuild runs once per target platform.

### Verification and merge (M84)

**FR-WIN-VER-1 — Windows verification matrix.** On a Windows machine the following are verified and recorded: build + run of a sample effect; scope, FFT and controls over TCP IPC; real-time audio and the M80 measurements; F5 debugging (PID attach, spurious-stop behaviour, mute-on-breakpoint under the debugger, DWARF breakpoints/variables); Build & Flash with `dfu-util`; MIDI bridge; fresh-install flow with the managed toolchain download. The open questions in `multiplatform_plan.md` §6 are each closed or explicitly deferred.

**FR-WIN-VER-2 — Merge readiness and merge to `main`.** `feat/windows-support` is merged into `main` only when FR-WIN-VER-1 is complete, the full macOS suites are green on the final branch, `CHANGELOG.md` is up to date, and the user has explicitly approved. The merge, the real semver tag and the push are performed only after that approval.

