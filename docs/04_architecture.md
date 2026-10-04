# 04 — Architecture (v25)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).
>
> **v24 complete** — full v24 architecture in
> [`docs/v24/04_architecture.md`](v24/04_architecture.md).

## Windows support — M77–M84 (2026-10-04)

The process model is unchanged (VS Code extension + separate `effect_emu` native process over a line-based JSON IPC). What changes is that three platform seams become explicit interfaces, and Windows gets an implementation behind each. Full survey and verified call-site findings: `multiplatform_plan.md` (§1–§4.2).

**Branching and release.** All work is based on `feat/windows-support`; each milestone is a branch off it, merged back into it at close, tagged `0.25.0-win.<N>`; `main` is touched once, at the end (FR-WIN-GIT-1..3, FR-WIN-VER-2).

**1. Audio — `AudioDevice` interface (M79–M80).**
- `emulator/runtime/audio_device.h` declares an abstract, non-copyable `AudioDevice` (`start`, `start_output_only`, `stop`, `isRunning`, `drainXruns`, `drainRenderErrors`, `lastLatencyMs`, `queriedInputSampleRate`, plus a maximum-callback-size query) and a factory function; `#ifdef` lives only in the factory.
- `core_audio_device.{h,cpp}` becomes the macOS implementation (behaviour unchanged). A Windows implementation wraps RtAudio (WASAPI; ASIO optional). A fake implementation drives the callback deterministically for tests. The existing non-Apple stub (all `start*` return `false`) remains the fallback when no backend is available.
- `audio_engine.cpp` is the sole consumer (`run_simulated()` uses `start_output_only`; `run_realtime()` uses `start`, and calls `drainXruns`/`lastLatencyMs`/`drainRenderErrors` from inside its callback by reference) and only changes by type name and by removing the RT-thread `resize` calls, sizing its buffers from the backend's maximum callback size.
- Timing: `std::chrono::steady_clock` replaces the Mach calls; xrun semantics are unchanged (CPU budget overrun), driver-level flags are a separate metric.
- Conditional later phase: a native WASAPI backend replaces only the Windows implementation if the M80 gate fails; nothing above the interface changes.

**2. IPC — transport abstraction (M78).**
- C++: `ipc_server.cpp` splits socket creation/accept/IO from message handling behind a small transport layer: `AF_UNIX` (macOS, unchanged) and TCP loopback on `127.0.0.1` with `TCP_NODELAY` and Winsock (Windows). The announce line stays `DAISY_EMU_SOCKET:<value>` where the value is a path or `host:port`.
- TypeScript: `IpcClient.connect()` takes a transport descriptor (`net.Socket.connect(path)` or `connect(port, host)`); `EmulatorManager` parses the announce value, drops the AF_UNIX path-length rationale for Windows, and sends the session token on TCP.
- Lifecycle: a `shutdown` message gives a graceful exit on all platforms (SIGTERM remains on POSIX); the stale-process check uses a per-platform identity query behind one function (`ps` on macOS, `tasklist` on Windows; FR-WIN-IPC-4). Message shapes are otherwise unchanged; `PROTOCOL_VERSION` handling covers the new announce/message.

**3. Process, build and tooling — extension side (M77, M81–M82).**
- Build: `cmake --build -j N`, Ninja pinned on Windows, `effect_emu.exe` resolved by `EmulatorManager`; CMake chooses sources and libraries per platform under clang/MinGW.
- A single tool-lookup module resolves `arm-none-eabi-gcc`, `dfu-util`, `make`, `cmake`, `ninja`, `clang` and `lldb-dap` in one order: configured path → PATH → managed toolchain → prompt. It replaces the per-file `which`/`xcrun`/hard-coded lists in `toolchain.ts` and `debug-adapter.ts`, using `where.exe` on Windows.
- Managed toolchain: a repo-kept manifest (version, URL, SHA-256 for llvm-mingw, CMake, Ninja; mirrored as ds-ide release assets) drives a downloader that verifies, extracts atomically into `context.globalStorageUri/<toolchain-version>/` and prunes unused target sysroots. UI reuses the `CancellationToken` + progress pattern (FR-EXT-16).
- Debug: the DAP proxy and `MuteOnBreakpointTracker` are platform-neutral and unchanged; the spurious-detach-SIGSTOP filter is inert on Windows; only `lldb-dap` discovery and its error text become per-platform.

**4. MIDI and packaging (M83).**
- `host-bridge.ts` loses its Darwin gate; `rebuild-midi-native.sh` becomes a Node script that rebuilds `midi` against the Electron ABI for the current OS/arch; `package.json` scripts and `.vscodeignore` carve in the right `midi.node` per target.
- Distribution: one VSIX per platform (`win32-x64`, `darwin-arm64`), each carrying the emulator sources (built on the user's machine) and its own `midi.node`.

**5. Testing architecture.**
- A Windows CI runner executes the TypeScript unit tests from M77; the C++ test runners and shell-based suites stay macOS/Linux until each is ported where Windows coverage is needed.
- A fake `AudioDevice` is the regression net for the real-time path; the Windows audio measurement harness (M80) records latency/jitter/xruns/effective buffer per backend.

