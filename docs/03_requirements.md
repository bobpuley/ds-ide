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

**FR-CE-10** — In convention (runtime) mode, each control card shall use a compact header that omits the kind badge and pin number from visible text; both shall be accessible via a `title` tooltip on the drag handle. Control IDs longer than 15 characters shall be truncated with `…` in the header; the full ID shall appear in the `title` tooltip. Body content (knob, button pad, LED dot) shall be horizontally centered inside the card. The button control shall render as a square pad (side length matching the height of the label-free bar from the previous design) with a raised `box-shadow` affordance; pressing the pad shall collapse the shadow and translate the element 3 px downward. The button body shall carry no text label. The LED body shall show only the indicator dot, with no accompanying text label. These changes apply only to the runtime (convention) mode; the legacy YAML-only editor mode is unaffected.
*(Controls Editor runtime UI redesign — see `01_input-ideas.md` 2026-06-21)*
- **AC-58** — Deploy a project with at least one pot, one button (momentary), one button (toggle), and one LED; open the Controls Editor in convention mode. Verify: (a) no kind badge ("Pot", "Button", "LED") is visible in any card header; (b) no pin number is visible in any card header; (c) hovering the drag handle of each card shows a tooltip containing the kind and pin (e.g. "Pot · pin 15"); (d) a control whose ID exceeds 15 characters shows a truncated label ending in `…` in the header, with the full ID in the `title` tooltip; (e) the knob, button pad, and LED dot are horizontally centered in their respective card bodies; (f) the button pad is a square with no text, has a visible bottom box-shadow at rest, and the shadow collapses + the element translates down when pressed; (g) toggle button remains visually "pressed" (blue, no shadow) when latched; (h) the LED body shows only the dot (no text label). *(FR-CE-10)*

---

**FR-WE-12** — The Daisy Seed SVG pin ordering, labels, and board orientation in the Wiring Editor shall match `Seed_pinout.csv` exactly. Left-side pins from the USB end shall read D0, D1, D2, D3, … downward (CSV PINOUT rows 1–15). Right-side pins from the USB end shall read GND, VIN, 3V3D, D30, D29, A11/D28, … downward (CSV PINOUT rows 40→22). The USB indicator shall be at the D0/GND end.
*(Bug 3 fix — see `view-problems.md`; authoritative source: `Seed_pinout.csv`)*
- **AC-57** — Open the Wiring Editor; verify: (a) the top-left pin (nearest USB) is D0, followed by D1, D2, D3 reading downward; (b) the top-right pin (nearest USB) is GND/DGND, followed by VIN, 3V3, D30 reading downward; (c) the USB indicator is at the correct (D0/GND) end of the board. *(FR-WE-12)*

---

## FR-VW — View Management (v7 additions)

**FR-VW-1** — The Controls Editor and Wiring Editor sidebar panels shall be mutually exclusive: when either panel becomes visible, the other shall be automatically collapsed. The collapse shall be triggered by the view's `onDidChangeVisibility` event and shall not require any user action beyond opening the desired panel.
*(View exclusivity — see `01_input-ideas.md` 2026-06-21)*
- **AC-59** — With both panels registered, click to open the Controls Editor; verify the Wiring Editor panel collapses automatically. Then click to open the Wiring Editor; verify the Controls Editor collapses automatically. Verify that opening either panel via the VS Code command palette produces the same exclusive behavior. *(FR-VW-1)*
