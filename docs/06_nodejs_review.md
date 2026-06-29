# Node.js / TypeScript Code Review

**Date:** 2026-06-28
**Scope:** ./src/
**Reviewer:** Automated static review

## Summary

**HIGH: 1 | MEDIUM: 7 | LOW: 6**

The codebase is well-structured and type-safe at the macro level (strict TypeScript, no `any`, good test coverage for pure functions). The most critical issue is a correctness bug in the analog pin index calculation that silently generates invalid C++ code for a specific Daisy Seed pin. Medium-priority issues centre on synchronous subprocess invocations on the extension host event loop, unsafe cast chains on message payloads, missing socket file cleanup, and two large files that embed hundreds of lines of untyped JavaScript in template strings.

---

## HIGH Findings

## Pin D28 Analog Index Generates Invalid C++ Code

### Description
`controls-writer.ts` contains `analogIndex(pin: number) => pin - 15` which is used to produce `daisy::seed::A<n>` identifiers in the generated `InitSingle` call. This formula is correct for pins D15–D25 (A0–A10), but pin D28 (the only non-sequential ADC pin, alias A11) produces `28 - 15 = 13` and writes `daisy::seed::A13` into the user's source file. `A13` does not exist in the libDaisy API; the generated project will fail to compile with a cryptic "no member named 'A13' in namespace 'daisy::seed'" error.

### Evidence
```
// src/wiring/controls-writer.ts  lines 53–65
function analogIndex(pin: number): number {
  return pin - 15;       // D28 → 13, should be 11
}

function initCallLine(id: string, kind: DeviceKind, pin: number): string {
  if (kind === 'pot') {
    return `  ${id}.InitSingle(daisy::seed::A${analogIndex(pin)});`;
  }
  ...
}
```

Compare with the webview JS in `controls-view-provider.ts` (lines 414–418) which correctly handles D28:
```js
function adcChannelFromPin(pin) {
  if (pin >= 15 && pin <= 25) return pin - 15;
  if (pin === 28) return 11;   // correct special case — absent in TS
  return 0;
}
```
The wiring panel `PIN_DEFS` (wiring-panel.ts line 60) confirms D28 is ADC-capable and labelled A11.

### Impact
Any user who assigns a potentiometer to D28 (the A11/D28 pin — prominently labelled in the wiring editor as "A11") receives broken generated code. The project will not compile; the error message gives no indication of the true cause.

### Affected Files
- `src/wiring/controls-writer.ts`

### Recommended Fix
Add the D28 special case to `analogIndex`:
```typescript
function analogIndex(pin: number): number {
  if (pin === 28) return 11;   // D28 is A11 on Daisy Seed
  return pin - 15;
}
```
Then unify the two implementations: export a shared `pinToAdcChannel` helper from a single place (`controls-convention-parser.ts` or a new `pin-utils.ts`) and import it in both `controls-writer.ts` and the webview HTML builder in `controls-view-provider.ts`.

### Urgency Level
HIGH

---

## MEDIUM Findings

## Synchronous `execSync` Calls Block the Extension Host Event Loop

### Description
`detectArmToolchain`, `detectDfuUtil` (in `toolchain.ts`), and `findLldbDap` (in `debug-adapter.ts`) all call `cp.execSync` to run `which <binary>` or `xcrun --find lldb-dap`. These functions are invoked inside VS Code command handlers and the debug adapter descriptor factory — both of which run on the extension host's single JavaScript event loop. `execSync` is a blocking system call; while it executes, no other extension host callbacks can be serviced.

### Evidence
```
// src/hardware/toolchain.ts  lines 43–46
const result = execSync(`which ${ARM_GCC_BINARY} 2>/dev/null`).toString().trim();

// src/debug/debug-adapter.ts  lines 17–18
const result = execSync('xcrun --find lldb-dap 2>/dev/null').toString().trim();
```
Both are called synchronously from their respective callers (`buildForHardware`, `createDebugAdapterDescriptor`).

### Impact
On slow filesystems, network drives, or when `xcrun` performs certificate checks (common on first macOS launch), these calls can stall for several hundred milliseconds or more. The VS Code extension host process becomes unresponsive for that duration, blocking all other extension operations.

