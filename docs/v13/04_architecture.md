# 04 — Architecture (v13)

> **v12 complete** — full v12 architecture in
> [`docs/v12/04_architecture.md`](v12/04_architecture.md).

## v13 Architecture Notes

### Overall system design — unchanged

The two-process architecture (VS Code extension ↔ native emulator process over a UNIX domain socket) is unchanged across v11–v13. No new processes and no IPC transport changes are required; several fixes change *what* is sent over existing channels or *where in the codebase* work happens, not the transport itself.

---

### Webview build & type-checking split (new — v12 / M39 + v13 / M42, FR-IPC-6 / FR-QA-EXT-1)

Two related changes land together since they touch the same files:
- **Type-checking:** webviews get their own `tsconfig.webview.json` (`lib: ["ES2022", "DOM"]`, using the existing `webview-api.d.ts` shim) so `@ts-nocheck` can be removed; the host↔webview message protocol becomes a shared discriminated union imported by both the extension host and webview bundles.
- **Bundling:** `esbuild.js` splits into two build configs — extension (`platform: 'node'`, `format: 'cjs'`, `external: ['vscode']`, unchanged) and webviews (`platform: 'browser'`, `format: 'iife'`, `target: 'chrome114'`-equivalent). This is required *before* the webviews can safely import the shared message-protocol types module, since a Node-platform bundle would resolve/emit incorrectly for browser-context code the moment webview scripts gain an import.

No new build tool is introduced — `esbuild` already supports multiple entry configs (as `esbuild.js` demonstrates for extension vs. webview entry *points*; the fix is giving them separate *options*, not separate tooling).

---

### No other architectural changes

The remaining v13 fixes are localized to their implementation files and require no architectural decisions:

- `System::Delay` drift, pot clamping, `PrintLine` fidelity, build flags: localized to `emulator/runtime/core_audio_device.cpp`, `emulator/shim/src/*`, `emulator/CMakeLists.txt`.
- `json_get` escape handling: localized to `emulator/runtime/ipc_server.cpp` (a real JSON tokenizer would be an architecture change; the minimum fix applied here is not).
- Marketplace metadata, configuration `scope` declarations, debug contribution snippets/progress UI: `package.json`-only or single-file changes.
