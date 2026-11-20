# Windows verification matrix (M84 / FR-WIN-VER-1)

**Status:** executed 2026-11-19/20 on two Windows machines (Windows 10 22H2 build 19045; Windows 11 build 26300 for the duplex re-run) — D1–D3 deferred (no Daisy Seed / MIDI controller available). Result values: `pass`, `fail (<what>)`, `deferred (<reason>)`.
**Build under test:** tag `0.25.0-win.7` or later on `feat/windows-support`. Record machine (Windows build, CPU, audio device) and the commit hash below.

| Field | Value |
|---|---|
| Date | 19/11/2026|
| Windows build | Windows 10 22H2 (build SO 19045.6466)|
| Audio device | Realtek High Definition Audio|
| Commit / tag | 0.26.0|

## A. Build, run and IPC

| # | Check | How | Result | Evidence / notes |
|---|---|---|---|---|
| A1 | Sample effect builds | Open an example (e.g. `midi-synth-oled`), run **Build for Emulator** | pass| |
| A2 | Sample effect runs, audible output | **Run Daisy Effect**; sine/effect plays | pass| |
| A3 | Scope works over TCP IPC | Scope panel shows the waveform | pass| |
| A4 | FFT works | FFT panel shows a spectrum | pass| |
| A5 | Controls work | Move a pot / press a button in the Controls editor; effect reacts | pass| |
| A6 | Clean stop | Stop the effect; no stale `effect_emu.exe` left (Task Manager) | pass| but the process disappear when the emulator is stopped|

## B. Real-time audio (M80 measurements on the final build)

Run from an MSYS2 shell: `tests/audio-measurement/run_measurements.sh` (and `--duplex` with a microphone). Paste the table rows into `windows-audio.md` and summarise here.

| # | Check | Expected | Result | Evidence / notes |
|---|---|---|---|---|
| B1 | WASAPI shared, output-only, 64/128/256, after the FR-WIN-AUD-6 period fix (deferred from M80) | `reported` = 512; `latency ms` ≈ 12.0 / 13.3 / 16.0 | pass| reported = 480 and interval = 10.00 ms on this device, so reported follows the real period. Latency 11.3 / 12.7 / 15.3 ms = 10.00 ms period + buffer; the expected values assumed a 10.67 ms period.|
| B2 | xruns / driver overruns | 0 / 0 | pass| 0 / 0 in every run, shared and exclusive; jitter ≤ 0.33 ms; one 13.15 ms wakeup at 128, no xrun|
| B3 | Duplex (live input) | no xruns, as in M80 | pass| Windows 11 build 26300 re-run, 2026-11-20 (`windows-audio.md`): 0 / 0 xruns and overruns; `reported` = 512, latency 12.0 / 13.3 / 16.0 ms — exactly the predicted values|
| B4 | ASIO | unmeasured unless an ASIO SDK and device exist; otherwise `deferred (no SDK/device)` | deferred (no ASIO SDK/device)| |

## C. F5 debugging

| # | Check | Result | Evidence / notes |
|---|---|---|---|
| C1 | PID attach works (F5) | pass| `lldb-dap` used: `C:\msys64\clang64in\lldb-dap.exe` (MSYS2 CLANG64, found before the managed toolchain) |
| C2 | Spurious stop on attach/detach? (record what, if anything, lldb reports; §6 item 3) | pass| no spurious stop reported by the tester; `isSpuriousDetachSigstop` stays as a harmless filter |
| C3 | Mute-on-breakpoint under the debugger (audio mutes/simulated clock; §6 item 4) | pass| |
| C4 | DWARF breakpoints hit in effect code (§6 item 2) | pass| |
| C5 | Variables visible and correct in effect code | pass| |
| C6 | `lldb-dap.exe` runs standalone | pass| run on the MSYS2 CLANG64 binary; the managed toolchain's `lldb-dap` was not re-run separately |
| C7 | `liblldb.dll` loads without a separate Python | pass| run with PATH reduced to the toolchain `bin` and System32 |

## D. Flash, MIDI, fresh install

| # | Check | Result | Evidence / notes |
|---|---|---|---|
| D1 | Build & Flash with `dfu-util` on a Daisy Seed (§6 item 6): exit code, `:leave` exit 74 behaviour | deferred (no Daisy Seed available)| |
| D2 | No WinUSB driver: the "Cannot open DFU device" wording is captured and the Zadig hint appears | deferred (no Daisy Seed available)| |
| D3 | MIDI bridge: warning gone, hardware controller drives the effect (needs `midi.node` from the win32-x64 VSIX) | deferred (no MIDI controller available; the addon load is covered by the `package` workflow's `verify:package`)| |
| D4 | Fresh profile (`code --user-data-dir` empty): install the win32-x64 VSIX, trigger the managed toolchain download (consent, progress, install), then build and run | pass| |

## E. Open questions in `multiplatform_plan.md` §6

| § 6 item | Closed by | Status |
|---|---|---|
| 1 `lldb-dap` in the pinned llvm-mingw | C6 | closed — M82 pins llvm-mingw 20261117, whose manifest includes `lldb-dap`; C6/C7 ran on MSYS2's binary, D4 passed with the managed toolchain |
| 2 PDB vs DWARF | C4, C5 | closed — MinGW DWARF: breakpoints and variables work |
| 3 Spurious stop on attach/detach | C2 | closed — none observed on Windows |
| 4 Audio thread under a debugger | C3 | closed — mute-on-breakpoint and resume work |
| 5 ARM `Makefile` build | answered 2026-11-18 (M81) | closed |
| 6 `dfu-util` exit code / WinUSB | D1, D2 | **deferred** — needs a Daisy Seed and a Windows `dfu-util` run |
| 7 Toolchain delivery | decided (§4.2); exercised by D4 | closed — fresh-profile download passed |
| 8 Unit tests on Windows | `windows-ci` green | closed |
| 9 `effect_emu.exe` MinGW DLLs | M82 (toolchain `bin` on PATH) — confirm by A2/D4 | closed — A2 and D4 pass |
