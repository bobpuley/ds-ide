# M37 — Extension/IPC Critical Reliability & Packaging

**Version:** 0.12.1
**Status:** released
**Source:** 2026-07-02 Node.js/TypeScript + VS Code extension code reviews — HIGH findings (deduplicated where both reviews independently flagged the same bug)

## Goal

Fix the four HIGH-severity defects that make the extension unreliable or non-functional for real users: a deploy-failure promise leak, unsafe process/socket cleanup that can kill unrelated processes or sever other windows' sessions, a packaged `.vsix` that cannot run its own core command, and generated hardware code that doesn't compile against real libDaisy. After M37, deploy failures are clean, process/socket cleanup only ever touches this workspace's own resources, the packaged extension works identically to the dev-mode extension, and wiring a pot produces code that builds for hardware.

## Sprint Tasks

### [x] fix: Observe the deploy-lock cleanup promise so failures never leak an unhandled rejection (FR-EXT-1)

`EmulatorManager.deploy()` clears its coalescing lock via `deployPromise.finally(() => { this.deployLock = null; })`. `.finally()` returns a new promise that rejects whenever `deployPromise` rejects, and nothing observes it — every failed deploy (missing build, emulator crash, socket timeout) produces an `unhandledRejection`.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- The derived cleanup promise's rejection is observed (e.g. `deployPromise.finally(...).catch(() => {})`, or an equivalent `.then(clear, clear)` pattern)
- A vitest `process.on('unhandledRejection', fail)` guard added to the test setup passes across the full deploy test suite, including forced-failure cases

---

### [x] fix: Verify process identity before SIGKILL; scope socket cleanup per-workspace (FR-EXT-2)

`killStalePid` signals whatever PID is recorded in `emu.pid` with `SIGKILL` and no identity check — after PID reuse (e.g. post-reboot) this can kill an arbitrary user process. Separately, activation deletes every `/tmp/daisy_emu_*.sock` it finds, severing other concurrently running VS Code windows' live emulator connections. Socket names are also predictable (`daisy_emu_${Date.now()}.sock`) in world-writable `/tmp`.

**Affected files:** `src/emulator/manager.ts`, `src/extension.ts`

**DoD:**
- `killStalePid` verifies the target PID's process name/command line matches `effect_emu` (e.g. via `ps -p <pid> -o comm=`) before signaling; identity mismatch skips the kill instead of proceeding
- SIGTERM is sent first with a short escalation to SIGKILL, rather than immediate SIGKILL
- Sockets and the pid file live under a per-workspace directory (not global `/tmp`) with a randomized filename component instead of a timestamp
- Activation cleanup only touches this workspace's directory, never a global `/tmp` sweep
- Two concurrent VS Code windows on two different Daisy projects both deploy and reconnect successfully without interfering with each other (manually verified before merge, per `02_assumptions-and-risks.md`)

---

### [x] fix: Include `emulator/**` in the packaged `.vsix` and fix the missing icon (FR-PKG-1)

`.vscodeignore` excludes `emulator/**` wholesale, so `buildForEmulator`'s `cmake -S <extensionPath>/emulator` has no source directory once installed from a package — every core command (Build for Emulator, Build & Deploy, F5) fails. `package.json` also references a non-existent `images/icon.png`, which fails `vsce package` outright.

**Affected files:** `.vscodeignore`, `src/commands/build.ts`, `esbuild.js`, `package.json`

**DoD:**
- `emulator/**` sources are included in the packaged extension; `emulator/**/build/**` (build output) remains excluded
- `images/icon.png` exists, or the `icon` field is removed from `package.json`
- `vsce package` succeeds
- A CI step unzips the produced `.vsix` and asserts `emulator/CMakeLists.txt` and `dist/extension.js` are both present

---

### [x] fix: Generate libDaisy-compatible ADC init code; remove the shim-only variadic overload (FR-CODEGEN-1)

The Wiring Editor emits `hardware.adc.Init(pot1, pot2, ..., N)` — separate variadic arguments — which only compiles against a shim-only catch-all `Init(Args...)` overload. Real libDaisy's `AdcHandle::Init` takes `(AdcChannelConfig* cfg, size_t num_channels)`. Any project with a wired pot fails `ds-ide.buildHardware`.

**Affected files:** `src/wiring/controls-writer.ts`, `emulator/shim/include/daisy/adc_handle.h`

**DoD:**
- Generated code declares `AdcChannelConfig ds_ide_adc_cfg[N]`, calls `.InitSingle(daisy::seed::A<n>)` per pot, and calls `hardware.adc.Init(ds_ide_adc_cfg, N)` — matching the documented libDaisy pattern
- The shim's variadic `Init(Args...)` overload is removed from `adc_handle.h`
- A project with one or more wired pots passes `ds-ide.buildHardware` (real ARM toolchain compile) with no ADC-related errors
- The same generated code continues to build and run correctly against the emulator
