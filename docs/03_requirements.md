# 03 — Requirements (v20)

> **v19 complete** — all v19 requirements implemented; ACs green.
> Archived: [`docs/v19/03_requirements.md`](v19/03_requirements.md).

*v20 requirements not yet defined.*

---

**FR-HW-5 — Hardware build surfaces per-region memory-budget usage and alerts on overflow/near-limit**

`buildForHardware()` (`src/commands/hardware-build.ts`) already streams the real arm-none-eabi linker's post-link memory-region table (`Memory region  Used Size  Region Size  %age Used` — GNU ld's own summary of `FLASH:`/`DTCMRAM:`/`SRAM:`/`RAM_D2_DMA:`/`RAM_D2:`/`RAM_D3:`/`ITCMRAM:`/`SDRAM:`/`QSPIFLASH:` etc.) on every build, but today it is only regexed for `error|warning|note` compiler diagnostics (`build-diagnostics.ts`) and the region table itself is discarded unparsed. ds-ide will parse this table and turn it into actionable alerts, and will fix a related silent-failure gap: a linker region-overflow error (`region 'X' overflowed by N bytes`) does not match `build-diagnostics.ts`'s `file:line:col` diagnostic regex, so today it is swallowed and the user sees only a generic "hardware build failed — make exited with code N".

A new resource-scoped `ds-ide.hardwareVariant` setting (`'base' | '65mb-sdram'`, default `'base'`) records which physical board variant the project targets, since the linker's `Region Size` for `SDRAM:` is a fixed 64 MB constant from libDaisy's `.lds` linker script regardless of whether the connected board actually has that chip — only this setting distinguishes the two.

AC: on a hardware build that fails from a linker region overflow, the error notification names the overflowing region(s) and the overflow amount, instead of the current generic "make exited with code N" message.

AC: if the build fails non-zero and no line matches the precise overflow regex, but the raw output contains the substring `overflowed`, show a lower-confidence fallback message ("a memory region overflow was detected but couldn't be parsed precisely; see output above") rather than reverting fully to the generic message.

AC: on a successful hardware build, the full parsed region table (region name, used size, region size, %age used) is printed to the output channel, and a warning notification is shown if any region's %age used is ≥ 75%.

AC: if `ds-ide.hardwareVariant` is `'base'` and the linker reports any non-zero `Used Size` for the `SDRAM:` region, an error notification is shown regardless of the %age-used figure, since that percentage doesn't reflect physical reality on hardware without the SDRAM chip.

AC: the Effect Project Wizard (`createEffectProject()`) prompts for hardware variant at project-creation time and writes the answer into the new project's `.vscode/settings.json` as `ds-ide.hardwareVariant`.

AC: if `buildForHardware()` runs against a project folder where `ds-ide.hardwareVariant` is unset, it prompts once (same question as the wizard) before proceeding, and persists the answer into that project's `.vscode/settings.json`; declining the prompt defaults to `'base'` for that build only, without persisting a value, so the prompt reappears on the next build.

AC: unit tests cover the region-table parser (valid table → structured region list), the overflow/fallback-overflow error-message extraction, the ≥75% threshold warning, and the `hardwareVariant='base'` + `SDRAM used > 0` hard-error rule — each independent of any live `make`/linker invocation.

Scope for this requirement is read-only alerting only. `APP_TYPE` auto-escalation (writing to the project's Makefile, bootloader-state detection, and the resulting DFU flash-address change) is explicitly out of scope — deferred as a separate future idea (see `01_input-ideas.md`).

---

**FR-PKG-3 — New effect projects are scaffolded with a working DaisySP dependency, no manual symlink required**

The Effect Project Wizard (`createEffectProject()`, `src/commands/create-effect-project.ts`) always generates a template that includes `daisysp.h` and `using namespace daisysp;` (`cppTemplate()`), but provisions no DaisySP dependency itself — every new project currently fails to build until the user manually creates a symlink into a DaisySP checkout elsewhere on disk. ds-ide will vendor a pinned copy of DaisySP inside the extension package; when scaffolding a new project, the wizard copies — not symlinks — that vendored copy into the new project, at a path `detectDaisySP()` (`src/commands/build.ts`) already recognizes (`DaisySP/Source`), so both the emulator build and a later hardware Makefile build can resolve it with no further setup.

Scope for this requirement is wizard-time provisioning only. Build-time lazy provisioning for imported/pre-existing projects (which requires scanning arbitrary effect source to determine whether DaisySP is actually needed) is a separate, deferred idea — out of scope here.

AC: creating a new project via `Daisy IDE: New Effect Project` produces a project that builds successfully for the emulator (`Daisy IDE: Build for Emulator`) with no manual DaisySP setup step.

AC: the vendored copy is placed at a path `detectDaisySP()` already recognizes (`DaisySP/Source`) via a file copy, not a symlink into the extension's own install directory — copying avoids the `extensionPath`-instability class of bug `FR-PKG-2`/M59 already fixed for the CMake build cache (a symlink would break or silently repoint after a ds-ide upgrade or reinstall).

AC: the generated `README.md` notes that DaisySP was vendored into the project and should be committed to the project's own version control, so collaborators (and CI) share the same pinned copy rather than each regenerating their own from whichever ds-ide version scaffolded it.

AC: `LICENSES.md` is updated to reflect that a DaisySP copy is now bundled with the extension (MIT, attribution required) — superseding the current "not bundled in the extension" note for DaisySP specifically (libDaisy's entry is unaffected).

AC: unit test covers the wizard's provisioning step directly (assert the vendored DaisySP files are written into the new project directory at the expected path, and that the write uses a copy, not a symlink).

---
