# 03 — Requirements (v20)

> **v19 complete** — all v19 requirements implemented; ACs green.
> Archived: [`docs/v19/03_requirements.md`](v19/03_requirements.md).

*v20 requirements not yet defined.*

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
