# 04 — Architecture (v25)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).
>
> **v24 complete** — full v24 architecture in
> [`docs/v24/04_architecture.md`](v24/04_architecture.md).

## First public preview (`FR-REL-*`)

No architecture impact. `FR-REL-1` is a `package.json` manifest declaration. `FR-REL-2` adds a `detectCMake()` helper beside `detectDfuUtil()` in `src/hardware/toolchain.ts` (same injectable `exists`/`exec` shape, same `which` → known-paths order) and routes `EmulatorManager.build()`'s `cmake` invocations through it; the transport state machine and the `buildFailed` flow are unchanged apart from carrying a failure reason to the notification.

`FR-REL-3` is also a manifest-only change: `activationEvents` in `package.json`. `activate()` and the context keys it sets (`ds-ide.isDaisyProject`, `ds-ide.isEffectSource`) are unchanged; the events only make VS Code call it when a Daisy-shaped folder opens. No architecture impact.
## First public preview — curated examples (2026-11-13)

No architecture impact (FR-EXM-1 to FR-EXM-7). `detectDaisySP` gains one more candidate path (the extension's own `vendor/DaisySP/Source`) and receives the extension path as a parameter; the build pipeline, emulator and IPC are unchanged.

FR-EXM-8 (same intake): `EmulatorManager` records the project root at build time and spawns `effect_emu` with it as `cwd`; the FatFs host shim gains `f_sync`. No new component, message or file format.

FR-EXM-9 (same intake): webview-only change in `sd-card-panel.ts` plus pure helpers in `sd-viewer.ts` (listing comparison, which previews went stale); the existing `sdRefresh`/`sdPreview` messages are reused, no new message or host code.

## First public preview — README polish (2026-11-13)

No architecture impact (FR-DOC-1 to FR-DOC-7): documentation, one new `CONTRIBUTING.md`, and a unit test over the README's links. No extension code changes.

## First public preview — licensing (2026-11-13)

No architecture impact (FR-LIC-1 to FR-LIC-6): `LICENSE`, `package.json` metadata, `LICENSES.md`, the README, `CONTRIBUTING.md`, an issue template under `.github/`, and one unit test. No extension or emulator code changes.

## First public preview — remaining release work (2026-11-14)

- **M89 (FR-PRE-1 to FR-PRE-5):** prerequisite detection extends `src/hardware/toolchain.ts` (compiler / Xcode CLT, `lldb-dap`) and the existing messages for the Arm toolchain and `dfu-util`; a `Makefile` pre-check in the hardware build command; `EmulatorManager.deploy` can resolve the build directory from the active project instead of only from memory; `package.json` `engines`. No new component, message or IPC type.
- **M90 (FR-MKT-1 to FR-MKT-5):** package metadata, an icon asset, issue templates under `.github/`, and one Node script (`scripts/check-published-links.js`). No extension or emulator code.
- **M91 (FR-RLS-1 to FR-RLS-4):** version and changelog, verification and publishing. No code.
