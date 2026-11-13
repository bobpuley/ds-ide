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