### Affected Files
- `src/hardware/toolchain.ts`
- `src/debug/debug-adapter.ts`

### Recommended Fix
Replace with async equivalents (`exec` from `node:child_process/promises`) and `await` them. Update callers to `async`. For `findLldbDap`, since it is called from a synchronous VS Code API (`createDebugAdapterDescriptor`), pre-compute and cache the result on extension activation using an async startup scan, or wrap in a `Promise`-based descriptor factory that VS Code supports.

### Urgency Level
MEDIUM

---

## Unsafe `as unknown as vscode.DebugProtocolMessage` Cast Chain

### Description
`DsIdeTerminatingAdapter.handleMessage` in `run-config-provider.ts` constructs DAP response and event objects as plain object literals and fires them through `this._emitter.fire(... as unknown as vscode.DebugProtocolMessage)`. The double-cast (`as unknown as T`) deliberately bypasses TypeScript's structural checker. If the internal VS Code DAP message shape changes, or if the object fields diverge from what VS Code's debug session consumer expects, the adapter will silently emit malformed messages with no compile-time warning.

### Evidence
```
// src/debug/run-config-provider.ts  lines 67–78
this._emitter.fire({
  type: 'response',
  command: req.command,
  request_seq: req.seq,
  seq: ++this._seq,
  success: true,
  body: {},
} as unknown as vscode.DebugProtocolMessage);
```
The pattern appears twice (response + event).

### Impact
If the emitted object structure does not satisfy VS Code's internal runtime expectations, the debug session may hang, show confusing errors, or silently drop the terminate sequence. The adapter is intended as a "safety net" path, but because the real flow relies on `resolveDebugConfiguration` returning `undefined` first, a timing edge case could route through this code.

### Affected Files
- `src/debug/run-config-provider.ts`

### Recommended Fix
Define a local interface for the DAP wire format that the `@types/vscode` package does expose (`vscode.DebugProtocolMessage` is intentionally opaque). Consider using the `vscode-debugadapter` npm package's `DebugSession` types, or cast to `Record<string, unknown>` only and document the intent explicitly. At minimum replace `as unknown as vscode.DebugProtocolMessage` with a single intermediate `Record<string, unknown>` cast that does not suppress useful diagnostics.

### Urgency Level
MEDIUM

---

## Unvalidated Type Casts on IPC and Webview Messages

### Description
Throughout the codebase, messages received from the emulator process (via the IPC socket) and from webviews are cast to concrete types without runtime validation. `IpcMessage` is typed as `Record<string, unknown>`, so every field access must be narrowed before use. Instead, the code performs direct casts: `msg['running'] as boolean`, `msg['kind'] as string`, `m['input'] as AudioInputSource`, `m['sampleRate'] as number`, and many others.

### Evidence
```
// src/extension.ts  lines 222–231
const kind = msg['kind'] as string;
const running = msg['running'] as boolean;

// src/webview/scope-panel.ts  lines 121–123
const input = m['input'] as AudioInputSource;
const sampleRate = m['sampleRate'] as number;
const bufferSize = m['bufferSize'] as number;
```
The webview at least validates `sampleRate` and `bufferSize` against allowlists (lines 125–130), but the type is asserted before validation, meaning TypeScript will not warn if `sampleRate` is actually a string `"48000"` sent by a buggy webview.

### Impact
A bug in the emulator (or a user-crafted test harness sending malformed IPC) could produce `undefined`, `null`, or wrong-typed values that reach TypeScript code expecting a specific type. Downstream consumers of these values (status bar text, audio mode commands) would behave incorrectly or crash with obscure runtime errors.

### Affected Files
- `src/extension.ts`
- `src/webview/scope-panel.ts`
- `src/sidebar/controls-view-provider.ts`
- `src/emulator/manager.ts`

### Recommended Fix
Add narrow helpers:
```typescript
function getString(msg: IpcMessage, key: string): string | undefined {
  const v = msg[key];
  return typeof v === 'string' ? v : undefined;
}
```
Apply a guard before each cast. For webview messages, validate before branching rather than after. The audioSource handler in `scope-panel.ts` is already close — move the allowlist check before the cast.

### Urgency Level
MEDIUM

