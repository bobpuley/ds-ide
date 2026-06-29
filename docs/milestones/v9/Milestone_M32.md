# M32 — Extension & Emulator Correctness

**Version:** 0.9.1  
**Status:** released  
**Source:** 2026-06-28 code reviews — HIGH TS finding + impactful MEDIUM findings across all three reviews

## Goal

Fix correctness bugs that produce user-visible failures: invalid generated C++ code, false success messages on deploy, invisible settings, broken packaging, accumulating event listeners, stale listeners causing double-execution, emulator crash on bad WAV, IPC fd corruption, blocking extension host calls, and stale-process race on redeploy.

## Sprint Tasks

### [x] fix: D28 / A11 analog index in controls-writer.ts (FR-PIN-1)

`analogIndex(28)` returns 13 via `pin - 15`, generating `daisy::seed::A13` (does not exist). The correct index for D28 is 11 (`A11`).

**Affected files:** `src/wiring/controls-writer.ts`, `src/sidebar/controls-view-provider.ts`

**DoD:**
- Assigning a potentiometer to D28 generates `daisy::seed::A11` in the emitted C++ init call
- A single exported `pinToAdcChannel(pin: number): number` function handles all ADC-capable pins (D15–D25 → 0–10, D28 → 11); both `controls-writer.ts` and the webview JS use it as the sole source of truth
- The generated project compiles without error; existing tests pass

---

### [x] fix: deploy() returns deployLock on concurrent call (FR-EXT-2)

`deploy()` currently returns bare `undefined` when `this.deployLock` is set, causing callers to misinterpret the no-op as success.

**Affected files:** `src/emulator/manager.ts`, `src/commands/deploy.ts`, `src/commands/debug-deploy.ts`, `src/extension.ts`

**DoD:**
- `if (this.deployLock) return this.deployLock;` — callers await the existing promise
- Rapid double-deploy produces one "emulator running" notification and one set of post-deploy IPC messages
- Test: a second `manager.deploy()` call while one is in flight awaits the same outcome

---

### [x] fix: Add contributes.configuration for ds-ide settings (FR-EXT-3)

`ds-ide.effectSource` and `ds-ide.armToolchainPath` are read but not declared in `package.json`.

**Affected files:** `package.json`

**DoD:**
- Both settings appear in the VS Code Settings UI (search "ds-ide") with type `string`, empty default, and descriptive text
- Existing reads via `vscode.workspace.getConfiguration('ds-ide').get(...)` continue to work

---

### [x] fix: Add @vscode/vsce to devDependencies (FR-PKG-1)

`npm run package` fails on a clean machine without a globally installed `vsce`.

**Affected files:** `package.json`

**DoD:**
- `@vscode/vsce` is in `devDependencies`
- `npm ci && npm run package` succeeds from a clean state (no global vsce required)

---

### [x] fix: Remove accumulating document event listeners in controls webview (FR-EXT-5)

`buildConventionCard` and `makeDraggable` register `mousemove`/`mouseup` on `document` per card per render cycle. The listeners are never removed when cards are removed from the DOM.

**Affected files:** `src/controllers/controls-view-provider.ts` (embedded webview JS)

**DoD:**
- At the start of `renderConventionCanvas()` and `renderCanvas()`, all previously registered document-level listeners are removed via a tracked array (`clearDocListeners()`)
- After 20 re-render cycles with 4 pots, there is ≤ 1 active pair of `mousemove`/`mouseup` handlers per card kind
- Drag interaction continues to work correctly after multiple re-renders

---

### [x] fix: Track and dispose view provider event listener disposables (FR-EXT-4)

`view.webview.onDidReceiveMessage` and `view.onDidChangeVisibility` return values are silently discarded in `ControlsViewProvider` and `WiringViewProvider`.

**Affected files:** `src/sidebar/controls-view-provider.ts`, `src/sidebar/wiring-view-provider.ts`

**DoD:**
- Both disposables are stored and disposed in a `view.onDidDispose` handler
- Re-resolving a view (simulated by calling `resolveWebviewView` twice in a test) does not cause duplicate pot-change or wiring-update callbacks

---

### [x] fix: Guard against std::bad_alloc from oversized WAV files (FR-EMU-1)

`parse_wav` calls `out.samples.resize(total_samples)` with an unchecked size. A malformed WAV with `data_size ≈ 4 GB` throws `std::bad_alloc`, propagating through the IPC server and terminating the emulator.

**Affected files:** `emulator/runtime/wav_reader.cpp`, `emulator/runtime/ipc_server.cpp`

**DoD:**
- `parse_wav` validates `total_samples ≤ MAX_WAV_SAMPLES` (10 min stereo @48 kHz) before `resize`; returns a user-readable error string on violation
- Loading a WAV with `data_size = 0xFFFFFFFF` produces an error IPC event; the emulator process continues running
- A `try/catch(const std::exception&)` in `dispatch` converts any remaining unexpected exception to an error event rather than a crash

---

### [x] fix: Single authoritative ::close for IPC client fd (FR-EMU-2)

On `::send()` failure, `send_ipc` lambda and the cleanup block both call `::close(client_fd)`.

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:**
- The `::close(client_fd)` call is removed from inside the `send_ipc` lambda; only the cleanup block closes the fd
- Code inspection confirms one `::close` per connection lifetime; ASAN shows no double-close

---

### [x] fix: Replace synchronous extension host I/O with async equivalents (FR-EXT-1)

`detectArmToolchain`, `detectDfuUtil` (toolchain.ts), `findLldbDap` (debug-adapter.ts), `detectEffectSrc`/`detectDaisySP` (build.ts), `killStalePid`/`writePid`/`clearPid` (manager.ts), and `controllers.yaml` write (extension.ts) all use blocking Node.js APIs on the extension host event loop.

**Affected files:** `src/hardware/toolchain.ts`, `src/debug/debug-adapter.ts`, `src/commands/build.ts`, `src/emulator/manager.ts`, `src/extension.ts`

**DoD:**
- All synchronous `fs.*Sync` and `cp.execSync` calls are replaced with `fs.promises.*` / `cp.exec` (promisified) / `vscode.workspace.fs.*` equivalents
- The VS Code "extension host is busy" indicator does not appear during build, deploy, or debug-session init in normal operation
- All callers updated to `async`/`await`; existing test suite passes

---

### [x] fix: Wait for stale emulator process exit before spawning replacement (FR-EMU-3)

`killStalePid` sends `SIGKILL` and immediately proceeds; the new emulator may fail to acquire the socket address or audio device if the old process is still alive.

**Affected files:** `src/emulator/manager.ts`

**DoD:**
- After `SIGKILL`, a polling loop checks `process.kill(pid, 0)` with up to 200 ms timeout before proceeding
- Rapid redeploy (kill→spawn within 50 ms) does not produce "socket ready" timeout errors on a normally loaded system
