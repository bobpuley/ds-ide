# Changelog

All notable changes to ds-ide are documented here.
Versions follow [Semantic Versioning](https://semver.org/). Each entry maps to a sprint milestone.

---

## 0.1.7 — 2026-06-17

**M7 — Block-form callback (v1.1)** *(AC-8 green — FR-RU-2 / FR-SH-2 complete)*

- Added `block_cb` field to `EmulatorState`; implemented `DaisySeed::StartAudio(AudioHandle::AudioCallback cb)` shim overload (C5) — previously a no-op stub. Covers FR-SH-2 (block part).
- Extended `audio_engine.cpp` (C4): detects which callback type was registered, deinterleaves the canonical input buffer into per-channel arrays, dispatches the block-form callback with `const float* const*` / `float* const*` views, then re-interleaves the output back into the canonical buffer. NaN/clip scan, scope tap, soft-paced clock, and sine generator are unchanged (validates the 04 §4.1 one-canonical-buffer assumption). Covers FR-RU-2 (block part).
- Scope IPC JSON extended with `out_r` (right-channel output) — additive, backward-compatible. Enables block-form effects that write to channel 1 (e.g. `inout`) to be verified via the IPC stream.
- Added `tests/runtime/test_inout.py`: builds `inout` (block-form example), verifies block callback dispatches, left-channel output is silent, right-channel output (`out_r`) tracks ADC0 (volume pot). AC-8 green.
- Updated `tests/runtime/build_and_test.sh`: adds inout to the test suite (4/4 pass including bypass, determinism, Osc). No regression to the interleaved corpus.

---

## 0.1.6 — 2026-06-17

**M6 — v1 polish & release** *(AC-1…AC-7 all green — v1.0 complete)*

- Added `LICENSES.md`: tracks libDaisy (MIT), DaisySP (MIT), and lldb-dap (Apache 2.0 with LLVM exceptions); notes that neither libDaisy/DaisySP nor lldb-dap are bundled in the extension. Covers NFR-10.
- Updated `src/webview/scope-panel.ts`: added sine frequency (20–20 000 Hz, default 440 Hz) and amplitude (0–1, default 0.50 ≈ −6 dBFS) controls to the scope panel; wired webview `sine` messages to `manager.sendSine()`; added `SineChangeHandler` callback; added "xruns: n/a" to the runtime status text; added a getting-started state (workflow steps shown before first deploy) and replaced the canvas with instructions until the first `status` IPC message arrives. Covers FR-AU-2, FR-RU-5, NFR-9.
- Updated `src/extension.ts`: loads and persists sine state (`ds-ide.sine`) via `workspaceState`; passes initial sine params to `scopePanel.show()` on deploy; sends `sendSine()` after every deploy (including debug deploy). Covers FR-AU-2, FR-CF-1.
- Updated `src/commands/debug-deploy.ts`: accepts an optional `sendSine` callback invoked after deploy, keeping sine replay consistent across Run and Debug modes.
- Updated `package.json`: added `keybindings` for build (⌘⇧⌥B), deploy (⌘⇧⌥D), start (⌘⇧⌥R), stop (⌘⇧⌥S). Covers NFR-9.
- 132 unit tests across 12 test files; all pass. Full v1.0 AC sweep (AC-1…AC-7) confirmed green.

---

## 0.1.5 — 2026-06-17

**M5 — Debug (breakpoints)**

- Added `src/debug/debug-adapter.ts`: `DaisyDebugAdapterFactory` — locates `lldb-dap` via `xcrun` first, then known Xcode/CLT candidate paths, and returns a `vscode.DebugAdapterExecutable` so VS Code can talk DAP directly to lldb. Covers C6 / FR-DB-6.
- Added `src/commands/debug-deploy.ts`: `debugDeploy()` — deploys the emulator (same flow as Run mode), replays pot snapshot, reads `childPid`, then calls `vscode.debug.startDebugging()` with a `daisy-debug / attach` config targeting the running process PID. Covers FR-DB-2.
- Updated `src/emulator/manager.ts`: added `childPid` getter exposing the running emulator's PID. Fixed a race condition where the old process's async `close` event was wiping out `this.childProcess` after a redeploy had already assigned a new child — guard now checks `this.childProcess === child` before nulling. Covers FR-DE-1/FR-DB integrity.
- Updated `src/extension.ts`: registers `DaisyDebugAdapterFactory` for the `daisy-debug` type; adds `ds-ide.debug` command (Deploy and Debug); listens to `onDidStartDebugSession` / `onDidTerminateDebugSession` to update the status bar. Covers FR-DB-1/3/4/5.
- Updated `package.json`: added `ds-ide.debug` command and `debuggers` contribution (`type: daisy-debug`, `languages: [c, cpp]`) so gutter breakpoints appear in C/C++ files. Covers FR-DB-1.
- 125 unit tests across 12 test files; all pass. AC-4 (breakpoint in callback hit; line shown; time frozen; continue/stop) closed.

---

## 0.1.4 — 2026-06-17

**M4 — Diagnostics & robustness**

- Added `src/diagnostics/build-diagnostics.ts`: `parseBuildLine()` and `applyDiagnostics()` — parse clang/gcc error/warning lines (`file:line:col: severity: message`) into `vscode.Diagnostic` entries and populate the VS Code Problems panel with clickable file:line links. Covers FR-ED-3.
- Added `src/diagnostics/non-portable.ts`: `detectNonPortableSymbol()` — scans build output for undefined-symbol linker errors (clang ld64 and GNU ld styles) and extracts the unresolved symbol name, enabling an actionable "symbol not emulated" message. Covers FR-BU-5.
- Updated `src/commands/build.ts`: `buildForEmulator()` now accepts a `DiagnosticCollection`, collects parsed diagnostics during build, applies them on success or failure, and shows the non-portable symbol message when a linker undefined-reference is detected.
- Updated `src/emulator/manager.ts`: `killExisting()` sets an `intentionalDisconnect` flag so IPC disconnect events during redeploy or dispose are suppressed; `connectIpc()` resets the flag so unexpected emulator crashes (flag is false) still propagate the `disconnect` event. Covers NFR-8 / FR-DE-2.
- Updated `src/extension.ts`: creates a `DiagnosticCollection` (passed to build) and a VS Code status bar item showing emulator state with the fidelity caveat in its tooltip; listens for `message{type:event,kind:nan|inf}` → VS Code warning notification; listens for `disconnect` → error notification without crashing the extension. Covers FR-RU-4, NFR-7, NFR-8.
- Updated `src/webview/scope-panel.ts`: audio-health events now accumulate in a `Set` and remain visible until transport stops (sticky); fidelity caveat notice ("ℹ Approx. Seed") added to the scope panel header. Covers FR-RU-4, NFR-7.
- Updated `src/__mocks__/vscode.ts`: added `DiagnosticSeverity`, `Range`, `Diagnostic`, `StatusBarAlignment`, `languages.createDiagnosticCollection`, and `window.createStatusBarItem` to the test mock.
- 107 unit tests across 10 test files; all pass. AC-5 (NaN/clip flagged), AC-6 (hardware build untouched), AC-7 (<30 s loop) closed.

---

## 0.1.3 — 2026-06-17

**M3 — Controllers (pots)**

- Added `src/controllers/controller-config.ts`: `parseControllerYaml()` — parses the project's `controllers.yaml` (id, label, adc_channel, range, taper, default); validates duplicate channels, out-of-range channel numbers, missing fields, and invalid taper values; returns valid `ControllerDef[]` plus collected error strings. Covers FR-CT-1/5.
- Added `src/controllers/pot-store.ts`: `PotStore` — persists pot channel values in `vscode.workspaceState`; `setDefaults()` seeds channels not yet stored; `getSnapshot()` returns a full channel→value map for IPC replay. Covers FR-CT-4, FR-CF.
- Updated `src/webview/scope-panel.ts`: `ScopePanel.show(defs, initialValues)` now renders a pot-slider row per `ControllerDef`; webview `pot` messages are forwarded to `manager.sendPot()` and an optional `onPotChange` callback; slider initial values come from `PotStore`. Covers FR-CT-2/3, NFR-3 ≤50 ms.
- Updated `src/emulator/manager.ts`: added `sendPotSnapshot(values)` — sends an IPC `potSnapshot` message to replay all pot values on (re-)deploy. Covers FR-DE-2.
- Updated `src/extension.ts`: `PotStore` created on activation; deploy command loads `controllers.yaml`, calls `potStore.setDefaults()`, passes defs + initial values to `scopePanel.show()`, and sends `potSnapshot` after IPC connect.
- 81 unit tests across 8 test files; all pass; TypeScript typecheck clean. AC-2 closed.

---

## 0.1.2 — 2026-06-17

**M2 — Extension run loop + scope**

- Added `src/emulator/ipc-client.ts`: `IpcClient` — EventEmitter wrapping a Node `net.Socket` UNIX-domain connection; sends JSON lines, buffers and parses incoming lines, emits typed `message`/`error`/`disconnect` events.
- Added `src/emulator/manager.ts`: `EmulatorManager` — orchestrates the full lifecycle: CMake configure + build (auto-detects effect `.cpp` and DaisySP at project root), child-process spawn/kill with socket-path parsing from stdout, IPC client connect, relay of IPC messages as EventEmitter events. Supports injectable factories for testability.
- Added `src/webview/scope-panel.ts`: `ScopePanel` — VS Code `WebviewPanel` with an inline HTML canvas that draws input (teal) and output (orange) waveforms in real time; relays `scope`, `status`, and `event` frames from the manager into the webview via `postMessage`.
- Updated `src/commands/build.ts`: `buildForEmulator` now invokes `EmulatorManager.build()` with auto-detected sources and streams output to a dedicated Output Channel.
- Updated `src/commands/deploy.ts`: `deployToEmulator` opens the scope panel and calls `EmulatorManager.deploy()`, which kills any running emulator, launches the new executable, and connects IPC.
- Updated `src/commands/transport.ts`: `startAudio`/`stopAudio` call `manager.sendTransport('start'/'stop')`.
- Updated `src/extension.ts`: creates `EmulatorManager` + `ScopePanel` on activation; wires all four commands; disposes cleanly on deactivate.
- 35 unit tests across 5 test files (ipc-client, manager, build helpers, transport commands, extension scaffold); all pass; TypeScript strict-mode typecheck clean.

---

## 0.1.1 — 2026-06-17

**M1 — Headless emulator runtime**

- Added `emulator/CMakeLists.txt`: host CMake build that compiles an effect `.cpp` + the host libDaisy shim + DaisySP + the runtime `main()` into a single native executable (`effect_emu`); `-O0 -g`; effect `main()` renamed via `-Dmain=effect_main` so the runtime controls startup; DaisySP sub-directory include paths handled automatically.
- Added shim implementations (`emulator/shim/src/`): `DaisySeed` Configure/Init/SetAudioBlockSize/AudioSampleRate/GetPin/StartAudio/PrintLine; `AdcHandle` GetFloat backed by atomic `pot_values[]` array; `System::Delay` with shutdown-flag check.
- Added emulator runtime (`emulator/runtime/`): shared `EmulatorState` (atomic pot values, transport flag, sine params, IPC send hook); audio engine thread (soft-paced interleaved block loop, sine generator, scope tap at ≈30 fps, NaN/Inf/denormal/clip scan); UNIX-domain-socket IPC server (line-delimited JSON: `config`/`transport`/`sine`/`pot`/`potSnapshot` in → `scope`/`status`/`event` out).
- Added integration tests (`tests/runtime/`): Python IPC client helper; `test_bypass` (verifies `out == in` across ≥3 scope frames); `test_osc` (verifies Osc oscillator produces non-silent output that changes with pot position); `test_determinism` (same inputs → bit-identical scope output, NFR-6). All 3 pass; M0 shim compile-tests unaffected.
- `bypass` builds, runs headless, and passes the out==in scope check. `Osc` with hardcoded pot value shows the oscillator tracking it. Determinism verified.

---

## 0.1.0 — 2026-06-17

**M0 — Foundations**

- Added VS Code extension scaffold: `package.json` manifest, TypeScript project, esbuild bundler, `activate()`/`deactivate()`, four command stubs (`ds-ide.build`, `ds-ide.deploy`, `ds-ide.start`, `ds-ide.stop`). Extension loads and commands appear in the Command Palette.
- Added host libDaisy shim API headers (`emulator/shim/include/`): `daisy_seed.h` umbrella, `AudioHandle` (interleaved v1.0 + block v1.1 callback typedefs), `DaisySeed`, `AdcChannelConfig`/`AdcHandle`, `System::Delay`, pin constants (`seed::A0`–`A11`), `Led`/`Switch` no-op stubs.
- Added compile-test script (`tests/shim-compile/run_compile_tests.sh`): verifies all four v1 examples (`bypass`, `Knob`, `Osc`, `inout`) compile cleanly against the shim headers with host clang. All 4 PASS.
- Added Milestone Registry to `docs/05_dev-plan.md` and `docs/milestones/M0.md`.
- Added `.vscode/launch.json` + `tasks.json` for F5 Extension Development Host.
- 4 vitest unit tests for extension activation pass; TypeScript strict-mode typecheck clean.
