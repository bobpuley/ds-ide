# M83 — Cross-Platform MIDI Bridge & Per-Platform VSIX

**Version:** 0.25.0-win.7
**Status:** planned
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m83-midi-and-platform-vsix` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

The host MIDI bridge is gated to macOS in three places and the VSIX carries a single prebuilt native binary. After this milestone the bridge works on Windows, the native-addon rebuild is a Node script that targets the current OS and architecture, and the extension is packaged as one VSIX per platform, each smoke-tested in CI.

## Sprint Tasks

### [x] feat: lift the macOS gate of the host MIDI bridge (FR-WIN-MIDI-1)

The gate exists in `host-bridge.ts` (`platform !== 'darwin'`), in `rebuild-midi-native.sh` (`uname -s` check) and in the npm scripts that call it.

**Affected files:** `src/midi/host-bridge.ts`, `scripts/rebuild-midi-native.sh`, `scripts/rebuild-midi-native.mjs`, `package.json`, `src/test/unit/midi/host-bridge.test.ts`

**DoD:**
- the Darwin check is removed from `host-bridge.ts` and the bridge opens all input ports on Windows
- the Bash rebuild script is replaced by a Node script that runs on Windows and macOS and rebuilds `midi` against the Electron ABI for the current OS/arch
- failure to load the addon still degrades to a console warning and the on-screen keyboard works
- WinMM vs WinRT backend behaviour and device enumeration are recorded; unit tests are updated, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] feat: per-platform VSIX packaging and CI (FR-WIN-PKG-1)

`.vscodeignore` carves in a single `midi.node`; the VSIX is built for whatever machine ran `npm install`.

**Affected files:** `package.json`, `.vscodeignore`, `scripts/verify-vsix.sh`, `.github/workflows/package.yml`

**DoD:**
- `vsce package --target win32-x64` and `--target darwin-arm64` each produce a VSIX containing the matching `midi.node` and the emulator sources
- a CI job builds both and smoke-tests that the addon loads on its own platform
- the Electron ABI target file is shared and the rebuild runs once per target
- VSIX size per platform is recorded
