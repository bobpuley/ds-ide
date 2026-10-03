# 03 — Requirements (v24)

> **v23 complete** — all v23 requirements implemented; ACs green.
> Archived: [`docs/v23/03_requirements.md`](v23/03_requirements.md).

## Reachability — `FR-RCH-*` (intake 2026-10-01)

Source: `01_input-ideas.md`, 2026-10-01; `design_plan.md` P0-2, P1-4, P2-3, P1-3. Milestone: **M73**.

**Decisions recorded 2026-10-01:** Show Scope with no emulator opens the idle panel (never builds); the "💾 layout" button is removed in favour of auto-save; `panelState` is out of scope.

**FR-RCH-1 — Show / focus commands.** The palette has `Daisy IDE: Show Scope`, `Show OLED`, `Show MIDI`, `Focus Controls Editor` and `Focus Wiring Editor`. Each reveals the surface if it exists, or opens it if it was closed, without a build or deploy. Show OLED / Show MIDI work even when the peripheral is disabled, showing the panel's idle state.

**FR-RCH-2 — Welcome content.** (Revised 2026-10-01: VS Code renders `viewsWelcome` only in tree views, never in webview views.) The native Daisy tree view is visible in every workspace and, outside a Daisy project, is empty with `viewsWelcome` content: a *Create New Effect Project* button. The Controls Editor's empty canvas shows an *Open Wiring Editor* button (the webview posts a `focusWiring` message; the host runs `ds-ide.focusWiring`). The Wiring Editor keeps its existing hint line.

**FR-RCH-3 — Walkthrough.** A "Get started with Daisy Seed" walkthrough (create project → wire a pin → Run → watch the scope) is contributed, with command links, so VS Code lists it on the Welcome page.

**FR-RCH-4 — Docs/manifest lint.** A static check (precedent: `scripts/check-active-folder-convention.sh`) fails when a `Daisy IDE: <title>` mention or a `(command:<id>)` link in `README.md` or the walkthrough is not in `contributes.commands`. Bare `ds-ide.<name>` in prose is ignored, since the prefix also names settings and state keys. The stale "Open Wiring Editor" README text is corrected.

**FR-RCH-5 — Auto-save layout.** The Controls Editor persists card positions ~500 ms after a drag ends, using the existing `editorSave` path. The "💾 layout" button is removed. A failed save is reported, not silent.

## Editor polish — `FR-WLG-*`, `FR-CEH-*` (intake 2026-10-01)

Source: `01_input-ideas.md`, 2026-10-01; `design_plan.md` P1-6, P2-2. Milestone: **M74**.

**Decisions recorded 2026-10-01:** the header gets *Align to grid*, *Auto-arrange* and *Reset positions* (snap-while-dragging, align/distribute and layout undo are out of scope); the card dimming stays.

**FR-WLG-1 — Wiring legend.** The Wiring Editor has a legend explaining every pin state it draws: ADC-capable free pin, other free pin, claimed by a bus peripheral, wired device (with the device accent colours), power/non-assignable. It uses theme tokens, and each entry pairs the colour with a shape or text, not colour alone.

**FR-CEH-1 — No run marker in the header.** The ▶/■ marker (`ce-emu-status`) is removed from the Controls Editor header. Cards still dim while the emulator is not running.

**FR-CEH-2 — Align to grid.** A header button snaps every card to a 20 px grid. The result is saved through the existing auto-save (FR-RCH-5).

**FR-CEH-3 — Auto-arrange.** A header button lays the cards out in rows, in the order of the effect's controls block, wrapping at the canvas width; cards not in code follow. Saved through auto-save.

**FR-CEH-4 — Reset positions.** A header button returns every card to the default cascade (the layout used when no position is stored). Saved through auto-save.

## Scope toolbar popovers — `FR-SCI-15`…`FR-SCI-17` (intake 2026-10-03)

Source: `01_input-ideas.md`, 2026-10-03; mockup `docs/mockups/v22-scope-instrument_alt1.html`. Milestone: **M75**. Continues the `FR-SCI-*` family (last used: `FR-SCI-14d`).

**Decisions recorded 2026-10-03:** the five settings below become value chips with a choice popover; a non-default chip is marked with amber text plus a `●` (not colour alone); Time, Freeze, 1× Single and snapshot/CSV are unchanged; nothing new is persisted.

**FR-SCI-15 — Value chips.** In the Scope toolbar, *Gain* (×1 / ×2 / ×4 / Auto), *Scale* (Linear / dBFS) and *Trigger* (edge Free / ↗ / ↘ plus source In / L), and in the spectrum bar the *frequency axis* (Lin Hz / Log Hz) and *level mode* (Relative / Absolute dBFS), are each a single button showing only the current value and a ▾ caret, replacing the segmented groups. The Trigger chip reads `Free`, or the edge glyph and source, e.g. `↗ In`. Choosing a value has exactly the effect the matching segment had, including the emulator-capture planning for trigger changes. Defaults are unchanged: Gain ×1, Scale Linear, Trigger Free, Log Hz, Absolute dBFS.