---

## UNIX Socket File Not Cleaned Up on Dispose or Crash

### Description
`EmulatorManager.deploy` creates a UNIX domain socket at `/tmp/daisy_emu_${Date.now()}.sock`. The `dispose()` method kills the child process and disconnects the IPC client, but never unlinks the socket file. Repeated deploy cycles (build, deploy, rebuild, deploy) or extension crashes each leave an orphan `.sock` file in `/tmp`.

### Evidence
```
// src/emulator/manager.ts  line 89
const socketPath = `/tmp/daisy_emu_${Date.now()}.sock`;
```
```
// src/emulator/manager.ts  lines 221–225  — dispose() does NOT unlink socketPath
dispose(): void {
  this.killExisting();
  this.ipcClient?.disconnect();
  this.ipcClient = null;
}
```
`socketPath` is a local variable inside `deploy()`; it is never stored on the class, so `dispose()` cannot unlink it even if it wanted to.

### Impact
Lingering socket files accumulate in `/tmp` across sessions. In long-running development sessions (dozens of deploys per day) `/tmp` accumulates many stale socket files. On macOS, where `/tmp` points to `/private/tmp`, these also consume directory entries in a memory-backed tmpfs.

### Affected Files
- `src/emulator/manager.ts`

### Recommended Fix
Store `socketPath` as a class field (`private socketPath: string | null = null`). In `killExisting()`, after killing the process, unlink:
```typescript
if (this.socketPath) {
  try { fs.unlinkSync(this.socketPath); } catch { /* already gone */ }
  this.socketPath = null;
}
```

### Urgency Level
MEDIUM

---

## Deploy Initialization Sequence Duplicated in `extension.ts`

### Description
The code that sends the full emulator state after a successful deploy (pot snapshot, button snapshot, sine params, audio mode, audio device, optional WAV file) is copy-pasted verbatim in two places: inside `performBuildAndDeploy()` (lines 283–291) and inside the `ds-ide.deploy` command handler (lines 413–421). The two blocks are identical at the time of writing but will inevitably diverge as features are added.

### Evidence
```
// src/extension.ts  lines 283–291 (inside performBuildAndDeploy)
manager.sendPotSnapshot(potStore.getSnapshot());
manager.sendButtonSnapshot(buttonStore.getSnapshot());
manager.sendSine(sineState.freq, sineState.amplitude);
const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
manager.sendAudioMode(mode);
manager.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
  manager.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
}

// src/extension.ts  lines 413–421 — identical block inside ds-ide.deploy handler
```

### Impact
Any new IPC message that must be sent after deploy (e.g., a new feature added to the emulator) requires updating both blocks. Missing one causes a subtle behaviour difference between "build+deploy" and "deploy only" flows.

### Affected Files
- `src/extension.ts`

### Recommended Fix
Extract a private `sendPostDeployState()` function and call it from both sites:
```typescript
function sendPostDeployState(): void {
  manager.sendPotSnapshot(potStore.getSnapshot());
  manager.sendButtonSnapshot(buttonStore.getSnapshot());
  manager.sendSine(sineState.freq, sineState.amplitude);
  const mode = audioSourceState.input === 'live' ? 'realtime' : 'simulated';
  manager.sendAudioMode(mode);
  manager.sendAudioDevice(audioSourceState.sampleRate, audioSourceState.bufferSize);
  if (audioSourceState.input === 'wav' && audioSourceState.wavPath) {
    manager.sendWavFile(audioSourceState.wavPath, audioSourceState.wavLoop);
  }
}
```

### Urgency Level
MEDIUM

---

## Oversized Files With Large Blocks of Untyped Embedded JavaScript

### Description
`controls-view-provider.ts` (604 lines) and `scope-panel.ts` (722 lines) each embed several hundred lines of vanilla JavaScript inside TypeScript template-string HTML. The embedded JS is not type-checked, not linted, and not tested directly. Functions like `buildKnobSvg`, `renderConventionCanvas`, `drawSpectrum`, and `setRecordingState` exist only inside these strings.

