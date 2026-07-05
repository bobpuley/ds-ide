# M42 — Extension/Tooling Polish

**Version:** 0.13.4
**Status:** planned
**Source:** 2026-07-02 Node.js/TypeScript + VS Code extension code reviews — LOW findings

## Goal

Clear the remaining low-severity extension and tooling findings: a latent webview bundling misconfiguration, silent IPC client failures, fragile dfu-util detection, a YAML parser/scaffold mismatch, assorted type/hygiene nits, marketplace metadata inconsistencies, sync fs calls on the extension host, under-scoped settings, and thin debug-contribution polish.

## Sprint Tasks

### [ ] fix: Split esbuild config for extension vs. webview targets (FR-QA-EXT-1)

`esbuild.js` uses one `platform: 'node'` config for both the extension host and the three webview scripts — currently harmless since webviews have zero imports, but the first import added to a webview script breaks.

**Affected files:** `esbuild.js`

**DoD:** two build configs — extension (`platform: 'node'`, `external: ['vscode']`, unchanged behavior) and webviews (`platform: 'browser'`, `format: 'iife'`). This should land before or alongside FR-IPC-6 (M39) since the webview type-checking work needs webviews to safely import the shared message-protocol module.

---

### [ ] fix: Make IPC client failures observable (FR-QA-EXT-2)

`IpcClient.send()` silently no-ops when the socket is absent/destroyed; malformed JSON lines are silently discarded; a 1MB receive-buffer overflow resets without resynchronizing to the next newline.

**Affected files:** `src/emulator/ipc-client.ts`

**DoD:** a counted warn-level event is emitted on dropped sends and malformed lines; on buffer overflow, parsing skips to the next `\n` before resuming instead of consuming a garbage fragment.

---

### [ ] fix: Constrain the dfu-util success-detection workaround (FR-QA-EXT-3)

`runDfuUtil` treats stdout containing `File downloaded successfully` as success even on non-zero exit — works around a known quirk but is locale/version-fragile.

**Affected files:** `src/commands/dfu-flash.ts`

**DoD:** the non-zero-exit success path accepts only the specific known exit code(s) for "download OK, device left DFU mode"; the string match remains a secondary signal with a comment pinning the dfu-util versions verified against.

---

### [ ] fix: Align the YAML parser's recognized sections with the project scaffold (FR-QA-EXT-4)

The hand-rolled parser silently skips tab-indented lines and never reads the scaffolded `controls: []` key (it only recognizes `controllers`/`buttons`/`leds`).

**Affected files:** `src/controllers/controller-config.ts`, `src/commands/create-effect-project.ts`

**DoD:** non-blank, non-comment lines matching no parser rule produce a parse error instead of silent skipping; the scaffolded file uses `controllers:` (a key the parser actually reads) instead of `controls:`.

---

### [ ] fix: Toolchain/type hygiene cleanup (FR-QA-EXT-5)

Grab-bag: `@types/node ^20` vs. an esbuild target of `node18`; `which` detection via `cp.exec` instead of `execFile`; duplicated knob geometry constants; `hardware-build.ts` creates a fresh output channel when none is passed.

**Affected files:** `package.json`, `src/hardware/toolchain.ts`, `src/debug/debug-adapter.ts`, `src/webview/controls-webview.ts`, `src/commands/hardware-build.ts`

**DoD:** `@types/node` pinned to `^18`; `which` calls switched to `execFile`; knob geometry constants hoisted to one shared location; `buildForHardware`'s channel parameter made required.

---

### [ ] fix: Reconcile marketplace metadata (FR-QA-EXT-6)

`package.json` still declares `"version": "0.0.1"` against a CHANGELOG through 0.11.0+; the referenced icon doesn't exist; light icon variants are unused; keybindings have no `when`/`enablement` gates.

**Affected files:** `package.json`, `CHANGELOG.md`, `media/`

**DoD:** `version` synced to the latest changelog tag; icon asset added; light icon variants used or deleted; keybindings gain `when`/`enablement` gates scoped to Daisy projects (e.g. a `ds-ide.isDaisyProject` context key).

---

### [ ] fix: Replace sync fs calls on command paths; avoid full webview HTML resets (FR-QA-EXT-7)

`mkdirSync`, `readdirSync`, `statSync` run in command paths on the Extension Host; `ScopePanel.show()` reassigns `panel.webview.html` on every reveal, discarding scope/spectrum history.

**Affected files:** `src/emulator/manager.ts`, `src/commands/dfu-flash.ts`, `src/webview/scope-panel.ts`

**DoD:** sync fs calls replaced with `fs.promises` equivalents; on reveal, `ScopePanel` posts current state via `postMessage` instead of regenerating `webview.html`.

---

### [ ] fix: Declare correct `scope` for machine/workspace-specific settings (FR-QA-EXT-8)

`armToolchainPath` and `effectSource` default to `window` scope though they're machine/workspace-specific paths — Settings Sync can silently apply a desktop toolchain path on a laptop.

**Affected files:** `package.json`

**DoD:** `armToolchainPath` declares `"scope": "machine-overridable"`; `effectSource` declares `"scope": "resource"` (or documents its window-scope resolution order); both gain `markdownDescription`.

---

### [ ] fix: Improve debug contribution discoverability and responsiveness (FR-QA-EXT-9)

`daisy-debug` has no configuration snippets (manual selection dead-ends); the build+deploy step inside `resolveDebugConfiguration` has no progress UI; lldb-dap discovery covers only macOS paths.

**Affected files:** `package.json`, `src/debug/run-config-provider.ts`, `src/debug/debug-adapter.ts`

**DoD:** `daisy-debug` marked internal or given a configuration snippet; build/deploy inside `resolveDebugConfiguration` reports progress via `vscode.window.withProgress`; lldb-dap discovery extends to versioned Linux binary names on PATH.
