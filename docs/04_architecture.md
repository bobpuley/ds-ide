# 04 — Architecture (v21)

> **v20 complete** — full v20 architecture in
> [`docs/v20/04_architecture.md`](v20/04_architecture.md).

*v21 architecture not yet defined.*

**Bug intake note (2026-08-30, midiRx/midiTx IPC drop):** no architecture impact. The fix adds
two entries to the existing `NARROWERS` whitelist in `src/ipc/narrow.ts`, following the
established per-message-type narrower pattern (same shape as the existing `led`/`rgbLed`
entries) — it doesn't change the IPC schema-validation boundary's design (FR-IPC-2).

**Feature intake note (2026-08-30, manual test tracker, FR-TEST-1):** no architecture impact —
it's a standalone static HTML page with no build step and no runtime coupling to the extension
or emulator (not compiled, not imported, not part of the test runner). Only a project-structure
addition worth noting: `src/test/manual/manual-tests.html` is a new path under `src/test/`
that, unlike the rest of that directory, is not an automated test — it holds no `*.test.ts`
and is not picked up by the Node/TS test runner.

**Feature intake note (2026-08-30, functional/e2e test layer, FR-TEST-2):** this introduces a
second, distinct test layer alongside vitest, with its own execution model:

- **New devDependencies:** `@vscode/test-electron` (downloads/launches a real VS Code build and
  runs a test entry point inside its extension host) and `@vscode/test-cli` (the standard
  runner/config glue Microsoft ships alongside it).
- **New directory:** `src/test/e2e/` — parallel to the existing `src/test/unit/` and `src/test/
  manual/`, holding the e2e suite's entry point (`runTests.ts`) and spec files. These run
  *inside* a real Extension Development Host process, not under vitest's mocked `vscode`
  module — the two suites exercise fundamentally different things and are not interchangeable.
- **New script:** `test:e2e` in `package.json`, kept separate from `test` (vitest). Not wired
  into `test` or `lint` by default, since e2e runs are slower and download/launch real VS Code
  — deliberately opt-in, consistent with the "speed is the product" non-negotiable for the fast
  inner loop.
- **Explicit boundary:** this layer cannot assert on webview-rendered DOM content (webviews run
  in sandboxed iframes the extension host process doesn't have direct DOM access into). It can
  only call the extension's own exported webview-message-handling functions with synthetic
  messages, or assert on the extension-host side of an IPC/command round-trip. True webview-UI
  automation (pot dragging, scope canvas assertions) needs `vscode-extension-tester`
  (WebDriverIO-based), intentionally not introduced in this milestone.
- **No CI impact today** — there is no `.github/workflows/` in this repo; both test layers run
  locally via `npm run test` / `npm run test:e2e` for now.
