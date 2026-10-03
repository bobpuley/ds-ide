# 04 — Architecture (v24)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).

## Reachability — M73 (2026-10-01)

No architecture change. Show/focus commands call the existing `ScopePanel` / `OledPanel` / `MidiPanel` `show()` methods and the built-in `workbench.view.extension.*` focus commands; `viewsWelcome` and `walkthroughs` are manifest-only; auto-save reuses the existing `editorSave` webview message, debounced in the webview. Panel open-state tracking (`panelState`) is deliberately not added.

## Editor polish — M74 (2026-10-01)

No architecture change. The legend is static markup in the Wiring Editor's HTML; the layout buttons are webview-only: they compute positions in a pure module, set the cards' styles, and call the existing `autoSave.schedule()`. No new IPC message and no `controllers.yaml` schema change (positions already persist as `pos`).

## Scope toolbar popovers — M75 (2026-10-03)

No architecture change. Webview-only: the chips and popover are markup and CSS in `src/webview/scope-panel.ts` and wiring in `src/webview/scope-webview.ts`; no new IPC or host message, no setting, no persistence. The menu definitions (options per chip, chip label text, default value, whether an entry is disabled) live in a new pure module `src/webview/scope/scope-chips.ts`, following the existing `scope/` convention (`scope-view.ts`, `scope-trigger.ts`, …: pure logic with unit tests, drawing and DOM in `scope-webview.ts`). State setters are the existing ones (`gainMode`, `ampUnit`, `trigMode`, `trigSource`, `freqScale`, `levelMode`), so downstream behaviour — including `syncCapture()` on a trigger change — is untouched. The popover uses only existing `--ds-*` tokens from `theme-css.ts`; no new token.

## Expanded Input types — M76 (2026-10-03)

Small additive change across three layers; no change to the process model.

- **Emulator.** A new pure class `InputGenerator` (`emulator/runtime/input_generators.{h,cpp}`) renders one block of a selected generator into the stereo input buffer from plain-data state (phase accumulators, an integer PRNG, a pink-noise filter, repeat counters). `audio_engine.cpp`'s input stage dispatches to it in place of the sine branch when a generator is active; the replay and WAV branches keep priority as today. Kind and parameters live in `EmulatorState` as atomics, written by the IPC thread, read once per block by the audio thread — the same pattern as `sine_freq` / `sine_amp`. The class has no dependency on the engine, so it is unit-tested standalone like `scope_capture.h` (`tests/input-generators/`).
- **IPC.** One new host-to-emulator message, `generator`, parsed in `ipc_server.cpp` with the existing `json_get` helpers, range-clamped before storing. `PROTOCOL_VERSION` is not bumped (see `02_assumptions-and-risks.md`). Nothing new flows emulator-to-host.
- **Host and webview.** The generator definitions (ids, labels, parameter names, defaults, ranges, hints) are a pure module shared by the panel markup and the webview (`src/webview/scope/scope-generators.ts`), per the `scope/` convention. `scope-panel.ts` builds the grouped Input select and the per-generator parameter groups; `scope-webview.ts` posts `audioSource` and generator parameter changes; `messages.ts` extends the `audioSource` input union; `EmulatorManager` gains `sendGenerator()` beside `sendSine()`.
