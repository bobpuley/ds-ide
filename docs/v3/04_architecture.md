# 04 — Architecture (v3)

> **v1 complete** — v1 architecture (C1–C6, JSON-over-socket IPC) validated in M0–M7.
> Archived: [`docs/v1/04_architecture.md`](v1/04_architecture.md).
>
> **v2 complete** — v2 extended the architecture with real-time audio clock (two modes),
> CoreAudio device abstraction, GPIO/Switch shim (C5), LED capture, hardware build drivers
> (C7, C8), visual controller editor, spectrum, session recording, and scope UI refresh.
> Archived: [`docs/v2/04_architecture.md`](v2/04_architecture.md).

Technical design for **ds-ide v3**, extending the v2 architecture for the requirements in
[03_requirements.md](03_requirements.md).

---

## 1. v2 architecture summary (unchanged in v3)

```
┌────────────────────────── VS Code ──────────────────────────┐
│  Extension host (TypeScript / Node) — C1                     │
│  Webview panel — C2 (scope + controls + spectrum + editor)   │
└───────┬───────────────────────────────────┬─────────────────┘
        │ IPC (JSON/socket)                 │ DAP
        ▼                                   ▼
┌──────────────── Emulator runtime (native process) ──────────┐
│  C4: audio engine (real-time / simulated clock), scope tap   │
│  C5: host libDaisy shim (ADC, Switch/GPIO, LED, audio cb)    │
│  user effect + DaisySP (compiled unchanged)                   │
└──────────────────────────────────────────────────────────────┘
             ▲ lldb-dap (C6)    C7: HW build driver
                                C8: DFU flash driver
```

All C1–C8 components, IPC messages, and architectural decisions from v2 carry forward
unchanged. See [`docs/v2/04_architecture.md`](v2/04_architecture.md) for the full v2
component table, IPC message table, GPIO shim design, hardware build architecture, and
open v2 items (all resolved).

---

## 2. v3 new components

| # | Component | Tech | Purpose |
|---|-----------|------|---------|
| **C9** | Controls convention parser | TS module (C1) | Parse C++ source for `// ds-ide:controls:begin/end` block; extract `{id, kind, pin}` per annotated line. Pure function — no I/O. |
| **C10** | Wiring Editor panel | TS + HTML webview | Separate VS Code panel. Shows Daisy Seed pinout SVG. Handles click-to-assign. Triggers C++ file writes via C1. No emulator IPC. |

---

## 3. Controls Editor two-mode design (C2 + C9)

The v3 Controls Editor merges the v2 "Controller Editor" tab and "Effect controls" section into
a single panel with Design and Run modes (D18).

```
On open / project load:
  C1 → C9: parse effect source
    → convention block found: controls[] extracted
    → block absent: controls[] = [], missingBlock = true
  C1 reads controllers.yaml → placements[] (editor_pos values)
  C1 → C2: postMessage controlsConfig{ controls[], placements[], missingBlock }
  C2 Controls Editor renders canvas (Design mode by default)

Design mode:
  User drags controls → C2 updates positions in memory
  Save → C2 → C1 → write updated controllers.yaml (positions only)
  C++ source NOT modified in Design mode

Run mode (emulator running):
  C2 Controls Editor IS the live control panel
  Pot sliders → IPC `pot` (unchanged v2 channel)
  Button clicks → IPC `button` (unchanged v2 channel)
  LED state → IPC `led` events (unchanged v2 channel)

Fallback (missingBlock = true):
  C2 shows diagnostic banner
  Controls rendered from controllers.yaml only (M10b behaviour)
```

**Mode persistence:** mode resets to Design whenever the emulator stops (or is never
started). Run mode is only reachable while the emulator is running; the panel switches to
Run automatically on emulator start and back to Design on emulator stop.

**No new IPC messages to the runtime.** Run mode reuses all v2 IPC channels.

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

## 7. Open architectural items (v3)

| Item | Current stance |
|------|----------------|
| Effect source auto-detection | Check `ds-ide.effectSource` workspace setting first; else first `.cpp` adjacent to `CMakeLists.txt`. Validate in M18. |
| Convention block location in file | Append to end of file if absent (before final `}`). Validate "column 0" safety rule in M18. |
| Controls Editor mode persistence | **Resolved:** mode always resets to Design when the emulator stops (or was never started). Run mode is only reachable while the emulator is running. No persistence required. |