**FR-SCI-16 — Choice popover.** Clicking a chip opens an opaque popover anchored under it (flipped above when there is no room, and kept inside the viewport) listing the choices as a single-choice list with a ✓ on the active one. The Trigger popover has two groups, *Edge* and *Source*; Source is disabled while the edge is Free, and picking Rising or Falling keeps the popover open so the source can be chosen next. The popover closes on a pick (except as above), on Esc and on a click outside; Esc returns focus to the chip. Keyboard: Enter/Space opens, ↑/↓ move, Enter picks. Chips carry `aria-haspopup="menu"` and `aria-expanded`; entries are `menuitemradio` with `aria-checked`. Colours come from the shared theme tokens (`--ds-dropdown-bg`, `--ds-dropdown-fg`, `--ds-focus`), so the popover is readable in dark, light and high-contrast themes. The Space-to-freeze shortcut keeps working and does not fire while a chip or popover has focus.

**FR-SCI-17 — Non-default marker.** A chip whose value differs from its default shows its value in the warning colour with a `●` before it, and its accessible name ends with "(changed from default)". At the defaults the chip has neither.

## Scope toolbar popovers — acceptance notes

The Scope toolbar fits one row at the 560 px split-beside-code width with all five chips present (measured in the manual test, `FR-TEST-1` page).

## Expanded Input types — `FR-GEN-*` (intake 2026-10-03)

Source: `01_input-ideas.md`, 2026-10-03; mockup `docs/mockups/v23b-effect-testing-layered.html` (Input select and per-generator parameter row only — A/B, Compare, automation, presets and golden tests in that mockup are not part of this intake); `docs/raw/test_framework/effect-testing-features.md` §3.1, §5.1. Milestone: **M76**.

**Decisions recorded 2026-10-03:** all seven generators; Impulse and Step repeat with a Period; the Time select is never changed by a generator; External entries unchanged; Two-tone frequencies fixed.

**FR-GEN-1 — Grouped Input select.** The Scope's Input select has two groups. *Generators*: Sine, Noise, Log sweep, Impulse, Step, Silence, Two-tone. *External*: Live (mic), WAV. Sine stays the default. Selecting an External entry behaves exactly as today, including the buffer, latency and WAV fields.

**FR-GEN-2 — Generator definitions.** Each generator has a parameter row in the emulator bar, shown only while it is selected; Amp is 0–1 for all of them.

| Generator | Signal | Parameters |
|---|---|---|
| Sine | sine wave (existing) | Freq 20–20000 Hz, Amp |
| Noise | white (uniform) or pink (≈ −3 dB/octave); never exceeds ±Amp | White / Pink, Amp |
| Log sweep | sine whose frequency rises exponentially from From to To over Time, then restarts; phase-continuous within a sweep | From, To (20–20000 Hz, To > From), Time 0.5–60 s, Amp |
| Impulse | a single sample of value Amp every Period, zero otherwise | Amp, Period 10–5000 ms |
| Step | square wave: 0 and Amp, switching every Period | Amp, Period 10–5000 ms |
| Silence | exact digital zero | none |
| Two-tone | 60 Hz at 0.8 × Amp plus 7 kHz at 0.2 × Amp (4:1); the sum never exceeds Amp | Amp |

Silence, Impulse, Step and Two-tone show a short dim hint beside their fields saying what they are for. Out-of-range values are clamped.

**FR-GEN-3 — Emulator input stage.** The emulator generates the selected signal in its input stage in place of the sine branch, identically on both input channels, in simulated-clock and real-time audio modes. Generation is real-time safe: no allocation, lock or syscall on the audio thread. It is deterministic: noise comes from a fixed-seed PRNG, and every generator's phase, filter state and counters reset whenever the generator is selected or its parameters are applied from a stopped stream, so identical settings give identical samples. A parameter change while running takes effect from the next block and keeps phase continuous where the signal has a phase. The session recorder records generator output as it records any input.

**FR-GEN-4 — Host ↔ emulator contract.** A new host-to-emulator `generator` message carries the generator kind and its parameters; the emulator validates and clamps every field. Selecting Sine keeps using the existing `sine` message. The panel remembers each generator's parameters for the session and re-sends the current ones when the emulator (re)starts, as it does for sine today. The webview's `audioSource` message accepts the new input ids, validated by the host.

**FR-GEN-5 — Time base untouched.** Selecting a generator leaves the Time select, Gain, Scale and Trigger as they are.
