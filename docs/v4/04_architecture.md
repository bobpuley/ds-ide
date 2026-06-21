# 04 — Architecture (v4)

> **v1 complete** — v1 architecture (C1–C6, JSON-over-socket IPC) validated in M0–M7.
> Archived: [`docs/v1/04_architecture.md`](v1/04_architecture.md).
>
> **v2 complete** — v2 extended the architecture with real-time audio clock (two modes),
> CoreAudio device abstraction, GPIO/Switch shim (C5), LED capture, hardware build drivers
> (C7, C8), visual controller editor, spectrum, session recording, and scope UI refresh.
> Archived: [`docs/v2/04_architecture.md`](v2/04_architecture.md).
>
> **v3 complete** — v3 added C9 (controls convention parser) and C10 (Wiring Editor panel).
> D18 two-mode Controls Editor shipped in M17; superseded by D19 (v4).
> Archived: [`docs/v3/04_architecture.md`](v3/04_architecture.md).

Technical design for **ds-ide v4**, extending the v3 architecture for the requirements in
[03_requirements.md](03_requirements.md).

---

## 1. v2 architecture summary (v4 update: C2 split, C11 added)

```
┌───────────────────────────────── VS Code ──────────────────────────────────┐
│  Extension host (TypeScript / Node) — C1                                    │
│  Webview panel — C2 (scope + spectrum)         [Controls Editor extracted]  │
│  Secondary sidebar — C11 (Controls Editor WebviewView + Wiring Editor WebviewView) │
└───────┬────────────────────────────────────────┬────────────────────────────┘
        │ IPC (JSON/socket)                      │ DAP (lldb-dap, C6)
        ▼                                        ▼
┌──────────────────── Emulator runtime (native process) ──────────────────────┐
│  C4: audio engine (real-time / simulated clock), scope tap                   │
│  C5: host libDaisy shim (ADC, Switch/GPIO, LED, audio cb)                    │
│  user effect + DaisySP (compiled unchanged)                                   │
└──────────────────────────────────────────────────────────────────────────────┘
             C7: HW build driver    C8: DFU flash driver
```

**v4 structural change:** C2 is split. Controls Editor is extracted from C2 into C11 (secondary
sidebar `WebviewView`). C2 retains Scope and Spectrum only. C10 (Wiring Editor) is converted
from a `WebviewPanel` to a `WebviewView` in C11. See §8 (C11 design) below.

All C1–C8 components, IPC messages, and architectural decisions from v2 carry forward
unchanged except as noted above. See [`docs/v2/04_architecture.md`](v2/04_architecture.md)
for the full v2 component table, IPC message table, GPIO shim design, hardware build
architecture, and open v2 items (all resolved).

---

## 2. v3 new components

| # | Component | Tech | Purpose |
|---|-----------|------|---------|
| **C9** | Controls convention parser | TS module (C1) | Parse C++ source for `// ds-ide:controls:begin/end` block; extract `{id, kind, pin}` per annotated line. Pure function — no I/O. |
| **C10** | Wiring Editor panel | TS + HTML webview | ~~Separate VS Code `WebviewPanel`~~ — **v4: converted to `WebviewView` in C11** (D21). Shows Daisy Seed pinout SVG. Handles click-to-assign. Triggers C++ file writes via C1. No emulator IPC. |

## 2b. v4 new components

| # | Component | Tech | Purpose |
|---|-----------|------|---------|
| **C11** | DS-IDE secondary sidebar container | VS Code `viewsContainer` + 2× `WebviewView` | Hosts Controls Editor (`WebviewView`) and Wiring Editor (`WebviewView`) as persistent views in the VS Code secondary sidebar (right panel). Registered via `contributes.viewsContainers` and `contributes.views` in `package.json`. C1 holds the `WebviewViewProvider` implementations for both views. (D21) |

---

## 3. Controls Editor design (C2 + C9)

### v3 design (D18, shipped M17 — superseded)

