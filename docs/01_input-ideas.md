# 01 — Input Ideas (v22)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).
>
> **v13 complete** — archived to `docs/v13/` on 2026-07-05. Full v13 ideas archived in
> [`docs/v13/01_input-ideas.md`](v13/01_input-ideas.md).
>
> **v14 complete** — archived to `docs/v14/` on 2026-07-22. Full v14 ideas archived in
> [`docs/v14/01_input-ideas.md`](v14/01_input-ideas.md).
>
> **v15 complete** — archived to `docs/v15/` on 2026-07-25. Full v15 ideas archived in
> [`docs/v15/01_input-ideas.md`](v15/01_input-ideas.md).
>
> **v16 complete** — archived to `docs/v16/` on 2026-07-25. Full v16 ideas archived in
> [`docs/v16/01_input-ideas.md`](v16/01_input-ideas.md).
>
> **v17 complete** — archived to `docs/v17/` on 2026-08-23. Full v17 ideas archived in
> [`docs/v17/01_input-ideas.md`](v17/01_input-ideas.md).
>
> **v18 complete** — archived to `docs/v18/` on 2026-08-25. Full v18 ideas archived in
> [`docs/v18/01_input-ideas.md`](v18/01_input-ideas.md).
>
> **v19 complete** — archived to `docs/v19/` on 2026-08-27. Full v19 ideas archived in
> [`docs/v19/01_input-ideas.md`](v19/01_input-ideas.md).
>
> **v20 complete** — archived to `docs/v20/` on 2026-08-30. Full v20 ideas archived in
> [`docs/v20/01_input-ideas.md`](v20/01_input-ideas.md).
>
> **v21 complete** — archived to `docs/v21/` on 2026-08-30. Full v21 ideas archived in
> [`docs/v21/01_input-ideas.md`](v21/01_input-ideas.md).

## Feature requests

### 2026-09-28 — Unified device interaction model (design_plan.md §5)

- **As received:** "feature relevant information at '## 5. A unified interaction model' from
  ./design_plan.md and refer to ./docs/mockups/v22-unified-device-model.html for the layout."
  Source content of `design_plan.md` §5 (2026-09-10 UX review, untracked scratch file), as stated there:
  - **§5.1 problem:** four placement gestures across two containers — Wiring SVG click-a-pin popup
    (6 controls); Controls palette drag (pot/button/led only); Controls palette drag of
    toggle/rgbled/encoder is a **silent no-op** (`palette-drag-drop.ts:24` rejects anything but
    `pot|button|led`); bus peripherals (sdcard/oled/midiTrs/midiUsb) are a checkbox in the Wiring
    footer rather than placed on the board.
  - **§5.2 one gesture:** one palette holding all ten registry devices (no controls/peripherals
    split); on pick-up every pin repaints as eligible·free / eligible·occupied / ineligible /
    footprint preview (whole run or bus under the cursor); conflicts visible before the drop.
  - **§5.3 one popover** per placed device replacing today's three (assign, assigned, bus):
    Open panel (only when `hasLiveView`; state-aware Open vs Focus, needs a new `panelState`
    message — no open-state tracking exists today), Reveal in code (`revealRange` on the tracked
    marker range), Remove.
  - **§5.4 enabler:** one new `DeviceDescriptor.pinRequires` field (`'adc' | 'i2c' | 'uart' |
    'spi' | 'sdmmc'`), replacing the hardcoded pot non-ADC warn badge.
  - **§5.5** same principle for transport: one stateful `▶ Run / ■ Stop` status-bar control,
    hardware group separated, clickable status item.
  - **§5.6** summary: 1 palette, 1 gesture, 1 board, 1 popover; all 10 devices behave identically.
  - **Layout reference** (`docs/mockups/v22-unified-device-model.html`, evaluated 2026-09-27):
    the real Wiring Editor schematic; drag & drop only; valid targets pulse in the device's
    accent colour, occupied-but-valid targets amber-hatched, everything else dimmed; hover
    previews the exact footprint (multi-pin slots labelled, bus as a dashed lane — the lane
    dropped on *is* the bus choice); free pins grey and inert (not clickable); only placed
    devices' pins are clickable (popover: Show panel / Reveal in code / Remove) and draggable to
    move; collapsible palette (collapses to a draggable colour-dot rail); **no Peripherals
    footer**; conflict popover offers Relocate existing (primary) / Replace / Cancel.
- **Scope decision (2026-09-28):** this intake covers the device model only (§5.1–5.4, 5.6).
  §5.5 (stateful transport control) was parked here and intaken separately below.

### 2026-09-28 — Transport actions on native VS Code surfaces (design_plan.md §5.5)

- **As received:** "I promoted the alt1 to main mockup proposal for §5.5" — i.e.
  `docs/mockups/v22-transport-actions.html` (the native-surfaces variant, which replaced the
  custom status-bar variant) is the proposal for design_plan.md §5.5.
  What the mockup shows:
  - **Primary path = Run and Debug:** F5 (debug) / Ctrl+F5 (run). Ctrl+F5 becomes a real
    no-debug session, so VS Code's floating debug toolbar gives ↻ Restart / ■ Stop.
    Today `run-config-provider.ts` returns `undefined` for `noDebug`: build + deploy with no
    session, no toolbar, no Stop.
  - **Editor-title ▶** on the effect's C++ source, with the native Run / Debug dropdown
    (plus Build & Flash); it remembers the last-used action.
  - **A contributed "Daisy" view in the Run and Debug container:** emulator state (stopped /
    building / deploying / running / debugging / paused / build failed / crashed), Run / Debug /
    Stop / Cancel buttons, "source changed — restart to apply", and a **Hardware** group (board
    detection, ⚡ Build & Flash with confirmation, "Build for Hardware only").
  - **Build/deploy progress:** native `withProgress` notification with Cancel, plus a progress
    bar on the Daisy view.
  - **Failures:** a build error goes to Problems (squiggles) with a notification (Show Problems);
    a crash gets a notification (Show Output / Debug).
  - **Status bar slimmed** to one clickable `Daisy: <state>` item (red on build failure →
    Problems, amber on crash → Output, otherwise → Daisy view) + ⚡ Flash.
  - Restart = rebuild + redeploy. All granular commands stay in the Command Palette.
  - Open questions in the mockup: status-bar colour for no-debug runs; one vs two launch
    configurations; Daisy view placement; whether the editor-title ▶ is discoverable enough;
    Restart semantics.
- **Decisions (2026-09-28):** one launch configuration (`DS-IDE: Build, Deploy & Debug`, as
  today) — F5 debugs, Ctrl+F5 runs; Restart = rebuild + redeploy; the Daisy view lives in the
  Run and Debug container; no status-bar Run button (status bar = state item + ⚡ Flash only).
  The status-bar colour for no-debug runs is left to VS Code's own behaviour (not
  extension-controllable) and verified during implementation.
