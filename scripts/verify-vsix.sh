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
# FR-DEV-19: the packaged binary must be freshly rebuilt for Electron's ABI
# right before packaging — reproduces what `npm run package` does, so this
# smoke test catches a stale/wrong-ABI binary the same way a real release
# would ship one. Not `|| true` here (unlike postinstall's leniency): a
# rebuild failure at packaging time must fail loudly, not ship silently.
npm run rebuild:native
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

# FR-PKG-3: the vendored DaisySP core (Source/) and its MIT LICENSE must be
# present — createEffectProject() copies Source/ into every new project.
check "vendor/DaisySP/Source/daisysp.h"
check "vendor/DaisySP/LICENSE"

# FR-DEV-18: the host MIDI bridge's native addon must actually be present and
# loadable from the packaged layout — the class of bug this whole script
# exists to catch (invisible when testing only via dev-mode Extension Host,
# where node_modules is resolved from the repo root instead of the .vsix).
check "node_modules/midi/midi.js"
check "node_modules/midi/build/Release/midi.node"
check "node_modules/bindings/bindings.js"
check "node_modules/file-uri-to-path/index.js"

# FR-DEV-19: "loads under the system Node running this check" is a
# misleading pass on its own — the addon might have been built against
# system Node's ABI rather than Electron's target ABI, which is exactly the
# real-world bug this whole check exists to catch (it silently degrades to
# "host MIDI bridge unavailable" only once loaded inside VS Code's actual
# Electron-hosted Extension Host, never during dev-mode testing on this
# machine). check-native-abi.js requires the addon and, if it fails to load,
# parses the exact NODE_MODULE_VERSION Node reports it was compiled for out
# of the resulting error — the same diagnostic a user would see — and
# compares that against the target Electron version's expected ABI.
TARGET_ELECTRON_VERSION="$(cat "${REPO_ROOT}/scripts/electron-target-version.txt")"
if node "${REPO_ROOT}/scripts/check-native-abi.js" \
    "${UNZIP_DIR}/extension/node_modules/midi/build/Release/midi.node" \
    "${TARGET_ELECTRON_VERSION}"; then
  echo "  PASS  node_modules/midi's native addon matches Electron ${TARGET_ELECTRON_VERSION}'s ABI"
else
  echo "  FAIL  node_modules/midi's native addon does not match Electron ${TARGET_ELECTRON_VERSION}'s ABI (see above)"
  fail=1
fi

# Bulk exclusion: midi's test suite and vendored RtMidi C++ source must NOT
# be packaged (only the compiled runtime files above are needed).
if [[ -e "${UNZIP_DIR}/extension/node_modules/midi/test" || -e "${UNZIP_DIR}/extension/node_modules/midi/vendor" ]]; then
  echo "  FAIL  node_modules/midi/test or vendor/ was packaged (should be excluded)"
  fail=1
else
  echo "  PASS  node_modules/midi's test/vendor bulk is excluded"
fi

# Bulk exclusion: DaisySP's tests/docs/build-tooling and its DaisySP-LGPL/
# nested submodule (separately licensed, never initialized) must NOT be
# packaged (only Source/ and LICENSE above are needed).
if [[ -e "${UNZIP_DIR}/extension/vendor/DaisySP/tests" || -e "${UNZIP_DIR}/extension/vendor/DaisySP/DaisySP-LGPL" ]]; then
  echo "  FAIL  vendor/DaisySP/tests or DaisySP-LGPL was packaged (should be excluded)"
  fail=1
else
  echo "  PASS  vendor/DaisySP's test/doc/LGPL bulk is excluded"
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
