# 02 — Assumptions & Risks (v25)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).
>
> **v24 complete** — all v24 bets held; risks resolved or managed.
> Archived: [`docs/v24/02_assumptions-and-risks.md`](v24/02_assumptions-and-risks.md).

## First public preview (workspace trust, missing CMake)

> **Verified 2026-11-11 (fresh profile, packaged `.vsix`):** with `capabilities.untrustedWorkspaces: { supported: false, description }`, an untrusted folder shows VS Code's standard "disabled because the current workspace is not trusted" state under Extensions → Daisy Seed IDE, with our description text; after trusting the folder the extension works. (Before the declaration the extension was already disabled in Restricted Mode by VS Code's default, but without an explanation — so the change adds the reason and the README line, not a new restriction.)

> **Verified 2026-11-11 (fresh profile, minimal `PATH`):** the fallback to known install locations for `cmake` (`/opt/homebrew/bin`, `/usr/local/bin`) finds the user's Homebrew CMake and the build succeeds. Assumed safe by construction — it can only select a CMake the user already installed, and `PATH` still wins. Risk: it may pick a different CMake than the user's shell would; low, accepted.

> ⚠️ ASSUMPTION: every `cmake` failure to *start* (ENOENT) means CMake is not installed or not reachable; failures after it started are build errors and stay on the existing diagnostics path.

> ⚠️ ASSUMPTION: a Daisy effect project keeps its effect `.cpp` at the project root, `src/` or `source/` (the locations `findEffectSource` searches), so `workspaceContains` on those three globs activates the extension for every project it matters for. A project that uses `ds-ide.effectSource` to point elsewhere activates on first command/view use instead (the previous behaviour).

> ⚠️ ASSUMPTION: the `workspaceContains` file checks are cheap enough to run in every window that has a `.cpp` at those locations; the extension also activates in non-Daisy C++ projects, where `activate()` leaves `ds-ide.isDaisyProject` false and shows nothing. Check "Developer: Show Running Extensions" for the activation time.

*Other v25 bets and risks to be defined during planning.*

## First public preview — curated examples (2026-11-13)

> ⚠️ ASSUMPTION: the bundled `vendor/DaisySP/Source` is always present in an installed extension (it ships in the `.vsix` today for the New Effect wizard), so falling back to it never points the build at a missing path. A project's own `DaisySP/Source` (or `daisysp/…`) still wins.

> ⚠️ ASSUMPTION: the OLED host shim supports pixel primitives only (`Fill`, `DrawPixel`, `Update`; no `WriteString`, no fonts), so the OLED example conveys the selected waveform with a drawn pixel shape, not text. Showing text is a separate, larger feature (vendoring libDaisy's font tables) and is out of scope here.

> ⚠️ ASSUMPTION: the emulator's on-screen MIDI keyboard and its Control Change sender are enough to exercise the MIDI example without a hardware controller (`midi-panel.ts` sends notes, Program Change and Control Change).

> ⚠️ ASSUMPTION: the SD card shim (`fatfs_host.cpp`) maps the mount onto a host directory so a file the example writes can be found and opened by the user. The exact host location is confirmed when the SD example is built and then stated in its README.

> ⚠️ RISK: shipped examples are only useful if they build. An example that rots (a shim or convention change breaks it) is a poor first impression for a preview. Mitigation: a unit test guards the structural conventions of every example (FR-EXM-7) and each example is built once by hand before release; an automated build of every example in CI is not added here.

> ⚠️ ASSUMPTION: the project folder the build used (`opts.projectRoot`) is the same folder the SD viewer reads (`<workspace folder>/sdcard/`) — one active workspace folder at a time, as for every other per-project path in the extension. Verified against `readSdCardEntries` in `extension.ts`.

> ⚠️ ASSUMPTION: giving the emulator the project folder as its working directory does not disturb any other relative path it opens; the extension passes absolute paths for the socket and for WAV/recording files. Checked by running the emulator, runtime and extension suites after the change.

> ⚠️ ASSUMPTION: polling the host about once a second for the card's listing (one `readdir` plus a `stat` per root-level file) is cheap enough to run while an SD card peripheral is enabled and the Controls Editor is visible; it stops when the card is not enabled or the view is hidden, and it only re-renders when the listing actually changed (so the user's scroll position is not reset).

> ⚠️ ASSUMPTION: a size change is a reliable signal that a file's content changed. An overwrite with exactly the same size is picked up by the Refresh button, which always re-reads the expanded file.

## First public preview — README polish (2026-11-13)

> ⚠️ ASSUMPTION: relative image and link paths in the README resolve on the Marketplace because `package.json` `repository` points at the GitHub repo (`https://github.com/bobpuley/ds-ide`); `vsce` rewrites them to that repository's raw URLs. The repository is private today, so images will be broken on the Marketplace until it is made public. Only `media/*.png` is shipped in the package, which is what the README may reference.

