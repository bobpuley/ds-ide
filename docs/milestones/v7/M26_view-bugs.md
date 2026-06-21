# M26 — View State Initialization & Pinout Accuracy

**Status:** planned
**Semver target:** 0.7.0
**Requirements:** FR-CE-9 (AC-55), FR-WE-11 (AC-56), FR-WE-12 (AC-57)
**Source:** `view-problems.md` (user-reported bugs, 2026-06-21)

---

## Sprint tasks

- [ ] **fix: Controls Editor — initialize from source + yaml on project open** — when the extension activates with an open project, C1 shall parse the C++ `ds-ide:controls` block and `controllers.yaml` and push `controlsConfig` to the Controls Editor webview, without waiting for deployment. DoD: AC-55 green; Controls Editor shows controls immediately on project open with no prior deployment. *(FR-CE-9)*

- [ ] **fix: Controls Editor — refresh on file save** — register a VS Code `FileSystemWatcher` (or `workspace.onDidSaveTextDocument`) for the project C++ source and `controllers.yaml`; on save, re-parse and push updated `controlsConfig` to the Controls Editor. DoD: AC-55 green (file-save leg); saving the C++ source with a new annotation updates the canvas within one second. *(FR-CE-9)*

- [ ] **fix: Wiring Editor — initialize from source on project open** — when the extension activates with an open project, C1 shall parse the `ds-ide:controls` block in the C++ source and push `wiredPins` to the Wiring Editor webview, without waiting for deployment. DoD: AC-56 green; Wiring Editor shows correct pinout on project open. *(FR-WE-11)*

- [ ] **fix: Wiring Editor — refresh on C++ source file save** — on `onDidSaveTextDocument` for the project C++ source, re-parse the `ds-ide:controls` block and push updated `wiredPins` to the Wiring Editor. DoD: AC-56 green (file-save leg); saving the source with a new annotation updates the SVG within one second. *(FR-WE-11)*

- [ ] **fix: Wiring Editor SVG pinout — correct pin order and labels per Seed_pinout.csv** — rebuild the Daisy Seed SVG pin list so left-side pins from USB read D0→D14 and right-side pins from USB read GND/VIN/3V3D/D30→A0/D15 (matching `Seed_pinout.csv` rows 1–15 and 40→22 respectively). DoD: AC-57 green; all three assertions in AC-57 pass visually. *(FR-WE-12)*
