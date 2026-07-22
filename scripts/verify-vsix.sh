#!/usr/bin/env bash
# FR-PKG-1 packaging smoke test.
#
# Packages the extension, unzips the resulting .vsix, and asserts that the
# files the core "Build for Emulator" / "Build & Deploy" commands need at
# runtime are actually present in the package — the class of bug where
# .vscodeignore excludes something the extension needs once installed
# (invisible when testing only via the dev-mode Extension Host, per
# docs/02_assumptions-and-risks.md).
#
# Not wired into any CI provider yet (none exists in this repo) — run it
# manually or plug it into whatever CI gets set up later.
#
# Exit code: 0 = all assertions pass, 1 = packaging or an assertion failed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

VSIX_PATH="${WORK_DIR}/ds-ide.vsix"
UNZIP_DIR="${WORK_DIR}/unzipped"

echo "=== FR-PKG-1 packaging smoke test ==="
echo "Repo: ${REPO_ROOT}"
echo ""

cd "${REPO_ROOT}"
node esbuild.js --production
# No --no-dependencies (FR-DEV-18): 'midi' is a native addon esbuild can't
# inline, so its runtime files must ship as real node_modules entries —
# .vscodeignore carves the specific files needed back in from its blanket
# node_modules/** exclusion.
npx --yes @vscode/vsce package -o "${VSIX_PATH}"

mkdir -p "${UNZIP_DIR}"
unzip -q "${VSIX_PATH}" -d "${UNZIP_DIR}"

fail=0
check() {
  local rel="$1"
  if [[ -f "${UNZIP_DIR}/extension/${rel}" ]]; then
    echo "  PASS  ${rel} present in package"
  else
    echo "  FAIL  ${rel} missing from package"
    fail=1
  fi
}

check "emulator/CMakeLists.txt"
check "dist/extension.js"

# FR-DEV-18: the host MIDI bridge's native addon must actually be present and
# loadable from the packaged layout — the class of bug this whole script
# exists to catch (invisible when testing only via dev-mode Extension Host,
# where node_modules is resolved from the repo root instead of the .vsix).
check "node_modules/midi/midi.js"
check "node_modules/midi/build/Release/midi.node"
check "node_modules/bindings/bindings.js"
check "node_modules/file-uri-to-path/index.js"

if node -e "require('${UNZIP_DIR}/extension/node_modules/midi/midi.js')" 2>/tmp/midi-load-err.txt; then
  echo "  PASS  node_modules/midi loads successfully from the packaged layout"
else
  echo "  FAIL  node_modules/midi failed to load from the packaged layout:"
  sed 's/^/    /' /tmp/midi-load-err.txt
  fail=1
fi
rm -f /tmp/midi-load-err.txt

# Bulk exclusion: midi's test suite and vendored RtMidi C++ source must NOT
# be packaged (only the compiled runtime files above are needed).
if [[ -e "${UNZIP_DIR}/extension/node_modules/midi/test" || -e "${UNZIP_DIR}/extension/node_modules/midi/vendor" ]]; then
  echo "  FAIL  node_modules/midi/test or vendor/ was packaged (should be excluded)"
  fail=1
else
  echo "  PASS  node_modules/midi's test/vendor bulk is excluded"
fi

# Defense-in-depth: build output directories must NOT be packaged.
if find "${UNZIP_DIR}/extension" -path '*/emulator/*/build/*' -print -quit | grep -q .; then
  echo "  FAIL  emulator/**/build/** output was packaged (should be excluded)"
  fail=1
else
  echo "  PASS  no emulator build output packaged"
fi

echo ""
if [[ "${fail}" -eq 0 ]]; then
  echo "Result: all passed"
else
  echo "Result: FAILURES"
fi
exit "${fail}"
