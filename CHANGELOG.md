# Changelog

All notable changes to ds-ide are documented here.
Versions follow [Semantic Versioning](https://semver.org/). Each entry maps to a sprint milestone.

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
