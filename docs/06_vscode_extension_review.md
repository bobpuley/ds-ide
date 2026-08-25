# Review Report

## Multi-root workspace: debug-attach flow bypasses the active-folder selection

### Description
The codebase has a deliberate, well-documented mechanism for multi-root workspace support: `resolveActiveFolder()` (`src/workspace/active-folder.ts`) centralizes "which workspace folder does ds-ide operate on," backed by a persisted user choice (`ds-ide.selectActiveFolder`), and essentially every command/handler in `extension.ts` routes through it instead of assuming `workspaceFolders[0]`. Two call sites were missed and still hardcode `workspaceFolders[0]`:

- `src/commands/debug-deploy.ts:39` — `const folder = vscode.workspace.workspaceFolders?.[0];` passed as the `folder` argument to `vscode.debug.startDebugging(folder, ...)` for the `daisy-debug` attach session (the `ds-ide.debug` command path).
- `src/debug/run-config-provider.ts:42` — same pattern, in `DaisyRunConfigurationProvider.resolveDebugConfiguration` (the F5 / `ds-ide` launch-configuration path).

### Evidence
```ts
// src/commands/debug-deploy.ts:39
const folder = vscode.workspace.workspaceFolders?.[0];
const started = await vscode.debug.startDebugging(folder, {
  type: DAISY_DEBUG_TYPE,
  name: 'Daisy Debug',
  request: 'attach',
  pid,
});
```
```ts
// src/debug/run-config-provider.ts:42
const folder = vscode.workspace.workspaceFolders?.[0];
const started = await vscode.debug.startDebugging(folder, {
  type: DAISY_DEBUG_TYPE,
  request: 'attach',
  name: 'Daisy Debug',
  pid,
});
```
Contrast with the rest of `extension.ts`, which consistently does `resolveActiveFolder(context.workspaceState)` before any workspace-scoped operation (e.g. `initViewsFromProject`, the `onDidSaveTextDocument` handler, every wiring/controls callback).

### Impact
In a multi-root workspace where the user has explicitly selected a non-first folder as the active ds-ide project (via `ds-ide.selectActiveFolder`), build/deploy/emulator operations correctly target that folder, but the resulting debug session is associated with `workspaceFolders[0]` instead. `vscode.debug.startDebugging`'s `folder` argument affects the session's resolved workspace context (variable substitution such as `${workspaceFolder}` inside any debug-related resolution, and folder-scoped debug configuration/launch behavior). This is a silent mismatch: the emulator process being attached to is correct (PID-based), but the *debug session's* folder association is wrong, which can surface as incorrect path resolution for source mapping or breakpoints in edge cases involving folder-relative debug settings, and is simply inconsistent with the active-folder model the rest of the extension enforces.

### Affected Files
- src/commands/debug-deploy.ts
- src/debug/run-config-provider.ts

### Recommended Fix
Thread `resolveActiveFolder(workspaceState)` (or the already-resolved active folder) into both call sites instead of `workspaceFolders?.[0]`. `debugDeploy()` and `DaisyRunConfigurationProvider` would need a `vscode.Memento` (or the resolved `vscode.WorkspaceFolder`) passed in via their constructors/parameters, mirroring how `DeployCoordinator` and the wiring/controls handlers already receive `context.workspaceState`.

### Urgency Level
MEDIUM

---

## Host MIDI bridge performs synchronous native-addon load and port I/O during `activate()`

### Description
`HostMidiBridge.start()` is invoked unconditionally and synchronously inside `activate()` (`src/extension.ts:586`, `hostMidiBridge.start();`). On macOS, `start()` synchronously `require()`s the native `midi` addon, calls `getPortCount()`, and then for every enumerated port calls `inputFactory()` + `openPort(i)` — all before `activate()` returns.

### Evidence
```ts
// src/extension.ts:584-586
const midiPanel = new MidiPanel(context.extensionUri, manager);
const hostMidiBridge = new HostMidiBridge(manager);
hostMidiBridge.start();
```
```ts
// src/midi/host-bridge.ts:44-66
start(): void {
  if (this.platform !== 'darwin') return;
  let probe: MidiInputLike;
  try {
    probe = this.inputFactory();   // require('midi') — native addon load
  } catch (err) { ... return; }
  const count = probe.getPortCount();
  for (let i = 0; i < count; i++) {
    const input = this.inputFactory();
    input.openPort(i);              // native, synchronous, per port
    ...
  }
}
```
The failure path is safe (try/catch, degrades gracefully per the M51 changelog entry), but nothing here is deferred or lazy — every activation on macOS pays the cost of loading the native addon and opening every connected MIDI port, regardless of whether the user ever opens the MIDI panel or has an effect that uses MIDI.

### Impact
Native addon loading and per-port `openPort()` calls are synchronous C++ calls into the Extension Host's single thread; if MIDI driver/port enumeration is slow (common with class-compliant USB-MIDI hardware, virtual ports, or IAC buses on macOS) or many ports are present, this directly extends `activate()` wall-clock time, which VS Code surfaces to the user as extension-activation latency. This is worth deferring given the project's own emphasis elsewhere on lazy loading (the class comment explicitly notes the addon "is loaded lazily via the injectable `inputFactory`, never at module load time" — but that only protects against a broken *binary*, not against slow *activation-time* I/O).

### Affected Files
- src/extension.ts
- src/midi/host-bridge.ts

### Recommended Fix
Defer `hostMidiBridge.start()` off the synchronous activation path — e.g. schedule it via `setImmediate`/a microtask after `activate()` returns, or lazily start it the first time a MIDI-capable peripheral is enabled / the MIDI panel is shown (mirroring the existing lazy patterns for `showOledIfEnabled`/`showMidiIfEnabled`). This keeps the "never blocks activation" guarantee the code already aims for, but currently only partially delivers.

### Urgency Level
LOW

---

## Out of scope

Actual marketplace publication, UX evaluation, visual design review, localization quality, third-party extension compatibility testing, end-user workflow validation, large-repo benchmarking.
