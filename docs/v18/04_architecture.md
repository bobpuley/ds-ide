# 04 — Architecture (v18)

> **v17 complete** — full v17 architecture in
> [`docs/v17/04_architecture.md`](v17/04_architecture.md).

*v18 architecture not yet defined.*

---

**FR-UX-6 (debug-attach active-folder fix)** — no architecture impact. The fix threads the existing `resolveActiveFolder()` helper (`src/workspace/active-folder.ts`, established in v11/v12) into two additional call sites; no new components, data flows, or stack decisions.

**FR-EMU-9..11 / FR-EXT-6..39 (M54–M57, code-review batch)** — no stack or component-boundary changes; every fix is internal to an existing module. Three items are internal *structural* refactors worth flagging explicitly (still within existing components, no new ones):
- **FR-EMU-9** — splits `midi_queue` into two queues and gives LED/RGB-LED telemetry its own queue (or upgrades `SpscIpcQueue` to MPSC); same emulator-state component, more queue instances.
- **FR-EMU-10** — moves scope/spectrum JSON/FFT work from the RT callback to the existing non-RT `drain_thread`; no new thread, reuses an existing one.
- **FR-EXT-9** — decomposes `activate()` into named factory functions/modules; same extension-host process, no new runtime component.
- **FR-EXT-30 / FR-EXT-32** — `DeployCoordinator`'s constructor and `controls-webview.ts`'s internal module split are both refactors within their existing single-responsibility boundary, not new components.

All other FR-EMU/FR-EXT items in this batch are localized fixes (guard clauses, validation, dedup, event wiring) with no architectural shape change.
