# 04 — Architecture (v24)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).

## Reachability — M73 (2026-10-01)

No architecture change. Show/focus commands call the existing `ScopePanel` / `OledPanel` / `MidiPanel` `show()` methods and the built-in `workbench.view.extension.*` focus commands; `viewsWelcome` and `walkthroughs` are manifest-only; auto-save reuses the existing `editorSave` webview message, debounced in the webview. Panel open-state tracking (`panelState`) is deliberately not added.
