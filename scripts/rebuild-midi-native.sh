#!/usr/bin/env bash
# FR-DEV-19: rebuilds the host MIDI bridge's native addon ('midi', RtMidi
# bindings — NAN-based, not ABI-stable across Node.js versions, unlike
# N-API) against Electron's ABI instead of whatever plain Node.js ran
# `npm install`. Without this, an ordinary VS Code update that bumps its
# bundled Electron/Node.js version silently breaks host-bridge.ts's
# `require('midi')` with a NODE_MODULE_VERSION mismatch — host-bridge.ts
# already degrades that to a console warning rather than a crash; this
# script is what keeps the warning from firing in the first place.
#
# The target Electron version lives in scripts/electron-target-version.txt —
# a pure version anchor for @electron/rebuild's ABI target, never actually
# run. There is no supported way to auto-detect VS Code's exact bundled
# Electron version at install time (see docs/02_assumptions-and-risks.md) —
# bump that file whenever VS Code's bundled Electron major version changes.
#
# macOS-only (matches host-bridge.ts's own `platform !== 'darwin'` gate —
# FR-DEV-18 is a macOS-only feature; 'midi' isn't guaranteed to even compile
# cleanly elsewhere/in CI without extra system libraries e.g. ALSA on Linux).
#
# Exit code: propagates the real rebuild result. Callers that must never let
# a rebuild failure block them (e.g. `npm install` on a machine without the
# native toolchain available) should invoke this with `|| true`; callers that
# should fail loudly on a bad rebuild (packaging, the verify-vsix.sh smoke
# test) should not.

set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "rebuild-midi-native: skipping — host MIDI bridge is macOS-only (FR-DEV-18)."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

TARGET_ELECTRON_VERSION="$(cat "${REPO_ROOT}/scripts/electron-target-version.txt")"

echo "rebuild-midi-native: rebuilding 'midi' against Electron ${TARGET_ELECTRON_VERSION}'s ABI..."
npx --yes @electron/rebuild --version "${TARGET_ELECTRON_VERSION}" -f -w midi -m "${REPO_ROOT}"
