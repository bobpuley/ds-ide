# M51 — Host MIDI Bridge Native-Addon ABI Fix

**Version:** 0.16.0
**Status:** planned
**Source:** bug report — 2026-07-25 intake session (extension-startup console warning after a
VS Code update)

## Goal

Today `node_modules/midi/build/Release/midi.node` is compiled against whatever plain Node.js ran
`npm install`/`npm run package`, not against the Electron ABI VS Code's Extension Host actually
runs — so an ordinary VS Code update that bumps its bundled Electron/Node.js version silently
breaks the host MIDI bridge (`ds-ide: MIDI host bridge unavailable — ... NODE_MODULE_VERSION
mismatch`) until someone manually rebuilds it. After this milestone, the native addon is rebuilt
against Electron's ABI as a standard, repeatable step — for local dev and for the packaged
`.vsix` — so the bridge survives ordinary VS Code updates without manual intervention.

## Sprint Tasks

### [ ] fix: rebuild the host MIDI bridge's native addon against Electron's ABI (FR-DEV-19)

`midi`'s native addon uses NAN (`node_modules/midi/binding.gyp` depends on `nan`), not
N-API/Node-API — NAN addons are not ABI-stable across Node versions, so this can't be fixed by a
dependency swap; it must be rebuilt against Electron's exact ABI. Add `@electron/rebuild` as a
devDependency and a rebuild step (`postinstall` and/or `vscode:prepublish`) that targets the
Electron ABI VS Code actually uses — resolve the concrete target-version-resolution mechanism
(e.g. an `electron` devDependency used purely as a version anchor, vs. another approach) when this
task starts. Extend `scripts/verify-vsix.sh` (FR-PKG-1) to also assert the packaged binary's
`NODE_MODULE_VERSION` matches the target, not just that the file is present.

**Affected files:** `package.json`, `scripts/verify-vsix.sh`, `src/midi/host-bridge.ts` (no
behavior change expected — read during the fix to confirm the try/catch degradation still applies
as the last-resort fallback if a rebuild step is ever skipped or fails)

**DoD:**
- A fresh `npm install` on a machine with a different Node.js version than VS Code's Electron
  ABI still leaves `midi.node` loadable by VS Code's Extension Host (no `NODE_MODULE_VERSION`
  mismatch at activation).
- The packaged `.vsix` ships a `midi.node` binary that matches VS Code's Electron ABI, verified by
  an assertion in `scripts/verify-vsix.sh`, not just the file's presence.
- `host-bridge.ts`'s existing try/catch degradation (no crash, "bridge unavailable" warning) is
  confirmed still in place as a fallback, in case a rebuild step is ever skipped or fails on an
  unsupported platform/arch.
- No regression to the macOS-only gate or any other FR-DEV-18 behavior.
