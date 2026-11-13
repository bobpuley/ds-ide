# First public release — plan & checklist

**Created:** 2026-11-09 · **Branch:** `main` · **Last full release:** `0.24.3`
**Nature of the release:** a *preview* (early access) to announce the product and collect feedback. Not 100% stable in bugs or UI; refinements are expected.

## Decisions taken

| Topic | Decision |
|---|---|
| Scope | macOS only, Apple Silicon primary. Windows support is **out of scope** and becomes a later `2.0.0` (it needs relevant changes on the macOS implementation too). The work stays parked on `feat/windows-support` (tag `0.25.0-win.4`, M80 closed). |
| Release branch | `main` — nothing from `feat/windows-support` is merged for this release. |
| Intermittent extension-host crash | Accepted as a **known issue** for the preview and documented in the README; investigation stays open (see `project-extension-host-crash` memory). Not a blocker. |
| Version | A preview version, announced as such. The Marketplace does not accept semver suffixes (`1.0.0-preview`); use a plain version with `vsce publish --pre-release`. Exact number: **TBD** (step 5). |
| Platform target | `darwin-arm64` only (Intel Macs not supported in the preview; can be added later as a second package). |
| Repository | `https://github.com/bobpuley/ds-ide` (private for now; must be made public before publishing). |

## Checklist

### 0. Baseline and housekeeping
- [x] midi native addon rebuilt for VS Code 1.140.0's Electron 43.7.3 (ABI 148); pin committed and pushed to `main` (`e20e421`)
- [x] Baseline `.vsix` built from `main`; `npm run verify:package` passes
- [x] Windows branch closed at M80 (`0.25.0-win.4`), merged into `feat/windows-support`, tagged and pushed; remaining Windows re-run deferred to M84
- [x] Diff of the Windows branch reviewed (macOS-affecting changes identified, not merged)
- [ ] Push `main` (packaging commit `da32d95` is local only)
- [ ] Decide what to do with the local untracked files (`design_plan*.md`, `img.png`) — they no longer ship, but clutter the tree
- [ ] Optional: stop tracking the committed `__pycache__/*.pyc` files under `tests/runtime/` (they show as modified after every test run)

### 1. Known issue: extension-host crash (documented, not fixed)
- [x] Logs analysed: `crashed with code 6` seen on 2026-09-28, 10-02, 11-08, right after the folder-open host restart; predates the Windows branch and the VS Code update; midi ruled out
- [x] Decision: ship as a known issue
- [ ] Add a "Known issues" entry to the README (symptom, when it happens, workaround: relaunch / open the folder before starting the dev host)
- [ ] When it recurs: check `~/Library/Application Support/Code/logs/*/main.log`, A/B test the installed `.vsix` vs the debugger-launched dev host, capture a minidump with `--crash-reporter-directory` if it reproduces in the installed build

### 2. Packaging
- [x] `.vscodeignore` trimmed: dev/repo files, graphify output, scripts, build-time resources, stale source maps no longer ship (1.56 MB / 276 files → 0.96 MB / 183 files)
- [x] `vsce` quirk handled: `!` re-includes beat later excludes, so `!dist/**` narrowed to `!dist/**/*.js`
- [x] Third-party notices added to `LICENSES.md` (node-midi, RtMidi, bindings, file-uri-to-path)
- [x] `package.json` `repository` and `homepage` point at `https://github.com/bobpuley/ds-ide`
- [x] `npm test` (97 files / 1713 tests) and `verify:package` green after the changes
- [x] Platform target decided: `darwin-arm64` only
- [x] Applied: `package` script uses `vsce package --target darwin-arm64`; `rebuild-midi-native.sh` builds with `--arch arm64`; `verify-vsix.sh` now also asserts the manifest `TargetPlatform` and that `midi.node` is arm64 (output file: `ds-ide-darwin-arm64-<version>.vsix`)
- [x] README: Requirements and Known limitations now say Apple Silicon (arm64) only
- [x] `bugs` URL (GitHub issues) added to `package.json`
- [x] `contributes` reviewed: 24 commands (all registered, none hidden/internal), 3 user-facing settings, no dev-only entries
- [ ] Decide whether to keep both command sets: legacy `build/deploy/start/stop/debug/buildAndDeploy` (with the `cmd+shift+alt+b/d/r/s` keybindings) and the newer `runEffect/debugEffect/stopEffect` overlap in the palette

