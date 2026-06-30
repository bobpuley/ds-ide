# 02 — Assumptions & Risks (v10)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v9 complete** — all v9 bets held; risks resolved or managed.
> Archived: [`docs/v9/02_assumptions-and-risks.md`](v9/02_assumptions-and-risks.md).

## v10 Bets & Risks

### Bets (M34 — superseded by M35 revision)

> ~~⚠️ ASSUMPTION: `vscode.window.createWebviewPanel` is sufficient to give Controls Editor and Wiring Editor full independent window behaviour.~~ **Superseded by M35:** the design reverts to `WebviewViewProvider` in separate Activity Bar containers.

> ~~⚠️ ASSUMPTION: The existing DS-IDE activity bar sidebar container can be repurposed as a lightweight welcome/launcher view.~~ **Superseded by M35:** the single launcher container is removed in favour of two dedicated containers.

> ~~⚠️ ASSUMPTION: A `WebviewPanel` icon (`iconPath` property) is the only icon surface needed for v10 — no new activity bar icon.~~ **Superseded by M35:** Activity Bar icons in `viewsContainers.activitybar` are the primary icon surface.

### Bets (M35 — Activity Bar Split)

> ⚠️ ASSUMPTION: VS Code supports multiple `viewsContainers.activitybar` entries from a single extension, each with its own icon and independently managed sidebar panel, without any undocumented API.

> ⚠️ ASSUMPTION: `WebviewViewProvider`-based views in separate containers do not require mutual-exclusion logic; each view lives in its own sidebar slot and does not interfere with the other.

> ⚠️ ASSUMPTION: The SVG files already created for M34 (`media/controls-editor-icon-*.svg`, `media/wiring-editor-icon-*.svg`) are suitable for use as Activity Bar icons (Activity Bar renders at ~24×24, but 16×16 viewBox SVGs are upscaled cleanly).

### Risks

**Risk: State persistence on extension host reload**
`WebviewView` instances are hidden/shown but not disposed when the user switches Activity Bar icons. State in the webview persists naturally across hide/show. However, on VS Code window reload the webview is recreated and must be re-synced from the extension host.
**Mitigation:** Keep last-known `ControlsConfig` and wired-pin set in `EmulatorManager`; push to the webview on `onDidChangeVisibility` when it becomes visible (i.e. on first show after reload).

**Risk: Activity Bar density**
Adding two more icons to the Activity Bar increases visual clutter. Users who already have many extensions may find the sidebar busy.
**Mitigation:** Acceptable trade-off for the clarity of direct-access icons; no mitigation needed at this stage.

**Risk: Icon readability at Activity Bar size**
VS Code renders Activity Bar icons at ~24×24 px (larger than tab icons). Icons designed at 16×16 may appear slightly blurry when upscaled; Activity Bar icons typically work best at 24×24.
**Mitigation:** The existing SVGs are vector-based and scale cleanly; validate both icons in VS Code after wiring them to `viewsContainers`.
