#!/usr/bin/env node
// FR-DEV-19: verifies a compiled native addon's embedded NODE_MODULE_VERSION
// matches a target Electron ABI, instead of only checking that the file
// exists and loads. "Loads under the system Node running this check" is a
// misleading pass — the addon might have been built against system Node's
// ABI rather than Electron's, which is exactly the class of bug FR-DEV-19
// exists to catch (it happened to load in dev, but not inside VS Code's
// actual Electron-hosted Extension Host).
//
// Node's own dlopen error already reports the exact ABI a mismatched addon
// was compiled for ("compiled against ... using NODE_MODULE_VERSION N") —
// this script requires the addon under system Node, parses that number out
// of the resulting error, and compares it against the expected ABI for the
// target Electron version (via node-abi, a transitive dependency of
// @electron/rebuild). If system Node's own ABI happens to coincide with the
// target Electron ABI, require() succeeds and there's no mismatch error to
// parse — treated as inconclusive-but-passing rather than a failure.
//
// Usage: node scripts/check-native-abi.js <path-to-.node-file> <target-electron-version>
// Exit code: 0 = confirmed match (or inconclusive-but-loadable), 1 = confirmed mismatch or
// an unrelated load failure.

'use strict';

const path = require('path');

const [, , nodePath, targetElectronVersion] = process.argv;
if (!nodePath || !targetElectronVersion) {
  console.error('usage: check-native-abi.js <path-to-.node-file> <target-electron-version>');
  process.exit(1);
}

const { getAbi } = require('node-abi');
const expectedAbi = Number(getAbi(targetElectronVersion, 'electron'));

try {
  require(path.resolve(nodePath));
  console.log(
    `AMBIGUOUS: ${nodePath} loaded successfully under the system Node running this check ` +
    `(expected ABI for Electron ${targetElectronVersion} is ${expectedAbi} — this machine's ` +
    `Node happens to share it, so a real mismatch wouldn't be caught this way; inconclusive).`,
  );
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const match = /NODE_MODULE_VERSION (\d+)/.exec(message);
  if (!match) {
    console.error(`FAIL: ${nodePath} failed to load for a reason unrelated to an ABI mismatch:`);
    console.error(message);
    process.exit(1);
  }
  const actualAbi = Number(match[1]);
  if (actualAbi === expectedAbi) {
    console.log(
      `PASS: ${nodePath} was compiled for NODE_MODULE_VERSION ${actualAbi}, matching Electron ` +
      `${targetElectronVersion}'s expected ABI.`,
    );
    process.exit(0);
  }
  console.error(
    `FAIL: ${nodePath} was compiled for NODE_MODULE_VERSION ${actualAbi}, but Electron ` +
    `${targetElectronVersion} expects ${expectedAbi}.`,
  );
  process.exit(1);
}