### 3. Fresh-install test (owner: Marco, later today)
- [x] Install the `.vsix` into a **clean VS Code profile** (no dev host, no debugger)
- [x] Core flow: create a project → build → deploy to the emulator → audio/scope → controls and wiring editors (OK in the clean profile, including breakpoint debugging) → breakpoint/debug
- [ ] Missing prerequisites (CMake, compiler, Xcode CLT / `lldb-dap`, ARM toolchain, `dfu-util`) give clear errors, not silent failures
- [ ] Open/close several example folders (≈10×) and watch `main.log` for `crashed with code` (so far: 3 folder switches in the clean profile, 0 crashes) — doubles as the crash A/B test
- [x] Fresh profile (2026-11-11): installed `ds-ide-darwin-arm64-0.24.3.vsix` into a throwaway `--user-data-dir`/`--extensions-dir`; extension installs fine
- [x] Finding: in Restricted Mode (untrusted folder) the Controls/Wiring activity-bar icons are missing; they appear right after "Trust this folder"
- [ ] Fix (tracked as M85 / FR-REL-1): declare `capabilities.untrustedWorkspaces` (`supported: false` + description) in `package.json` and add a "trust the folder" line to the README quick start; rebuild and re-test
- [x] Finding: `examples/m10-demo` (used first as the scratch project) predates the current convention — no `// ds-ide:controls:begin…end` block, no `CMakeLists.txt` — so the Controls and Wiring editors cannot render it. Only `m17-demo` and `showcases/tremolo-filter` follow the convention. Test continues with `showcases/tremolo-filter`.
- [ ] Curate `examples/` (all of it ships in the `.vsix`): keep `showcases/tremolo-filter` and `m17-demo`; update to the current convention, or drop, `m10-demo` and `m16b-demo` (`m16b-demo` has only a `.cpp`); make sure each shipped example builds and renders in the Controls/Wiring editors
- [x] Finding: `showcases/tremolo-filter` fails to build from a plain copy (`'daisysp.h' file not found`). By design the extension only detects DaisySP inside the project (`src/commands/build.ts` `detectDaisySP`); only "Create New Effect Project" vendors the bundled copy. Shipped examples that include `daisysp.h` therefore don't build out of the box.
- [ ] Decide how shipped examples get DaisySP: (a) `detectDaisySP` falls back to the extension's bundled `vendor/DaisySP/Source` (project copy still preferred), (b) each example ships its own `DaisySP/`, or (c) document "copy DaisySP into the project"
- [x] Confirmed (2026-11-11): with `DaisySP/Source` copied into the project, `showcases/tremolo-filter` builds, deploys and plays audio in the clean profile; Controls and Wiring editors render it
- [ ] UX validation for missing DaisySP (raised by Marco): before/at build, detect that the effect needs DaisySP (e.g. `#include "daisysp.h"` or `using namespace daisysp` in the effect source) and check it is available to the project (`detectDaisySP`, or the bundled fallback if chosen above). If not, show a clear, actionable message instead of the raw compiler error `'daisysp.h' file not found` buried in the build log — e.g. "This effect uses DaisySP but none was found in the project", with an action such as "Copy bundled DaisySP into the project" / link to docs. Likewise consider the same check for libDaisy and other prerequisites (the missing-tools step already tests CMake/compiler messages). Needs a unit test for the detection and message.
- [x] Fresh-install test via the real first-user path: "Create New Effect Project" in an empty folder, then build and run — OK (2026-11-11, clean profile)
- [x] Pot/controls respond and breakpoint debugging works in the clean profile (tremolo-filter)
- [ ] UX finding (2026-11-11): **Deploy to Emulator** right after opening a window fails with "ds-ide: deploy failed — Build before deploying", even when a built binary exists in `.ds-ide/build` — `EmulatorManager.buildDir` is only set in memory by `build()` (`src/emulator/manager.ts` `deploy()`). Either derive the build dir from the active folder and use an existing binary, or word the message as "Build first (Run Daisy Effect / Build for Emulator)". Also: the Scope (and Controls editor) open before the deploy fails, showing the generic idle text — open them only after a successful deploy. Low priority: **Run Daisy Effect** always builds first, so the main path is unaffected.
- [ ] UX finding (tracked as M85 / FR-REL-2; confirmed 2026-11-11, minimal PATH): with CMake missing, **Run Daisy Effect** shows only "Build failed. Nothing was deployed." (+ **Show Problems**, which is empty). Cause in code: `EmulatorManager.runProcess` rejects with `spawn cmake ENOENT` without writing anything to the build channel, and the Run path passes `genericFailureToast: false` so the message is dropped (`src/commands/build.ts`, `src/transport/transport-controller.ts` `buildFailedMessage`). Fix: detect a missing `cmake` (check at build start or map ENOENT) and show "CMake not found — install it (`brew install cmake`)", and write the cause to the build channel. Same for a missing compiler.
- [ ] UX finding: **Build for Hardware** on a wizard-created project fails with "hardware build failed — make exited with code 2" / "No targets specified and no makefile found" — the wizard scaffolds only the host `CMakeLists.txt`, and none of the shipped examples has a hardware `Makefile`. Pre-check that a `Makefile` exists at the project root and say what is needed; document in the README that hardware build/flash require a libDaisy-style `Makefile` project (or decide to scaffold one). The ARM-toolchain-missing message is **not yet tested** (needs a project with a Makefile and a minimal PATH).
- [x] **Flash to Daisy Seed** without a build: "no .bin file found in build/. Run Build for Hardware first" — clear
- [x] Missing-tool detection, checked 2026-11-11: `dfu-util` (and likely the ARM toolchain) are found via `which` then known paths (`src/hardware/toolchain.ts`), so a minimal PATH does not make them look missing; the not-found message ("ds-ide: dfu-util not found. <install hint>") was read in code, not triggered live
- [ ] Consistency: `cmake` is spawned by plain name from PATH only (`EmulatorManager.runProcess`), unlike `dfu-util`/ARM toolchain which fall back to known install paths. Consider the same `which` → known paths fallback for `cmake` (e.g. `/opt/homebrew/bin`, `/usr/local/bin`) in addition to the clear "CMake not found" message
- [ ] `engines.vscode` is `^1.85.0` but only 1.140 has been exercised: either test an older VS Code or raise the minimum to what was tested

