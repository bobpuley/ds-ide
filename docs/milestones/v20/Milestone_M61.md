# M61 — Hardware Memory-Budget Alerting

**Version:** 0.19.0
**Status:** in progress
**Source:** feature idea raised 2026-08-28, scoped via `/doc-creator-driver:intake` + `grill-me`, 2026-08-29

## Goal

`buildForHardware()` already streams the real arm-none-eabi linker's post-link memory-region table on every hardware build, but today that table is discarded unparsed, and a genuine region-overflow build failure is silently reduced to a generic "make exited with code N" because it doesn't match the existing compiler-diagnostic regex. After this milestone, every hardware build surfaces per-region memory usage: a clear, named overflow message on failure, a printed usage table plus a ≥75%-used warning on success, and a hard error when SDRAM is used on a project without the physical chip — resolved via a new per-project `ds-ide.hardwareVariant` setting that the wizard (and, for existing projects, the first hardware build) prompts for.

## Sprint Tasks

### [ ] feat: parse the linker's post-link memory-region table (FR-HW-5a)

Add a parser module alongside `build-diagnostics.ts` that turns GNU ld's `Memory region  Used Size  Region Size  %age Used` summary (already streamed to the output channel by `buildForHardware()` but never parsed) into a structured list of `{ region, usedBytes, regionBytes, pctUsed }`. Also add overflow-error extraction: a precise regex for `region 'X' overflowed by N bytes`, plus a fallback substring check (`output.includes('overflowed')`) for a lower-confidence message when the precise pattern doesn't match.

**Affected files:** `src/diagnostics/memory-region-diagnostics.ts` (new), `src/test/unit/diagnostics/memory-region-diagnostics.test.ts` (new)

**DoD:**
- `parseMemoryRegionTable(output: string): MemoryRegion[]` correctly parses a real linker memory-usage table (test against sample output shaped like `_a7_Getting-Started-Daisy-Bootloader.md`'s examples).
- `extractOverflowError(output: string)` returns the overflowing region name and overflow byte count when the precise `region 'X' overflowed by N bytes` pattern is present.
- A separate fallback path detects the substring `overflowed` when the precise pattern doesn't match, distinguishable from "no overflow detected at all."
- Unit tests cover: a clean successful build's table, a single-region overflow, and output with neither pattern present.

---

### [ ] feat: hardware build surfaces overflow errors and near-limit warnings (FR-HW-5b)

Wire the new parser into `buildForHardware()`. On a failed build, try the precise overflow extraction first, then the fallback substring check, before falling back to today's generic failure message. On a successful build, print the full parsed table to the output channel and show a warning notification if any region's %age used is ≥ 75%.

**Affected files:** `src/commands/hardware-build.ts`, `src/test/unit/commands/hardware-build.test.ts`

**DoD:**
- A hardware build that fails from a region overflow shows an error notification naming the region and overflow amount, not the generic "make exited with code N".
- A build failure with the `overflowed` substring present but not matching the precise pattern shows the lower-confidence fallback message.
- A build failure with neither pattern present still shows today's generic message (no regression).
- A successful build prints the full region table to the output channel.
- A successful build with any region ≥75% used shows a warning notification; a build with all regions <75% does not.

---

### [ ] feat: add `ds-ide.hardwareVariant` setting and SDRAM hard-error rule (FR-HW-5c)

Add a new resource-scoped `ds-ide.hardwareVariant` setting (`'base' | '65mb-sdram'`, default `'base'`) to `package.json`. In `buildForHardware()`'s success path, after the ≥75% check, add a hard-error rule: if `hardwareVariant` resolves to `'base'` for the project folder and the parsed `SDRAM:` region shows `usedBytes > 0`, show an error notification regardless of `pctUsed` — the linker's `SDRAM:` region size is a fixed 64 MB constant from the `.lds` script and doesn't reflect whether the connected board actually has that chip.

**Affected files:** `package.json`, `src/commands/hardware-build.ts`, `src/test/unit/commands/hardware-build.test.ts`

**DoD:**
- `ds-ide.hardwareVariant` appears in VS Code Settings UI under "Daisy IDE", resource-scoped, default `'base'`, enum `['base', '65mb-sdram']`.
- A successful build with `hardwareVariant='base'` and any nonzero `SDRAM:` usage shows an error notification regardless of %age used.
- The same build with `hardwareVariant='65mb-sdram'` does not trigger this hard error (falls through to the normal ≥75% threshold check instead).
- A project with no SDRAM usage at all never triggers this rule regardless of variant.

---

### [ ] feat: prompt for hardware variant at wizard time and first hardware build (FR-HW-5d)

`createEffectProject()` gains a hardware-variant prompt (same question/options as the settings enum) after the existing template-file writes, persisting the answer into the newly-created project's `.vscode/settings.json`. `buildForHardware()` gains an unset-check at entry: if `ds-ide.hardwareVariant` has no value for the project folder, prompt once before proceeding and persist the answer via `vscode.ConfigurationTarget.WorkspaceFolder`; if the user dismisses the prompt, use `'base'` for that build only without persisting, so the prompt reappears on the next build.

**Affected files:** `src/commands/create-effect-project.ts`, `src/commands/hardware-build.ts`, `src/test/unit/commands/create-effect-project.test.ts`, `src/test/unit/commands/hardware-build.test.ts`

**DoD:**
- Creating a new project via `Daisy IDE: New Effect Project` prompts for hardware variant and writes the answer into the new project's `.vscode/settings.json` as `ds-ide.hardwareVariant`.
- Running `Daisy IDE: Build for Hardware` against a project with no `ds-ide.hardwareVariant` set prompts once, then persists the answer to that project's `.vscode/settings.json`.
- Dismissing that prompt lets the build proceed using `'base'` for that build only, without writing a value — the next build against the same unset project prompts again.
- A project that already has `ds-ide.hardwareVariant` set (via wizard or manually) is never prompted.
