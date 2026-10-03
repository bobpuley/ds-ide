# 02 — Assumptions & Risks (v24)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v23 complete** — all v23 bets held; risks resolved or managed.
> Archived: [`docs/v23/02_assumptions-and-risks.md`](v23/02_assumptions-and-risks.md).

## Reachability — M73 (intake 2026-10-01)

- **Bet:** the five show/focus commands are enough to recover any closed surface; no panel-open-state tracking (`panelState`, "Open" vs "Focus" label) is needed in this milestone. It stays deferred with `design_plan.md` §5.3.
- **Decision:** *Show Scope* with no emulator running opens the Scope in its idle state (existing onboarding hint) and fills when the next run starts. It never triggers a build.
- **Risk — walkthrough rot:** walkthrough steps name commands and views; a rename would silently break them. Mitigated by FR-RCH-4, whose lint also checks the walkthrough's command links.
- **Risk — silent loss on auto-save:** removing the explicit save removes the user's chance to discard a layout. Mitigated by the existing `controllers.yaml` being a plain, version-controlled file.
> ⚠️ ASSUMPTION: `contributes.walkthroughs` is shown by VS Code on the Welcome page after install without extra activation code; to be confirmed on a clean profile during the manual test.

## Editor polish — M74 (intake 2026-10-01)

- **Decision:** removing the header's ▶/■ marker keeps the cards' "disabled while the emulator is stopped" dimming; only the glyph goes.
> ⚠️ ASSUMPTION: a 20 px grid suits the cards (minimum width 132 px, default cascade step 190 × 170 px); confirm in the manual test.
> ⚠️ ASSUMPTION: auto-arrange orders cards by their order in the effect's `ds-ide:controls` block and wraps at the canvas's usable width; "not in code" placeholder cards follow the others.
- **Risk — destructive layout buttons:** Align to grid, Auto-arrange and Reset positions overwrite positions the user placed by hand, and auto-save persists them. There is no undo; mitigated by `controllers.yaml` being version-controlled, and recorded here so a layout undo can be raised later.

## Scope toolbar popovers — M75 (intake 2026-10-03)

- **Decision:** a chip whose value is not the default is marked with amber text **and** a `●` before the value; the chip's accessible name also says "changed from default", so colour is never the only cue (design_plan P2-1). Defaults: Gain ×1, Scale Linear, Trigger Free, frequency axis Log, level mode Absolute dBFS.
- **Decision:** the Time select, Freeze, 1× Single and the snapshot/CSV buttons keep their current form — Time is already a select that shows only its current value, and the others are actions, not settings.
- **Decision:** chip values are session state exactly as the segmented controls were; nothing new is persisted.
- **Risk — one extra click:** changing Gain, Scale, Trigger, frequency axis or level mode now costs two clicks (open, pick) instead of one. Accepted in exchange for width and an at-a-glance current value; the Trigger popover offsets it by staying open after an edge is picked so the source is one more click.
- **Risk — popover clipping:** the Scope panel can be short and narrow when split beside code. Mitigated by fixed positioning, clamping to the viewport width and flipping above the chip when there is no room below (FR-SCI-16).
- **Risk — popover surface not opaque:** the mockup's first version rendered a see-through popover because its colour token did not resolve where the element lived. The webview's popover must use tokens defined on `body` (`--ds-dropdown-bg`, `--ds-dropdown-fg`) and be covered by a test that fails if its background is unset.
- **Risk — test churn:** `src/test/unit/webview/scope-panel.test.ts` asserts the segmented-control markup (`gain-seg`, `unit-seg`, `trig-seg`, `trigsrc-seg`, `fscale-seg`, `lmode-seg`); it is updated with the markup, not loosened.
> ⚠️ ASSUMPTION: the existing theme tokens `--ds-dropdown-bg` / `--ds-dropdown-fg` (mapped to `--vscode-dropdown-*` in `theme-css.ts`) give the popover enough contrast against the editor surface in dark, light and high-contrast themes; to be confirmed in the manual test.
> ⚠️ ASSUMPTION: an inline popover element in the webview (`position: fixed`) is sufficient; no use of VS Code's quick-pick or a native menu is needed, since neither is available inside a webview.

## Expanded Input types — M76 (intake 2026-10-03)

- **Decision:** a new milestone, **M76 (0.24.3)**, separate from the UI-only M75, because it needs emulator audio code and a new IPC message.
- **Decision:** all seven generators ship together: Sine (existing), Noise (white / pink), Log sweep, Impulse, Step, Silence, Two-tone.
- **Decision:** Impulse and Step **repeat** with a *Period* field, because the Scope shows a rolling window of a continuous stream and a one-shot would scroll away. Impulse fires one sample every Period; Step is a square wave that switches every Period.
- **Decision:** selecting a generator never changes the Time select. The layered mockup's automatic 400 ms span is dropped; the shipped Time select tops out at 20 ms/div and stays as is.
- **Decision:** the External entries (Live (mic), WAV) keep their current labels, behaviour and extra fields (buffer, latency, WAV chooser). Only the grouping changes.
- **Decision:** Two-tone uses fixed frequencies (60 Hz and 7 kHz, 4:1 amplitude ratio); only Amp is adjustable.
- **Risk — real-time safety:** generators run on the audio thread in place of the sine branch, so they must not allocate, lock or make syscalls (FR-RTS-3 convention). All state (phases, PRNG, pink-noise filter, repeat counters) is plain data owned by the engine; parameters arrive through atomics.
- **Risk — loudness:** with live host output (v2) a generator is played through the speakers; noise, impulses and sweeps are harsh at high level. Defaults are conservative (Amp 0.25) and the header's Vol slider still applies.
- **Risk — reproducibility:** noise uses a fixed-seed integer PRNG reset on every selection, so identical settings give identical samples; but `std::sin` and `std::pow` may differ in the last bits across platforms, so any later regression comparison must use a tolerance, not bit equality.
- **Risk — sweep at fine time bases:** at 20 ms/div or finer the Scope shows only a short slice of a sweep, which looks like a steady tone that slowly changes pitch. Expected for a rolling window; showing the current sweep frequency is out of scope for M76.
> ⚠️ ASSUMPTION: parameter ranges — Amp 0–1 (default 0.25); sweep From/To 20–20000 Hz with To > From, Time 0.5–60 s (defaults 20 Hz, 20 kHz, 5 s); Period 10–5000 ms (default 500 ms). Out-of-range values are clamped on both the host and emulator side. To be confirmed in the manual test.
> ⚠️ ASSUMPTION: no `PROTOCOL_VERSION` bump is needed. The extension and emulator ship in one package, and an emulator that predates the `generator` message ignores unknown message types.
> ⚠️ ASSUMPTION: pink noise is an approximation (a fixed multi-pole filter on white noise, about −3 dB/octave between 20 Hz and 20 kHz); exact pinking is not required for the measurements this input is for.
