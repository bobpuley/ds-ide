# 04 — Architecture (v24)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).

## Reachability — M73 (2026-10-01)

No architecture change. Show/focus commands call the existing `ScopePanel` / `OledPanel` / `MidiPanel` `show()` methods and the built-in `workbench.view.extension.*` focus commands; `viewsWelcome` and `walkthroughs` are manifest-only; auto-save reuses the existing `editorSave` webview message, debounced in the webview. Panel open-state tracking (`panelState`) is deliberately not added.

## Editor polish — M74 (2026-10-01)

No architecture change. The legend is static markup in the Wiring Editor's HTML; the layout buttons are webview-only: they compute positions in a pure module, set the cards' styles, and call the existing `autoSave.schedule()`. No new IPC message and no `controllers.yaml` schema change (positions already persist as `pos`).