### Evidence
- `src/sidebar/controls-view-provider.ts`: approx. 400 lines of inline JS in `buildHtml()` starting at line 192.
- `src/webview/scope-panel.ts`: approx. 320 lines of inline JS in `buildHtml()` starting at line 396.
- `src/wiring/wiring-panel.ts` (455 lines): entire SVG builder and interaction logic embedded inline.

The `truncId` function, for example, is exported from `controls-view-provider.ts` (line 99) and then re-implemented verbatim inside the same file's embedded JS string (line 315).

### Impact
Bugs in the embedded JS are only caught at runtime. Type errors, refactoring renames, and API changes in TypeScript source do not propagate to the embedded strings. The files are large enough that a new contributor cannot easily reason about the full execution flow.

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/webview/scope-panel.ts`
- `src/wiring/wiring-panel.ts`

### Recommended Fix
Extract the webview JavaScript into separate `.ts` files under `src/webview/` and bundle them with esbuild using a dedicated webview entry point (already configured via `esbuild.js`). The extension host TypeScript can reference the compiled output URI via `panel.webview.asWebviewUri(...)`. This allows type-checking, testing, and linting of the webview code.

### Urgency Level
MEDIUM

---

## `SIGKILL` Sent to Stale PID Without Waiting for Process Exit

### Description
`killStalePid` in `manager.ts` calls `process.kill(pid, 'SIGKILL')` and then immediately continues. There is no `waitpid` or delay before the next emulator process is spawned. On a heavily loaded system, the killed process may still hold the UNIX domain socket address or audio device handle when the new process tries to acquire the same resources.

### Evidence
```
// src/emulator/manager.ts  lines 11–19
function killStalePid(buildDir: string): void {
  const pidFile = pidFilePath(buildDir);
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGKILL');   // fire and forget
  } catch { /* ignore */ }
  try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
}
```
`killStalePid` is called and immediately followed by `this.killExisting()` and then `this.spawn(exePath, ...)` with no delay between signal and spawn.

### Impact
Under normal macOS conditions, `SIGKILL` termination is near-instantaneous and this race is rarely observed. However, under memory pressure (the OS may delay signal delivery), the race can cause the new emulator to fail to bind its socket or open the audio device, producing a confusing "Emulator exited with code 1 before socket ready" error.

### Affected Files
- `src/emulator/manager.ts`

### Recommended Fix
After `SIGKILL`, add a brief wait. A pragmatic approach is a short `await`-based polling loop that checks whether the PID is still alive using `process.kill(pid, 0)`, with a 200 ms timeout before proceeding regardless.

### Urgency Level
MEDIUM

---

## LOW Findings

## Unnamed Magic Numbers Scattered Across Source

### Description
Several literal numbers are used directly in code without named constants: `10000` (deploy socket timeout in `manager.ts` line 101), `1 << 20` (IPC buffer limit in `ipc-client.ts` line 55), `50` (DAP termination delay in `run-config-provider.ts` line 84), the string `'-j4'` (CMake parallel jobs in `manager.ts` line 78).

### Impact
Maintenance: the timeout value is the only signal that "we wait 10 seconds before giving up". `-j4` hard-codes parallelism regardless of available CPU cores.

### Affected Files
- `src/emulator/manager.ts`
- `src/emulator/ipc-client.ts`
- `src/debug/run-config-provider.ts`

### Recommended Fix
Extract to named constants: `const SOCKET_TIMEOUT_MS = 10_000`, `const IPC_MAX_BUFFER = 1 << 20`, `const DAP_TERMINATE_DELAY_MS = 50`. Replace `'-j4'` with `String(os.cpus().length)` for better multi-core utilisation.

### Urgency Level
LOW

---

## `truncId` Function Duplicated Between TypeScript Export and Embedded Webview JS

### Description
`truncId` is exported from `controls-view-provider.ts` at line 99 and then re-implemented identically inside the same file's `buildHtml` string literal at line 315.

### Evidence
```
// src/sidebar/controls-view-provider.ts  line 99
export function truncId(id: string): string {
  return id.length > 15 ? id.slice(0, 14) + '…' : id;
}

