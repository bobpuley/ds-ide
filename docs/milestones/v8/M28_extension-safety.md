# M28 — Webview Security Hardening

**Semver:** 0.9.0  
**Status:** planned  
**Source:** `docs/06_nodejs_review.md` + `docs/06_vscode_extension_review.md` (2026-06-21)

Covers the two HIGH-urgency security findings from the code review: CSP/nonce on all webviews and host-side validation of incoming webview messages before any workspace write.

---

## Sprint Tasks

- [x] **FR-ES-1 · AC-60** — Add CSP nonce to all three webviews (ScopePanel, ControlsViewProvider, WiringViewProvider). Generate `crypto.randomBytes(16).toString('base64')` nonce per instantiation; add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline';">` and `nonce` attribute on every `<script>` tag. Set `localResourceRoots: []` on all WebviewPanel/WebviewView options that load no file resources. Thread the nonce as a parameter into `buildHtml()` functions in `scope-panel.ts`, `controls-view-provider.ts`, and `wiring-panel.ts`. *DoD: VS Code Developer Tools shows no CSP violation for any webview; HTML source has meta tag and nonce-bearing script tags.*

- [x] **FR-ES-2 · AC-61** — Validate all incoming webview message fields before side-effecting operations. In `wiring-view-provider.ts`: guard `pinNumber` (finite int 0–31), `deviceType` (one of `'pot' | 'button' | 'led'`), `id` (matches `^[a-zA-Z_][a-zA-Z0-9_]*$`). In `controls-view-provider.ts`: pass received `cfg` through `parseControllerConfig(serializeControllerConfig(cfg))` before calling `onEditorSave`. In `scope-panel.ts`: validate `sampleRate` ∈ `[8000, 22050, 44100, 48000]` and `bufferSize` is a power of two in `[64, 512]`. Drop invalid messages silently. *DoD: crafted messages with invalid id, pinNumber > 31, and malformed cfg are all dropped without writing to source files or YAML.*
