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
