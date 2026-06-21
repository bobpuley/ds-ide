# 02 — Assumptions & Risks (v7)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v6 complete** — all v6 bets held; risks resolved or managed.
> Archived: [`docs/v6/02_assumptions-and-risks.md`](v6/02_assumptions-and-risks.md).

## A23 — Daisy Seed SVG pinout inferred from image (FALSIFIED)

> ⚠️ ASSUMPTION (FALSIFIED): The initial Wiring Editor SVG pin layout was derived from a visual image of the Daisy Seed board rather than the authoritative `Seed_pinout.csv`. The image-derived order was incorrect: left side near USB was D1/D0/D2/D3 instead of the correct D0/D1/D2/D3; right-side labels were also wrong. Fixed in M26 (FR-WE-12 / AC-57). All future SVG pinout work must reference `Seed_pinout.csv` as the authoritative source.

## A24 — Controls Editor runtime UI: kind badge is redundant given card accent color

> ⚠️ ASSUMPTION: The colored top border (teal = pot, blue = button, red = LED) already communicates control type at a glance, making the "Pot" / "Button" / "LED" text badge in the header redundant in runtime mode. If user testing reveals that color alone is insufficient for recognition (e.g. color-blindness, small sidebar), the badge may need to return. Mitigation: the kind remains accessible via hover tooltip.

## A25 — Users never need Controls Editor and Wiring Editor open simultaneously

> ⚠️ ASSUMPTION: The Controls Editor (runtime testing) and Wiring Editor (pin assignment) serve distinct workflow phases and are not needed side-by-side. If a workflow emerges where a developer needs to cross-reference both views at once, the exclusive behavior becomes a regression. Mitigation: evaluate after M27 ships; revert to independent panels if users report friction.
