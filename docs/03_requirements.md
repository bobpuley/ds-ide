# 03 — Requirements (v25)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).
>
> **v24 complete** — all v24 requirements implemented; ACs green.
> Archived: [`docs/v24/03_requirements.md`](v24/03_requirements.md).

## First public preview — `FR-REL-*` (intake 2026-11-11)

Source: `01_input-ideas.md`, 2026-11-11; fresh-profile install test tracked in `docs/release_plan.md`. Milestone: **M85**.

**FR-REL-1 — Workspace trust.** `package.json` declares `capabilities.untrustedWorkspaces` explicitly (`supported: false` with a `description` that says Daisy IDE builds and runs the project's code and needs a trusted folder), so a first-time user who opens a folder in Restricted Mode is told why the extension is inactive instead of finding the Controls and Wiring icons silently missing. The README quick start tells the user to trust the folder when VS Code asks. `package-metadata.test.ts` asserts the declaration and a non-empty description.

**FR-REL-2 — CMake detection and a clear "not found" failure.** The emulator build resolves `cmake` the way `dfu-util` and the ARM toolchain are resolved: `which cmake`, then known install locations (`/opt/homebrew/bin/cmake`, `/usr/local/bin/cmake`); `PATH` always wins. When no CMake is found, or `spawn` fails before CMake runs (`ENOENT`), the build fails with a specific message — "CMake not found. Install it (`brew install cmake`) and try again." — shown by **Run Daisy Effect**, **Build & Deploy**, **Build for Emulator** and the Daisy view, and the cause is written to the build output channel. The generic "Build failed. Nothing was deployed." (and a **Show Problems** button that opens an empty list) is no longer the only signal for a failure that produced no diagnostics. A CMake that starts and then fails keeps the existing diagnostics path unchanged.
