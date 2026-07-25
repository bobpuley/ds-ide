# 03 — Requirements (v16)

> **v15 complete** — all v15 requirements implemented; ACs green.
> Archived: [`docs/v15/03_requirements.md`](v15/03_requirements.md).

### M51 — Host MIDI Bridge Native-Addon ABI Fix

**FR-DEV-19 — Host MIDI bridge's native addon stays ABI-compatible with VS Code's Electron
runtime across ordinary VS Code updates**
FR-DEV-18 ("a host MIDI bridge on macOS") was silent on how the bridge's native addon (`midi`,
RtMidi bindings) stays loadable as VS Code's bundled Electron/Node.js version changes — a doc gap
this bug closes. `node_modules/midi/build/Release/midi.node` is currently compiled against
whatever plain Node.js ran `npm install`/`npm run package`, not against Electron's actual
`NODE_MODULE_VERSION` — so any VS Code update that bumps its bundled Electron (independent of the
extension's own release cadence) breaks the addon's ABI and the bridge degrades to silently
unavailable (by design, per `host-bridge.ts`'s existing try/catch — no crash, but no host MIDI
input either) until someone manually rebuilds it. Fix: rebuild the addon against Electron's ABI
(not system Node's) as a standard, repeatable step — both for local dev (so a contributor hitting
this can self-serve a fix) and for the packaged `.vsix` (so end users never hit it after an
ordinary VS Code update, matching FR-DEV-18's macOS-only host bridge intent).
