# M64 — Functional/E2E Test Layer (Foundation)

**Version:** 0.19.2
**Status:** released
**Source:** feature intake session, 2026-08-30

## Goal

Add a real-extension-host integration test layer alongside vitest's mocked-`vscode`-module
unit tests, so activation, command dispatch, and IPC round-trips get exercised against an
actual VS Code Extension Development Host instead of only mocks. Scoped to the foundation
layer only: cases that don't require driving DOM content inside a webview iframe. After this
milestone, `npm run test:e2e` launches a real VS Code instance and verifies the extension
activates, its commands are registered and callable, and a real IPC message survives a round
trip through the actual `src/ipc/narrow.ts` schema boundary — none of which today's vitest
suite (mocked `vscode` module) can prove. Webview-DOM-driven cases (pot dragging, scope canvas,
wiring-editor pin-conflict highlighting) remain out of scope, left for a future milestone using
`vscode-extension-tester`.

## Sprint Tasks

### [x] feat: scaffold @vscode/test-electron infrastructure (FR-TEST-2)

Added the standard Microsoft-supported e2e harness: `@vscode/test-electron` and `@vscode/test-cli`
as devDependencies. Created `src/test/e2e/` parallel to the existing `src/test/unit/` and
`src/test/manual/`, with `tsconfig.e2e.json` compiling it to `out/test/e2e/` and a
`.vscode-test.mjs` config pointing the `vscode-test` CLI (from `@vscode/test-cli`) at the
compiled specs. No separate `runTests.ts` entry point: `@vscode/test-cli`'s own runner already
wraps `@vscode/test-electron` internally and wires `extensionDevelopmentPath`/
`extensionTestsPath` from the config file, so a hand-written entry point would just duplicate
that — the CLI is the "standard Microsoft-supported" path, not a manual `runTests()` call.
`test:e2e` in `package.json` first runs `npm run compile` (the real extension must be built for
the host to activate it), then compiles the e2e specs, then runs `vscode-test` — kept separate
from `test` (vitest) and not wired into `lint`, since it's slower and downloads/launches real
VS Code on first run (opt-in, per the "speed is the product" non-negotiable for the fast inner
loop). Wrote one smoke spec (`src/test/e2e/smoke.test.ts`): the extension activates and every
command in `package.json`'s `contributes.commands` is resolvable via
`vscode.commands.getCommands()`.

**Affected files:** `package.json`, `package-lock.json`, `tsconfig.e2e.json` (new),
`src/test/e2e/smoke.test.ts` (new), `.vscode-test.mjs` (new), `.gitignore`, `README.md`

**DoD:**
- `npm run test:e2e` launches a real VS Code Extension Development Host and passes locally.
- The smoke spec fails if a contributed command is missing from the registered-commands list
  (verified by temporarily commenting out a command registration and confirming the spec fails,
  then restoring it).
- `test:e2e` is documented in the README/CONTRIBUTING (or equivalent) as a separate, slower,
  opt-in suite distinct from `npm test`.

---

### [x] feat: e2e coverage for command dispatch and IPC round-trip (FR-TEST-2)

Added e2e specs for the concrete non-webview-UI cases identified during intake:

1. `build-commands.test.ts` invokes "Daisy IDE: Build for Emulator" (`ds-ide.build`) and
   "Daisy IDE: Build for Hardware" (`ds-ide.buildHardware`) via `vscode.commands.executeCommand`
   against a static fixture effect project (`src/test/e2e/fixtures/basic-effect-project/`,
   opened as the test host's `workspaceFolder` via `.vscode-test.mjs`). `child_process.spawn` is
   monkey-patched at module top level — before Mocha runs any test body, which is confirmed
   (via a throwaway diagnostic check) to be before the extension's lazy activation ever
   constructs `EmulatorManager` or calls `buildForHardware` — so both `EmulatorManager`'s
   captured `this.spawn` and `buildForHardware`'s per-call `deps.spawn ?? cp.spawn` resolve to
   the stub; no real cmake/make/toolchain process ever runs. The fixture also ships a placeholder
   `fake-toolchain/arm-none-eabi-gcc` file (existence-only — `detectArmToolchain()`'s check
   never executes it) and the suite pre-sets `ds-ide.armToolchainPath`/`ds-ide.hardwareVariant`
   so the first-build variant prompt (an interactive QuickPick) is skipped. Assertions check the
   stubbed spawn actually recorded a `cmake` / `make` invocation, proving the command reached
   the real process-spawn boundary rather than failing earlier (e.g. "no effect source found").
2. `ipc-roundtrip.test.ts` connects a real `IpcClient` to a real Unix domain socket (a plain
   `net.createServer()` standing in for the emulator process — a "realistically faked" socket
   per the milestone's original scope, not a full binary spawn), sends a `midiRx`-shaped JSON
   line, and asserts it survives `parseIpcMessage()` in `src/ipc/narrow.ts` and is emitted as a
   `'message'` event. Verified against the M62 regression: temporarily deleting the `midiRx`
   narrower and rerunning reproduced the exact "dropped IPC message failing schema validation"
   warning from M62's bug report, with this spec failing; restoring the narrower turned it green
   again.

**Affected files:** `src/test/e2e/build-commands.test.ts`, `src/test/e2e/ipc-roundtrip.test.ts`,
`src/test/e2e/fixtures/basic-effect-project/` (new), `.vscode-test.mjs`

**DoD:**
- Both commands are invoked through the real `vscode.commands` API (not by calling the
  handler function directly), and the stubbed process-spawn boundary records the expected
  `cmake` (emulator) / `make` (hardware) invocation, proving each command reached that boundary
  through its real command-handler code path.
- The IPC round-trip spec fails if `src/ipc/narrow.ts` is missing a narrower for the message
  type under test (verified against the M62 regression: temporarily reverting the M62 fix
  should fail this spec).
- Both specs run under `npm run test:e2e` and pass locally without physical Daisy Seed
  hardware attached.