The v3 Controls Editor unified the old split panel into a single C2 panel with explicit Design
and Run modes. Retired by D19 (v4). The C9 parser, `controlsConfig` message contract, and all
IPC channels are unchanged.

### v4 design (D19, single-mode handle UX)

No new components. C9, C1, C2 wiring, and IPC channels are identical to v3.
The change is entirely within C2's rendering and interaction model.

```
On open / project load (unchanged from v3):
  C1 → C9: parse effect source
    → convention block found: controls[] extracted
    → block absent: controls[] = [], missingBlock = true
  C1 reads controllers.yaml → placements[] (editor_pos values)
  C1 → C2: postMessage controlsConfig{ controls[], placements[], missingBlock }
  C2 Controls Editor renders canvas — single mode, always visible

Rearranging (always available, emulator stopped or running):
  User drags a control via its drag handle
  C2 updates position in memory
  Save → C2 → C1 → write updated controllers.yaml (positions only)
  C++ source NOT modified

Live interaction (emulator running):
  Control bodies become interactive (pot slider, button, LED)
  Pot drag → IPC `pot` (unchanged v2 channel)
  Button click → IPC `button` (unchanged v2 channel)
  LED state → IPC `led` events (unchanged v2 channel)

Emulator stopped:
  Control bodies are rendered but grayed-out; interactions disabled
  Drag-handle rearrangement remains fully functional

Fallback (missingBlock = true):
  C2 shows diagnostic banner
  Controls rendered from controllers.yaml only (unchanged from v3)
```

**No new IPC messages.** All v2 IPC channels reused. C2 tracks emulator running state via the
existing `emulatorState` message from C1 (v2 contract, unchanged).

---

## 4. Wiring Editor design (C10)

The Wiring Editor is a separate VS Code webview panel (not C2). It is design-time only and
sends no messages to the emulator runtime.

```
User: ds-ide.openWiringEditor command
  C1 spawns C10 webview panel
  C1 → C9: parse effect source → wiredPins[] (existing assignments)
  C1 → C10: postMessage wiredPins[]
  C10 renders SVG pinout; assigned pins shown with control icons

User: click an unassigned pin
  C10: show device popup (Pot / Button / LED + editable id field)
  If non-ADC pin + Pot: show warning badge (do not block)

User: select device type + confirm id
  C10 → C1: postMessage wirePin{ pinNumber, deviceType, id, label }
  C1 → controls-writer: insert declaration into ds-ide:controls block
      (create block if absent; insert before // ds-ide:controls:end)
      write via VS Code workspace edit (undoable)
  C1 → C9: re-parse effect source → updated wiredPins[]
  C1 → C10: postMessage wiredPins[]
  C10: update SVG — pin now assigned, control icon rendered
  C1 → C2: postMessage controlsConfig{ controls[], placements[], missingBlock }
  C2 Controls Editor: refreshes canvas with new control (if panel is open)

User: click an assigned pin
  C10: show assigned-pin popup (device type, id, Remove button)

User: confirm Remove
  C10 → C1: postMessage unwirePin{ pinNumber }
  C1 → controls-writer: delete annotation line for that pin from ds-ide:controls block
      write via VS Code workspace edit (undoable)
  C1 → C9: re-parse effect source → updated wiredPins[]
  C1 → C10: postMessage wiredPins[]
  C10: update SVG — pin now unassigned
  C1 → C2: postMessage controlsConfig (refreshed, if C2 open)
```

**ADC-capable pins (for FR-WE-3 warning logic):**
The Daisy Seed exposes 12 ADC-capable pins labeled A0–A11. These are also reachable by
their digital aliases D15–D26 (A0=D15, A1=D16, … A11=D26). Source: `emulator/shim/include/daisy/gpio.h`.

| A-label | D-alias |
|---------|---------|
| A0      | D15     |
| A1      | D16     |
| A2      | D17     |
| A3      | D18     |
| A4      | D19     |
| A5      | D20     |
| A6      | D21     |
| A7      | D22     |
| A8      | D23     |
| A9      | D24     |
| A10     | D25     |
| A11     | D26     |

