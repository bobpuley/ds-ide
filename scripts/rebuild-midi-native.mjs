#!/usr/bin/env node
// FR-DEV-19 / FR-WIN-MIDI-1: rebuilds the host MIDI bridge's native addon
// ('midi', RtMidi bindings — NAN-based, not ABI-stable across Node.js
// versions, unlike N-API) against Electron's ABI instead of whatever plain
// Node.js ran `npm install`. Without this, an ordinary VS Code update that
// bumps its bundled Electron/Node.js version silently breaks host-bridge.ts's
// `require('midi')` with a NODE_MODULE_VERSION mismatch — host-bridge.ts
// degrades that to a console warning rather than a crash; this script keeps
// the warning from firing in the first place.
//
// The target Electron version lives in scripts/electron-target-version.txt,
// shared by every platform — a pure version anchor for @electron/rebuild's
// ABI target, never actually run. There is no supported way to auto-detect
// VS Code's bundled Electron version at install time (see
// docs/02_assumptions-and-risks.md) — bump that file whenever it changes.
//
// Runs once per target platform: it builds for the current OS (darwin-arm64
// or win32-x64, see vsix-target.mjs) and skips elsewhere. On Windows, 'midi'
// needs the MSVC build tools to compile; without them the rebuild fails.
//
// Exit code: propagates the real rebuild result. Callers that must never let
// a rebuild failure block them (e.g. `npm install` on a machine without the
// native toolchain) invoke this with `|| true`; packaging and the VSIX smoke
// test must not.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRebuildArgs, resolveTarget } from './vsix-target.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolveTarget(process.platform, process.arch);
if (!target) {
  console.log(`rebuild-midi-native: skipping — no host MIDI addon is shipped for ${process.platform}-${process.arch}.`);
  process.exit(0);
}

const electronVersion = readFileSync(join(repoRoot, 'scripts', 'electron-target-version.txt'), 'utf8').trim();
console.log(`rebuild-midi-native: rebuilding 'midi' for ${target.vsceTarget} against Electron ${electronVersion}'s ABI...`);

const args = ['--yes', '@electron/rebuild', ...buildRebuildArgs({ electronVersion, arch: target.arch, repoRoot })];
// shell: true so `npx` resolves to npx.cmd on Windows.
const result = spawnSync('npx', args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
