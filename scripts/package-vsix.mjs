#!/usr/bin/env node
// FR-WIN-PKG-1: packages the VSIX for the current OS/arch (darwin-arm64 or
// win32-x64, see vsix-target.mjs). Extra arguments (e.g. --pre-release, -o)
// are passed through to `vsce package`. The addon in node_modules/midi must
// already be rebuilt for this target — `npm run package` does that first.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from './vsix-target.mjs';

export function buildVsceArgs(target, extra) {
  return ['--yes', '@vscode/vsce', 'package', '--target', target.vsceTarget, ...extra];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolveTarget(process.platform, process.arch);
  if (!target) {
    console.error(`package-vsix: no VSIX target for ${process.platform}-${process.arch}.`);
    process.exit(1);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync('npx', buildVsceArgs(target, process.argv.slice(2)), {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}