// same file, inside the JS string at line 315
function truncId(id) {
  return id.length > 15 ? id.slice(0, 14) + '…' : id;
}
```

### Impact
If the truncation logic ever changes (different threshold, different ellipsis character), one copy will be updated and the other missed, causing a visual inconsistency between the TypeScript host path and the running webview.

### Affected Files
- `src/sidebar/controls-view-provider.ts`

### Recommended Fix
Inject the value via a `safeJson`-escaped constant in the HTML string (same pattern used for `_yamlInit`), or address this as part of the broader webview-JS extraction work.

### Urgency Level
LOW

---

## `adcChannelFromPin` Diverged Between Webview JS and TypeScript

### Description
Two separate implementations map a Daisy Seed GPIO pin to an ADC channel index. The JavaScript `adcChannelFromPin` embedded in `controls-view-provider.ts` (line 414) correctly handles pin D28 → channel 11. The TypeScript `analogIndex` in `controls-writer.ts` (line 53) uses `pin - 15` without the D28 special case. This is the root cause of the HIGH finding above, tracked separately here as an architectural coupling issue.

### Affected Files
- `src/sidebar/controls-view-provider.ts`
- `src/wiring/controls-writer.ts`

### Recommended Fix
See the HIGH finding. A single shared module with a `pinToAdcChannel(pin: number): number` export eliminates all divergence.

### Urgency Level
LOW

---

## `findEffectSource` Mixes Sync and Async `fs` APIs

### Description
In `build.ts`, `detectEffectSrc` uses synchronous `fs.readdirSync` (line 76). In `extension.ts`, `findEffectSource` implements a similar search using `fs.promises.readdir` (line 39). Both functions solve the same problem (find the user's `.cpp` file) using different I/O strategies, and they also diverge in search scope: `build.ts` checks root, `src/`, and `source/` subdirectories; `extension.ts` only checks root.

### Impact
Minor inconsistency and latent risk that the two discovery paths will return different results in edge cases.

### Affected Files
- `src/commands/build.ts`
- `src/extension.ts`

### Recommended Fix
Consolidate into a single exported `findEffectSource(projectRoot: string): Promise<string | undefined>` in a shared module and use it everywhere.

### Urgency Level
LOW

---

## `detectNonPortableSymbol` Returns Only the First Undefined Symbol

### Description
In `non-portable.ts`, `detectNonPortableSymbol` iterates build lines and returns as soon as the first `undefined reference` match is found. If a user's effect source file uses multiple hardware-only symbols, only the first is surfaced in the error message.

### Evidence
```
// src/diagnostics/non-portable.ts  lines 9–17
for (const line of buildLines) {
  const m = UNDEF_CLANG_RE.exec(line) ?? UNDEF_GNU_RE.exec(line);
  if (m) {
    const sym = m[1]!.replace(/^_/, '');
    return sym;   // early return on first match
  }
}
```

### Impact
Users see "symbol 'X' is not emulated" but may miss additional symbols, requiring multiple build-fix cycles.

### Affected Files
- `src/diagnostics/non-portable.ts`

### Recommended Fix
Return `string[]` instead of `string | undefined`, collect all matches, and display them joined in the error message.

### Urgency Level
LOW

---

## No Test Coverage for `extension.ts` Activation Lifecycle

### Description
The `activate()` function in `extension.ts` is the entry point for the entire extension. It wires up all commands, view providers, and event listeners. The existing test suite covers individual modules (`build.ts`, `deploy.ts`, `manager.ts`, etc.) thoroughly, but the activate/deactivate lifecycle and the command-handler closures that compose those modules are not tested.

### Affected Files
- `src/extension.ts`
- `src/test/unit/extension.test.ts`

### Impact
Regressions in command registration, disposable management, or view-provider wiring will only be caught during manual QA. The mutual-exclusion guard (`_exclusionGuard`) for sidebar panel visibility is particularly fragile and not tested.

### Recommended Fix
Add integration tests for `activate()` using the VS Code mock already present in `src/__mocks__/vscode.ts`. Cover: all command IDs are registered, `onDidSaveTextDocument` is subscribed, and `deactivate()` triggers disposal.

### Urgency Level
LOW

---

## Out of Scope

This review does NOT include:

* Production infrastructure
* Cloud configuration
* Database tuning
* Third-party package source-code auditing
* Performance benchmarking
* Frontend UI correctness
* Formal security penetration testing
