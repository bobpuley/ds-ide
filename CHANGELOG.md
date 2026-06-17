# Changelog

All notable changes to ds-ide are documented here.
Versions follow [Semantic Versioning](https://semver.org/). Each entry maps to a sprint milestone.

---

## 0.1.0 — 2026-06-17

**M0 — Foundations**

- Added VS Code extension scaffold: `package.json` manifest, TypeScript project, esbuild bundler, `activate()`/`deactivate()`, four command stubs (`ds-ide.build`, `ds-ide.deploy`, `ds-ide.start`, `ds-ide.stop`). Extension loads and commands appear in the Command Palette.
- Added host libDaisy shim API headers (`emulator/shim/include/`): `daisy_seed.h` umbrella, `AudioHandle` (interleaved v1.0 + block v1.1 callback typedefs), `DaisySeed`, `AdcChannelConfig`/`AdcHandle`, `System::Delay`, pin constants (`seed::A0`–`A11`), `Led`/`Switch` no-op stubs.
- Added compile-test script (`tests/shim-compile/run_compile_tests.sh`): verifies all four v1 examples (`bypass`, `Knob`, `Osc`, `inout`) compile cleanly against the shim headers with host clang. All 4 PASS.
- Added Milestone Registry to `docs/05_dev-plan.md` and `docs/milestones/M0.md`.
- Added `.vscode/launch.json` + `tasks.json` for F5 Extension Development Host.
- 4 vitest unit tests for extension activation pass; TypeScript strict-mode typecheck clean.