The Wiring Editor shows all pins with their canonical label (A-label for analog-capable,
D-label for digital-only). The warning fires when `kind=pot` and the clicked pin is not in
the A0–A11 set (i.e., it is a D-only pin: D0–D14, D27–D30).

**`id` and `varname` generation:**
- Default `id`: `<kind><n>` where `<n>` is the lowest integer ≥ 1 not already used by an
  existing id in the convention block (e.g. `pot1`, `pot2`, `button1`).
- The device popup pre-fills the id field with this default; the developer may edit it.
- Validation (before write): id must be unique within the convention block; reject with an
  inline error if a collision is detected.
- `varname` is always identical to the confirmed `id`.

**Effect source file discovery (C1):**
- Check `ds-ide.effectSource` workspace setting
- Else: first `.cpp` found adjacent to `CMakeLists.txt` in the project root
- If not found: surface an error in the Wiring Editor panel

**Write safety:** C1 validates that `// ds-ide:controls:begin` and `// ds-ide:controls:end`
markers are at column 0 before writing. Write is a VS Code `WorkspaceEdit` — fully undoable.

---

## 5. C9 convention parser design

```
Input:  C++ source text (string)
Output: { controls: Array<{id, kind, pin}>, missingBlock: boolean, errors: string[] }

Algorithm:
  1. Scan for line matching /^\/\/ ds-ide:controls:begin\s*$/
  2. Scan for line matching /^\/\/ ds-ide:controls:end\s*$/
  3. If either marker missing → return { controls: [], missingBlock: true }
  4. For each line between markers:
       match /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/
       if match: add { id, kind, pin } to controls[]
       else: add error "unrecognised annotation on line N"
  5. Return { controls, missingBlock: false, errors }
```

Pure function — no filesystem access. Caller provides the text string.

---

## 6. New internal messages (v3)

No new IPC messages to the emulator runtime. New messages are internal (C1 ↔ C2, C1 ↔ C10):

| Direction | Message | Payload |
|-----------|---------|---------|
| C1 → C2 | `controlsConfig` | `controls[]` (id, kind, pin), `placements[]` (id, pos), `missingBlock` |
| C10 → C1 | `wirePin` | `pinNumber`, `deviceType`, `id`, `label` |
| C1 → C10 | `wiredPins` | `pins[]` (pinNumber, deviceType, id, label) |

---

## 7. VS Code Run command integration (C1 + DebugConfigurationProvider)

ds-ide registers a `DebugConfigurationProvider` for a `ds-ide` debug type in C1. (D20, A19)

```
// package.json contribution point
"contributes.debuggers": [{ "type": "ds-ide", "label": "DS-IDE" }]
"contributes.debugConfigurationProvider": registered programmatically in C1 activate()

Default launch.json snippet (ds-ide provides initialConfigurations):
{
  "type": "ds-ide",
  "request": "launch",
  "name": "DS-IDE: Build, Deploy & Debug"
}

F5 (Start Debugging) flow:
  VS Code → C1 DebugConfigurationProvider.resolveDebugConfiguration()
    → stop running emulator (if active) via existing stop IPC
    → execute "Build for Emulator" (FR-CM-1 build step)
    → if build fails: reject with error in Output panel; abort
    → execute "Deploy to Emulator" (FR-CM-1 deploy step)
    → start lldb-dap session (C6): attach to emulator process
    → return resolved config to VS Code; Debug toolbar appears

Ctrl+F5 (Start Without Debugging) flow:
  VS Code passes noDebug=true to resolveDebugConfiguration()
    → same stop → build → deploy sequence
    → skip lldb attach; emulator runs freely
    → return; no Debug toolbar
```

No new IPC messages to the emulator runtime. The existing build, deploy, and stop commands
are reused as internal functions called by the provider.

---

## 8. Secondary sidebar panels — C11 design (D21, A20)

