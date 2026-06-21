# 03 — Requirements (v7)

> **v6 complete** — all v6 requirements implemented; ACs green.
> Archived: [`docs/v6/03_requirements.md`](v6/03_requirements.md).

*v7 requirements not yet fully defined — see inherited FRs in archived docs (v3: FR-CE-1…FR-CE-6, FR-WE-1…FR-WE-7; v4: FR-CE-7…FR-CE-8, FR-WE-8…FR-WE-10, FR-CM-1…FR-CM-4, FR-SC-1…FR-SC-2; v5: FR-WZ-1, FR-CG-1; v6: FR-QS-1…FR-QS-15). New v7 requirements are added below.*

---

## FR-CE — Controls Editor (v7 additions)

**FR-CE-9** — The Controls Editor shall initialize its control state (parse the C++ `ds-ide:controls` block + read `controllers.yaml`) when the extension activates with an open project, without requiring deployment to the emulator. The Controls Editor shall also refresh its state whenever the project C++ source file or `controllers.yaml` is saved on disk.
*(Bug 1 fix — see `view-problems.md`)*
- **AC-55** — Open a project with a valid `controllers.yaml` and a C++ source containing a `ds-ide:controls` block; open the Controls Editor **without** deploying to the emulator — verify controls appear on the canvas. Then save the C++ source with an added annotation — verify the Controls Editor reflects the change without redeployment. *(FR-CE-9)*

---

## FR-WE — Wiring Editor (v7 additions)

**FR-WE-11** — The Wiring Editor shall initialize its wired-pins view by parsing the `ds-ide:controls` block in the active project C++ source when the extension activates with an open project (without requiring deployment). The Wiring Editor shall also refresh when the C++ source file is saved on disk.
*(Bug 2 fix — see `view-problems.md`)*
- **AC-56** — Open a project whose C++ source already contains a `ds-ide:controls` block with at least one pot and one button; open the Wiring Editor without deploying — verify the assigned pins are shown in the SVG diagram. Save the C++ source (add a new annotation) — verify the diagram updates to reflect it. *(FR-WE-11)*

**FR-WE-12** — The Daisy Seed SVG pin ordering, labels, and board orientation in the Wiring Editor shall match `Seed_pinout.csv` exactly. Left-side pins from the USB end shall read D0, D1, D2, D3, … downward (CSV PINOUT rows 1–15). Right-side pins from the USB end shall read GND, VIN, 3V3D, D30, D29, A11/D28, … downward (CSV PINOUT rows 40→22). The USB indicator shall be at the D0/GND end.
*(Bug 3 fix — see `view-problems.md`; authoritative source: `Seed_pinout.csv`)*
- **AC-57** — Open the Wiring Editor; verify: (a) the top-left pin (nearest USB) is D0, followed by D1, D2, D3 reading downward; (b) the top-right pin (nearest USB) is GND/DGND, followed by VIN, 3V3, D30 reading downward; (c) the USB indicator is at the correct (D0/GND) end of the board. *(FR-WE-12)*
