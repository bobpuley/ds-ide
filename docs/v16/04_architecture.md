# 04 — Architecture (v16)

> **v15 complete** — full v15 architecture in
> [`docs/v15/04_architecture.md`](v15/04_architecture.md).

## Intake notes

- **FR-DEV-19 (host MIDI bridge native-addon ABI fix):** small build-tooling addition, no
  extension-runtime data-flow change — `host-bridge.ts` itself is untouched. `midi`'s native addon
  is built with NAN (`node_modules/midi/binding.gyp` depends on `nan`), not N-API/Node-API — NAN
  addons are **not** ABI-stable across Node versions, so unlike an N-API addon this can't be fixed
  by a dependency swap alone; it must be rebuilt against Electron's exact ABI whenever VS Code's
  bundled Electron/Node.js version changes, both for local dev and for whatever ships in the
  packaged `.vsix`. The standard mechanism is `@electron/rebuild` (new devDependency) run as a
  `postinstall`/`vscode:prepublish` step. Not designed further here — the concrete target-Electron-
  version resolution strategy (e.g. pinning an `electron` devDependency purely as a version anchor
  vs. another mechanism) is not decided yet; resolve it when M51 starts. `scripts/verify-vsix.sh`
  (FR-PKG-1) already asserts the addon file is present in the packaged layout but never asserted
  ABI compatibility — extending it to also assert the rebuilt binary's `NODE_MODULE_VERSION`
  matches the target is in scope for M51's DoD.