### 4. Public face (owner: Marco, later today)
- [ ] README: preview notice, what it is, prerequisites, quick start, screenshots (`media/`), known issues, known limits (macOS only, v1 feature gaps)
- [ ] Remove/hide anything dev-only from the README and the command palette
- [ ] Marketplace metadata reviewed: displayName, description, categories, keywords, icon, gallery banner
- [ ] Issue templates and a feedback route (the preview exists to collect feedback)
- [ ] Repository made **public** (README images and Marketplace links depend on it)

### 5. Version and release commit
- [ ] Choose the preview version number (plain semver, published with `--pre-release`)
- [ ] Update `CHANGELOG.md` and bump `package.json` `version` to match (`package-metadata.test.ts` enforces it)
- [ ] Full suites on the release commit: `npm run lint`, `npm test`, `npm run test:e2e`, emulator C++ runners, `tests/runtime`
- [ ] `npm run package` + `npm run verify:package` on the release commit
- [ ] Create an **annotated** tag, then push the commit and the tag (never tag before the suite passes: moving a pushed tag needs a force-push)

### 6. Publish (guided step by step)
- [ ] Create the Marketplace publisher `daisy-ide` and a personal access token
- [ ] `vsce login` / `vsce publish --pre-release` (or publish the already-built `.vsix`)
- [ ] Decide whether to also publish to Open VSX (VSCodium users)
- [ ] Verify the Marketplace page (README, images, license, version) and install from the Marketplace in a clean profile
- [ ] Announce the preview and where to send feedback

### 7. After release
- [ ] Triage incoming feedback; keep the crash investigation open
- [ ] Windows support as `2.0.0`: rebase `feat/windows-support` onto the released `main`, run the macOS regression pass once, then the Windows verification (M84)
