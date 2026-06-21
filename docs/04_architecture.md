# 04 — Architecture (v7)

> **v6 complete** — full v6 architecture in
> [`docs/v6/04_architecture.md`](v6/04_architecture.md).

## M27 — Controls Editor UI redesign (FR-CE-10)

No architecture change. The redesign is confined to the WebView HTML/CSS/JS inside `controls-view-provider.ts`. No new IPC messages, no new extension commands, no changes to `ControllerConfig` data structures.

## M27 — View exclusivity (FR-VW-1)

Small behavioral addition in the extension host. `ControlsViewProvider` and `WiringViewProvider` each expose their `resolveWebviewView` lifecycles; the extension currently wires them independently. To implement exclusivity, each provider's `onDidChangeVisibility` handler will call `vscode.commands.executeCommand` to focus the opposing panel's container (which collapses the sibling view) when its own view becomes visible. No new components, no IPC changes, no data model changes. The exact VS Code command to programmatically collapse a `WebviewView` panel shall be confirmed during implementation (candidate: focusing the parent view container of the sibling, which VS Code treats as a collapse of the current one).
