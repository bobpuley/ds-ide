# 02 — Assumptions & Risks (v25)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).
>
> **v24 complete** — all v24 bets held; risks resolved or managed.
> Archived: [`docs/v24/02_assumptions-and-risks.md`](v24/02_assumptions-and-risks.md).

## Windows support — M77–M84 (intake 2026-10-04)

Source: `multiplatform_plan.md` (repo root), `01_input-ideas.md` 2026-10-04.

**Decisions recorded 2026-10-04:**
- Windows compiler is **clang/MinGW** (not MSVC): keeps GCC/Clang-style flags and sanitizer options, and DWARF debug info for lldb.
- Packaging is **platform-specific VSIX** (`vsce package --target …`).
- Windows toolchain delivery is **download on first use** (Option C); a user-installed toolchain is detected first and doubles as an override. `effect_emu` cannot be prebuilt (it embeds the user's effect), so a local clang/MinGW + CMake + Ninja is always required on Windows.
- Audio: a common `AudioDevice` interface; CoreAudio stays native on macOS; **RtAudio first on Windows**, a native WASAPI backend only if the M80 measurement gate fails.
- IPC: **Unix domain socket stays on macOS, TCP loopback on Windows**, behind a transport abstraction in both C++ and TypeScript. A graceful IPC `shutdown` message replaces reliance on SIGTERM on every platform.
- Git: nothing is merged into `main` until Windows support is complete and tested; base branch is `feat/windows-support`; pre-release tags `0.25.0-win.N` on that branch.
- macOS stays the primary test platform; Windows gaps that are not technically blocking are fixed uniformly rather than gated by `process.platform`.

**Bets**
- **Bet:** a thin `AudioDevice` interface plus RtAudio on Windows reaches acceptable latency and time accuracy for effect development; if M80's gate says otherwise, only the Windows backend is replaced (native WASAPI, 1–2 weeks) and nothing above the interface changes.
- **Bet:** `audio_engine.cpp` is the sole consumer of `CoreAudioDevice` (verified by call-site read-through, `multiplatform_plan.md` §1.4), so the extraction is low risk.
- **Bet:** the RT callback is already clean (SPSC queues, FFT/JSON on the drain thread), so it ports to any backend unchanged; only the two RT-thread allocations found must be removed.
- **Bet:** a hash-pinned manifest of upstream release archives (llvm-mingw, CMake, Ninja) is a sufficient, maintainable source for the Windows toolchain.

**Risks**
- **Risk — latency/jitter on Windows:** WASAPI shared mode has a coarser period than CoreAudio and default timers are coarse; small buffers (64/128 frames) may be unreachable. Mitigated by the M80 measurement gate and the conditional native-WASAPI phase.
- **Risk — no regression net on the real-time audio path:** no test currently exercises real-time mode, xruns, latency events or `rt_buffer_size` end to end. Mitigated by FR-WIN-AUD-4 (fake backend) *before* the refactor.
- **Risk — macOS regression from shared-code changes:** POSIX header cleanup, signal handling, the transport abstraction, the audio interface extraction and the shutdown message touch code macOS runs. Mitigated by FR-WIN-GIT-2 (macOS suites green at every milestone close) and by the final merge gate (M84).
- **Risk — graceful shutdown on Windows:** `process.kill(pid,'SIGTERM')` is `TerminateProcess` there, so signal handlers never run and the recorder/session flush (FR-EMU-8) would be skipped. Mitigated by FR-WIN-IPC-3.
- **Risk — large toolchain download:** llvm-mingw alone is ~190 MB compressed / ~750 MB extracted; extraction of ~9,300 files is slow under antivirus. Mitigated by consent prompt, progress, free-space check and post-extraction pruning of unused target sysroots (FR-WIN-TCH-4).
- **Risk — upstream asset retention:** GitHub release assets can be removed by maintainers. Mitigated by pinning hashes and keeping a mirror of the pinned archives as a ds-ide release asset (FR-WIN-TCH-4).
- **Risk — native addon ABI fragility:** `midi` (NAN) is not ABI-stable across Electron versions; with per-platform VSIX the rebuild matrix grows (one per OS/arch). Handled in M83.
- **Risk — Windows-specific external prerequisites:** `dfu-util` needs a WinUSB driver (Zadig) and the ARM `Makefile` build needs a `make`; both are outside the extension's control. Mitigated by diagnostics and install hints (FR-WIN-TCH-3).
- **Risk — unverified lldb behaviour on Windows:** whether the PID-attach flow produces a spurious stop, and whether the audio thread behaves under a Windows debugger, cannot be settled from the repo. Closed by the M84 verification matrix.

> ⚠️ ASSUMPTION: `lldb-dap.exe` ships in the pinned llvm-mingw release (confirmed by listing `llvm-mingw-20260922-ucrt-x86_64.zip`: `bin/lldb-dap.exe`, `liblldb.dll`, `libpython3.14.dll`) and runs standalone on Windows and reads MinGW DWARF correctly (not yet executed).
> ⚠️ ASSUMPTION: `liblldb.dll` loads without a separate Python installation (it ships `libpython3.14.dll` and a `python/` tree; not exercised).
> ⚠️ ASSUMPTION: upstream release asset names and URLs for llvm-mingw, CMake (`cmake-<ver>-windows-x86_64.zip` with `cmake-<ver>-SHA-256.txt`) and Ninja (`ninja-win.zip`) stay stable; Ninja publishes no hash file, so the manifest pins our own SHA-256 computed at adoption time.
- **Measured (M80 gate, `docs/measurements/windows-audio.md`, one Windows 11 PC):** WASAPI shared through RtAudio runs at a 10.67 ms (512-frame) device period whatever buffer is requested, with ~0.2 ms jitter and no xruns/overruns; WASAPI exclusive (native probe) runs at 5.33 ms. RtAudio was judged sufficient (stability clear, latency at the 2× limit); ASIO was not measured. The ≈15 ms timer figure was not measured (the event-driven backends do not depend on it).
> ⚠️ ASSUMPTION: callers of `CoreAudioDevice` depend only on its public header from a single place (`audio_engine.cpp`) — verified by read-through, not by compilation.
> ⚠️ ASSUMPTION: the VS Code Marketplace per-VSIX size limit and the licence terms for redistributing LLVM/MinGW-w64 are unverified; with download-on-first-use (Option C) neither blocks the VSIX, but the licence of downloading directly from upstream is low-risk and unreviewed.
> ⚠️ ASSUMPTION: TCP loopback on Windows needs a per-session token (any local process could otherwise connect to the port); the Unix socket on macOS is protected by filesystem permissions. Token design is deferred to M78.
> ⚠️ ASSUMPTION: the existing `chore/windows-compat` branch (commit `b86d7bc` "test: make unit tests pass on Windows", on `origin`) is reusable as the starting point for the Windows unit-test fixes; it forks from an older `main` commit and has not been reviewed against current code.
> ⚠️ ASSUMPTION: `PROTOCOL_VERSION` is bumped (or an equivalent capability flag added) when the `shutdown` message and the TCP announce format are introduced; exact rule decided in M78.