C11 is a VS Code `viewsContainer` registered in `contributes.viewsContainers.activitybar`
(or secondary panel location), hosting two `WebviewView` registrations:

```
// package.json contribution points
"contributes.viewsContainers": {
  "activitybar": [{ "id": "ds-ide-sidebar", "title": "DS-IDE", "icon": "..." }]
}
"contributes.views": {
  "ds-ide-sidebar": [
    { "type": "webview", "id": "ds-ide.controlsEditor", "name": "Controls" },
    { "type": "webview", "id": "ds-ide.wiringEditor",   "name": "Wiring" }
  ]
}
```

**WebviewViewProvider pattern (same for both views):**

```
C1 activate():
  vscode.window.registerWebviewViewProvider("ds-ide.controlsEditor", controlsViewProvider)
  vscode.window.registerWebviewViewProvider("ds-ide.wiringEditor",   wiringViewProvider)

controlsViewProvider.resolveWebviewView(view):
  view.webview.options = { enableScripts: true }
  view.webview.html = getControlsEditorHtml()
  → wire onDidReceiveMessage (same handlers as current C2 controls section)
  view.onDidChangeVisibility(() => {
    if (view.visible) C1 re-sends controlsConfig to view.webview
  })

wiringViewProvider.resolveWebviewView(view):
  view.webview.html = getWiringEditorHtml()
  → wire onDidReceiveMessage (same handlers as current C10)
  view.onDidChangeVisibility(() => {
    if (view.visible) C1 re-sends wiredPins to view.webview
  })
```

**State re-hydration on visibility restore** (mitigates R24):
Both views re-send their current config when `onDidChangeVisibility` fires with `visible=true`.
`retainContextWhenHidden: true` is set to avoid blank state flicker on sidebar show/hide.

**C2 changes:**
Controls Editor HTML/JS is extracted from C2's webview bundle. C2 retains only the Scope and
Spectrum sections. The `controlsConfig` message is now routed to `controlsViewProvider.webview`
instead of the C2 panel webview. The `emulatorState` message is broadcast to both C2 and C11
controls view so grayed-out state is maintained.

**No new IPC messages to emulator runtime.** Internal C1↔C11 messages reuse the existing
`controlsConfig`, `wiredPins`, `wirePin`, `unwirePin`, `emulatorState` contracts.

---

## 9. Open architectural items

| Item | Current stance |
|------|----------------|
| Effect source auto-detection | Check `ds-ide.effectSource` workspace setting first; else first `.cpp` adjacent to `CMakeLists.txt`. **Resolved in M18.** |
| Convention block location in file | Append to end of file if absent (before final `}`). "Column 0" safety rule validated in M18. **Resolved.** |
| Controls Editor mode persistence | **Resolved/superseded by D19:** no mode toggle exists. Handle drag is always active; body interaction is gated on `emulatorState`. |
| Pot interaction model (FR-CE-7) | **Resolved:** vertical drag (click-drag up = increase, down = decrease). Decided 2026-06-20. |
| xruns counter: same or different data in header vs. Emulator section | **Resolved (2026-06-20):** same metric. Keep header `#status-text` only; remove `#xrun-group` / `#xrun-sine-group` from Emulator section body. AC-31 written. |
| VS Code Run commands (F5/Ctrl+F5) | **Resolved (2026-06-20):** `DebugConfigurationProvider` for `ds-ide` type (§7). D20, FR-CM-3/4. |
| Secondary sidebar panels | **Resolved (2026-06-20):** C11 `viewsContainer` with two `WebviewView`s (§8). D21, FR-CE-8, FR-WE-10. |
| Effect Project Wizard (v5) | C1-only addition: new command, embedded template strings. No new components. Architecture to be elaborated in v5 docs. D22. |
| Init block code generation (v5) | C9 parser extended to parse `// ds-ide:controls:init:begin/end`. Controls-writer extended to generate per-type init calls + ADC aggregate call. Wiring Editor (C10/C11) triggers init writes. Architecture + ADC grouping design to be elaborated in v5 docs. D23, A21. |
