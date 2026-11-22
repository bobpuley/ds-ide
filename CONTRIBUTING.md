# Contributing to Daisy Seed IDE

Thanks for looking at the code. This page covers building the extension from source and running its tests. For using the extension, see the [README](README.md).

## Get the source

DaisySP is a git submodule, so clone with it:

```sh
git clone --recurse-submodules https://github.com/bobpuley/ds-ide.git
cd ds-ide
npm install
```

You need Node.js 22 and a C++ toolchain (see the README's requirements):

- **macOS on Apple Silicon:** CMake 3.20 or later and the Xcode Command Line Tools.
- **Windows 10/11 x64:** clang/MinGW, CMake and Ninja (MSYS2 CLANG64 gives you all three; the extension can also download them, see the README), and Git for Windows with its `bash` on your `PATH`, because `npm run lint` and some tests run shell scripts.

`npm install` also compiles the native `midi` addon. On Windows that needs the Visual Studio Build Tools (the C++ workload). Without them, run `npm install --ignore-scripts`: everything works except the host MIDI bridge, which is what the Windows CI does for its unit tests.

## Run it from source

1. Open the folder in VS Code.
2. Press `F5` (the **Run Extension** launch configuration). A second VS Code window, the Extension Development Host, opens with the extension loaded.
3. In that window, open one of the [`examples/`](examples/README.md) and try it.

`npm run compile` rebuilds the TypeScript bundles without starting VS Code.

## Build the `.vsix`

```sh
npm run package            # builds, rebuilds the native midi addon for Electron, and packages for this platform (darwin-arm64 or win32-x64)
npm run verify:package     # checks the package contents, the target platform and the native addon's ABI
```

The package contains a native addon (`midi.node`) that must match the Electron version inside VS Code. The version is pinned in `scripts/electron-target-version.txt`; after a VS Code update that changes Electron, update the pin, run `npm run rebuild:native` and revisit `engines.vscode` in `package.json` (it names the VS Code version the addon was built and tested for, currently 1.140). The rebuild is `scripts/rebuild-midi-native.mjs` (Node, runs on macOS and Windows; one platform per run), and `npm run package` produces the VSIX for the current platform (`darwin-arm64` or `win32-x64`); the `Package VSIX` workflow (`package.yml`) builds and smoke-tests both and records each VSIX size in its run summary. Releases go through the manual `Publish to Marketplace` workflow (`publish.yml`; keep that filename, the Marketplace Trusted Publishing policy is bound to it): `platforms` = `all` publishes both VSIXs (every platform is built, tested and verified before anything is published); choose a single platform for a fix that concerns only that platform. Run it once with `dry_run` on first.

Before publishing, run `npm run check:published-links`. It requests every URL the published README will contain (including the screenshots, which vsce points at the repository) anonymously and fails on any that does not answer 200. It needs network and a public repository, so it is not part of `npm test`.

## Tests

CI: the `Test` workflow (`.github/workflows/test.yml`) runs on every pull request and push to `main` — lint plus the unit suite on macOS, the unit suite on Windows, and the native emulator build and tests on both.

- **`npm test`**: the vitest unit suite (the `vscode` module is mocked). Fast; run it while you work. `npm run lint` type-checks the extension and the webviews and checks that the README and walkthrough only name commands that exist.
- **`npm run test:e2e`**: the functional suite. It builds the extension, starts a real VS Code Extension Development Host and exercises real activation, command dispatch and IPC. Slower (it downloads a VS Code build on the first run), and not part of `npm test`; run it before a release or when you change activation, command registration or the IPC boundary. Specs are in `src/test/e2e/`.
- **Emulator tests**: `bash tests/runtime/build_and_test.sh` builds the emulator and drives it over IPC (scope, record and replay, generators, controls). Each `tests/<name>/` folder (for example `fatfs-shim`, `oled-shim`) has a `run_*.sh` runner for one piece of the C++ shim. Most of these runners are POSIX-only. In CI, the `Test` workflow's `emulator (macos)` job runs all of them plus the runtime suite; its `emulator (windows)` job builds the emulator with clang/MinGW and runs the ones that apply (the TCP transport smoke test, `tests/rtaudio-device` and `tests/core-audio-device`), in an MSYS2 CLANG64 shell.
- **Manual checklist**: `src/test/manual/manual-tests.html` lists the cases no automated suite can cover (real audio, hardware build and flash, webview rendering).

## Project documents

The design lives in `docs/`: requirements in `03_requirements.md`, architecture in `04_architecture.md`, and the milestone plan in `05_dev-plan.md`. `CHANGELOG.md` records every release.

## Licence of contributions

Daisy IDE is licensed under the [PolyForm Shield License 1.0.0](LICENSE). By submitting a contribution (a pull request, a patch, or any other code or text) you agree that:

- it is licensed under that same licence, and
- you also grant the maintainer the right to license your contribution under other terms, including commercial ones.

You confirm that you wrote it, or have the right to submit it under these terms.
