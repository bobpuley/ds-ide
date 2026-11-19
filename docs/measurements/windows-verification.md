# Windows verification matrix (M84 / FR-WIN-VER-1)

**Status:** scaffold — results to be filled in on a real Windows machine. Result values: `pass`, `fail (<what>)`, `deferred (<reason>)`.
**Build under test:** tag `0.25.0-win.7` or later on `feat/windows-support`. Record machine (Windows build, CPU, audio device) and the commit hash below.

| Field | Value |
|---|---|
| Date | |
| Windows build | |
| Audio device | |
| Commit / tag | |

## A. Build, run and IPC

| # | Check | How | Result | Evidence / notes |
|---|---|---|---|---|
| A1 | Sample effect builds | Open an example (e.g. `midi-synth-oled`), run **Build for Emulator** | | |
| A2 | Sample effect runs, audible output | **Run Daisy Effect**; sine/effect plays | | |
| A3 | Scope works over TCP IPC | Scope panel shows the waveform | | |
| A4 | FFT works | FFT panel shows a spectrum | | |
| A5 | Controls work | Move a pot / press a button in the Controls editor; effect reacts | | |
| A6 | Clean stop | Stop the effect; no stale `effect_emu.exe` left (Task Manager) | | |

## B. Real-time audio (M80 measurements on the final build)

Run from an MSYS2 shell: `tests/audio-measurement/run_measurements.sh` (and `--duplex` with a microphone). Paste the table rows into `windows-audio.md` and summarise here.

| # | Check | Expected | Result | Evidence / notes |
|---|---|---|---|---|
| B1 | WASAPI shared, output-only, 64/128/256, after the FR-WIN-AUD-6 period fix (deferred from M80) | `reported` = 512; `latency ms` ≈ 12.0 / 13.3 / 16.0 | | |
| B2 | xruns / driver overruns | 0 / 0 | | |
| B3 | Duplex (live input) | no xruns, as in M80 | | |
| B4 | ASIO | unmeasured unless an ASIO SDK and device exist; otherwise `deferred (no SDK/device)` | | |

## C. F5 debugging

| # | Check | Result | Evidence / notes |
|---|---|---|---|
| C1 | PID attach works (F5) | | |
| C2 | Spurious stop on attach/detach? (record what, if anything, lldb reports; §6 item 3) | | |
| C3 | Mute-on-breakpoint under the debugger (audio mutes/simulated clock; §6 item 4) | | |
| C4 | DWARF breakpoints hit in effect code (§6 item 2) | | |
| C5 | Variables visible and correct in effect code | | |
| C6 | `lldb-dap.exe` runs standalone (from the managed toolchain `bin`) | | |
| C7 | `liblldb.dll` loads without a separate Python | | |

## D. Flash, MIDI, fresh install

| # | Check | Result | Evidence / notes |
|---|---|---|---|
| D1 | Build & Flash with `dfu-util` on a Daisy Seed (§6 item 6): exit code, `:leave` exit 74 behaviour | | |
| D2 | No WinUSB driver: the "Cannot open DFU device" wording is captured and the Zadig hint appears | | |
| D3 | MIDI bridge: warning gone, hardware controller drives the effect (needs `midi.node` from the win32-x64 VSIX) | | |
| D4 | Fresh profile (`code --user-data-dir` empty): install the win32-x64 VSIX, trigger the managed toolchain download (consent, progress, install), then build and run | | |

## E. Open questions in `multiplatform_plan.md` §6

| § 6 item | Closed by | Status |
|---|---|---|
| 1 `lldb-dap` in the pinned llvm-mingw | C6 | |
| 2 PDB vs DWARF | C4, C5 | |
| 3 Spurious stop on attach/detach | C2 | |
| 4 Audio thread under a debugger | C3 | |
| 5 ARM `Makefile` build | answered 2026-11-18 (M81) | closed |
| 6 `dfu-util` exit code / WinUSB | D1, D2 | |
| 7 Toolchain delivery | decided (§4.2); exercised by D4 | |
| 8 Unit tests on Windows | `windows-ci` green | closed |
| 9 `effect_emu.exe` MinGW DLLs | M82 (toolchain `bin` on PATH) — confirm by A2/D4 | |