> ⚠️ ASSUMPTION: the extension-host crash is described in the README only as what has been observed: it was seen in the Extension Development Host after a folder open, and not reproduced in the installed build over a few folder switches in a clean profile. The README must not claim it cannot happen in the installed build, nor that it always does.

> ⚠️ RISK: a README that names commands, settings or limits by hand drifts from the extension. Mitigation: a unit test checks that every relative link and image in the README resolves to a file that exists and, for images, that the file is shipped; command names are taken from `package.json` `contributes.commands` when the text is written.

## First public preview — licensing (2026-11-13)

> ⚠️ ASSUMPTION: PolyForm Shield 1.0.0 matches the intended line. It permits any use except providing a product that competes with the software (making it available to others in a commercial product or service that substitutes for it or offers substantially similar functionality). Developing, building and selling effects with the IDE is therefore free, as is a company's internal use; a commercial agreement is for competing, redistribution or hosting uses. Confirmed by the owner on 2026-11-13.

> ⚠️ ASSUMPTION: no version of Daisy IDE has been distributed to anyone under GPL-3.0 or MIT (the repository is private, nothing is pushed, packages were built locally), so there is no earlier public grant to honour. To be re-confirmed before the repository is made public.

> ⚠️ ASSUMPTION: the owner holds the copyright in everything in the repository except the lines from PR #1 (`kefflash`, test-only). Dependency-bump commits by a bot carry no copyright. The git author names "Marco Pugliese" and "bobpuley" are the same person.

> ⚠️ RISK: PR #1 was contributed to a repository whose `LICENSE` is GPL-3.0, so under GitHub's terms it is licensed GPL-3.0, which does not allow relicensing to a more restrictive licence. Until the contributor consents in writing, or the lines are rewritten, the repository must not be made public under Shield.

> ⚠️ RISK: Shield is source-available, not open source (not OSI-approved); some users and distribution channels avoid such licences. Accepted by the owner. The Marketplace accepts any licence and shows the SPDX identifier.

> ⚠️ RISK: the bundled MIT components (DaisySP, node-midi, RtMidi, bindings, file-uri-to-path) keep their own licences; their notices must stay in `LICENSES.md` and the package. The `libDaisy` compatibility layer re-implements libDaisy's API; any code copied from libDaisy keeps its MIT notice.

> ⚠️ RISK: this is not legal advice. The commercial agreement template and the licence choice should get a lawyer's review before the first agreement is signed.

> ⚠️ RISK: the GitHub issues page is public, so a commercial enquiry opened there is visible to everyone. Mitigation: a dedicated issue template tells people not to post confidential details, and the owner moves the conversation to a private channel.

## First public preview — remaining release work (2026-11-14)

> ⚠️ ASSUMPTION: prerequisite checks are cheap (`which`, `xcode-select -p`, a known-path probe), run only when the command that needs the tool starts, and follow the pattern of FR-REL-2's CMake detection: `PATH` first, then known install locations, one actionable message naming the install command, the cause also written to the output channel.

> ⚠️ ASSUMPTION: the Controls and Scope surfaces can be opened after a successful deploy rather than before without losing anything the user relies on (the Scope shows an idle state when the emulator is not running, and is reachable on demand through **Daisy IDE: Show Scope**).

> ⚠️ ASSUMPTION: `engines.vscode` is raised to the one version that has been exercised, `^1.140.0`, because the native `midi` addon is built for that Electron (ABI 148) and any other Electron cannot load it. A wider range is only claimed once it has been tested.

> ⚠️ RISK: a VS Code update that changes Electron's ABI breaks the native `midi` addon (the host MIDI bridge) until a new package is published, and monthly VS Code releases make that likely. The extension must degrade gracefully (the on-screen MIDI keyboard keeps working) and the pin-and-rebuild procedure must stay documented in `CONTRIBUTING.md`. Whether it degrades gracefully today is verified in M89.

> ⚠️ ASSUMPTION: version `0.25.0` with `"preview": true` is published with `vsce publish --pre-release`, shows as a pre-release with a Preview badge, and the first stable version would be `0.26.0`.

> ⚠️ ASSUMPTION: the Marketplace's publishing authentication may differ from the classic personal access token by the time of publishing (Azure DevOps is retiring classic PATs); the current Microsoft guidance is checked at publish time, not assumed.

> ⚠️ RISK: making the repository public cannot be undone in practice (copies, forks, caches), so the history and tracked files are reviewed for secrets and private material before the switch, and the licence and the outside contribution (M88) are settled first.

> ⚠️ RISK: publishing to the Marketplace and making the repository public are outward-facing actions. They are done by the owner, step by step, with a verification after each; the assistant does not publish or change repository visibility.
