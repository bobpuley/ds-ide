# 01 — Input Ideas (v4)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).

This document collects **v4 feature ideas**. v4 planning started 2026-06-20.

---

## 1. v3 north star (recap)

v3 made the development environment smarter: the IDE understands the hardware design, not just
the runtime state. Developers can visually wire physical devices to Daisy Seed pins — and the
IDE writes the matching C++ declarations.

---

## 2. v4 north star

v4 **refines the interaction model**: the Controls Editor moves from an explicit two-mode panel
(Design / Run) to a single always-on canvas with handle-based rearrangement. Pot controls get
a hardware-style visual. The command surface is trimmed for the hot path. The Wiring Editor SVG
gets orientation cues and legible ID labels.

---

## 3. v4 bug backlog (from post-v3 review, 2026-06-20)

### 3a. Bugs & UX issues

- **Bug: Wiring Editor — wired control IDs not clearly visible in SVG** — the ID label of an
  assigned control is hard to read in the current SVG layout (screenshot: `to_check_screenshot_1.png`).
  Two candidate fixes: (1) shift label right, same vertical, centred between circle and Daisy Seed
  diagram; (2) shift label left, vertically aligned to the pin row. *(Scheduled: M19, T19-4)*

- **UX: "xruns" label appears in both Scope view header and Emulator section** — unclear whether
  both counters represent the same data or different data. If the same: consolidate. If different:
  rename one for clarity. *(Scheduled: M19, T19-6 — requires investigation)*

---

## 4. v4 feature ideas

### 4a. Controls Editor: single-mode handle UX

Replace the v3 two-mode Design/Run panel (D18) with a unified single-mode panel (D19):
- Each control has a **drag handle**. Dragging the handle rearranges the layout at all times
  (emulator stopped or running).
- Interacting with the **control body** (pot/button/LED) is available only while the emulator
  is running; otherwise controls are visible but grayed-out.
- No explicit mode toggle. Emulator state is shown in the panel header or status area.
- (A18, confirmed 2026-06-20) *(Scheduled: M20, T20-1)*

### 4b. Controls Editor: visual controls improvement

- Pot controls visually resemble a real hardware rotary knob.
- Look and feel consistent with the Wiring Editor panel.
- Pot interaction model TBD: mouse wheel vs. vertical drag. *(Open — must resolve before M20 T20-2)*
- *(Scheduled: M20, T20-2 — blocked on interaction model decision)*

### 4c. Command improvements

- **"Build & Deploy to Emulator" combined command** — replaces the two-step "Build" then "Deploy"
  flow. Sequential; blocks deploy on build failure. *(Scheduled: M19, T19-1)*
- **Stop Audio / Start Audio in Scope header** — toolbar buttons alongside the existing palette
  commands; reflect emulator running/stopped state. *(Scheduled: M19, T19-2)*

### 4d. Scope UX

- **Session recording button label simplification** — "() Record" → "()", "[] Stop" → "[]".
  *(Scheduled: M19, T19-3)*

### 4e. Wiring Editor visual

- **Micro USB port indicator on Daisy Seed SVG** — minimal shape to convey board orientation.
  *(Scheduled: M19, T19-5)*
- **Evaluate adding a user-visible label per control** — separate from `id`/`varname`; purely
  visual in the SVG diagram. Decision deferred: needs design exploration.

---

## 5. v4 open questions (need decisions before design)

- **Controls / Wiring Editor as panes of the effect source editor** — embed as side-by-side panes
  next to the `.cpp` source in the VS Code editor group? *Trade-off: convenience vs. VS Code API
  constraints for custom editor panels.*

- **VS Code "Run → Start Debugging" / "Run → Start Without Debugging" in ds-ide context** —
  currently unclear whether ds-ide hooks into these built-ins. Needs investigation.

- **Implementation template / "Create new effect" wizard** — starter template with `// ds-ide:controls`
  convention comments, or a wizard command that scaffolds a new effect project?

- **Extend controls convention to initialization block** — add `// ds-ide:controls:init:begin`
  and `// ds-ide:controls:init:end` markers to also generate/manage `.InitSingle()` / `.Init()`
  calls. Natural follow-on to D16 (declarations only in v3).

- **Plugin extension points: declarative control definition** — a mechanism by which third parties
  or the user can define new control types that the Controls and Wiring Editors understand. Large,
  exploratory — not yet scoped.

---

## 6. Roadmap

| Phase | Theme | Key features | Status |
|-------|-------|--------------|--------|
| **v1** | Foundation | Native simulation; VS Code extension; pots; scope; breakpoints | ✅ complete (M0–M7) |
| **v2** | Realism | Live audio I/O; WAV; buttons/GPIO/LEDs; visual editor; full debug; HW build; spectrum; recording; scope UI | ✅ complete (M8–M15) |
| **v3** | Editor intelligence | Controls Editor v3 (two-mode, code inference); Wiring Editor (SVG pinout, C++ gen); spectrum/scope polish | ✅ complete (M16–M18) |
| **v4** | UX refinement | Controls Editor single-mode handle UX; Wiring Editor polish; command cleanup; visual controls improvement | 🔵 planning |
| **vX** | Pre-public release | Built-in board maps; auto-derived controllers (arbitrary code); MIDI; cross-platform audio+debug; ARM toolchain bundle | planned |

---

## 6. Post-v3 review (from to_check.md, 2026-06-20)

Ideas and issues identified after shipping v3 (M16–M18). These feed v4 planning.

### 6a. Bugs & UX issues

- **Bug: Wiring Editor — wired control IDs not clearly visible in SVG** — the ID label of an
  assigned control is hard to read in the current SVG layout (screenshot: `to_check_screenshot_1.png`).
  Two candidate fixes: (1) shift label right, same vertical, centred between circle and Daisy Seed
  diagram; (2) shift label left, vertically aligned to the pin row. *(Bug: visual)*

- **UX: "xruns" label appears in both Scope view header and Emulator section** — unclear whether
  both counters represent the same data or different data. If the same: consolidate. If different:
  rename one for clarity. *(Needs investigation before classifying as bug or feature)*

### 6b. Feature ideas

- **Commands: move Stop Audio / Start Audio into Scope view header** — currently palette commands
  only. Exposing them as header toolbar buttons reduces friction for the most common audio
  lifecycle actions.

- **Commands: add "Build & Deploy to Emulator" combined command** — currently "Build for Emulator"
  and "Deploy to Emulator" are separate. A single combined command reduces the number of steps
  in the hot path.

- **Scope: simplify session recording button labels** — "() Record" → "()", "[] Stop" → "[]".
  Cleaner look; icons carry the meaning without text.

- **Controls Editor: replace two-mode Design/Run panel with single-mode handle UX** — the current
  D18 two-mode design (explicit Design / Run toggle) is replaced by a unified single mode where:
  each control has a drag handle; dragging the handle rearranges the layout; clicking/dragging/
  wheeling the control body (outside the handle) sends live interaction to the emulator. No
  explicit mode switch. Controls are always visible. Dragging a handle rearranges the layout
  at any time. Interacting with the control body (pot/button/LED) is disabled (grayed-out)
  when the emulator is not running. (A18, confirmed 2026-06-20)

- **Controls Editor: visual controls improvement** — knob visuals should more closely resemble
  real hardware. Interaction model for knobs should be decided (mouse wheel vs. vertical drag).
  Look and feel should match the Wiring Editor aesthetic.

- **Wiring Editor: add micro USB port indicator to Daisy Seed SVG** — minimal visual cue (just
  the USB port shape) to help the developer orient the board at a glance. Minimal change to the
  existing SVG asset.

- **Wiring Editor: evaluate adding a user-visible label to each assigned control** — separate
  from the `id`/`varname`. Purely visual in the Wiring Editor SVG; does not affect C++ output.
  Decision deferred: needs design exploration.

### 6c. Open questions (need decisions before design)

- **Controls / Wiring Editor as panes of the effect source editor** — is it useful/feasible to
  embed the Controls Editor and/or the Wiring Editor as side-by-side panes next to the `.cpp`
  source file in the VS Code editor group? *Trade-off: convenience vs. VS Code API constraints
  for custom editor panels.*

- **VS Code "Run → Start Debugging" and "Run → Start Without Debugging" — what do they mean in
  ds-ide context?** These are VS Code built-ins. Does ds-ide hook into them, and if so, how?
  Currently unclear. Needs investigation.

- **Implementation template / "Create new effect" wizard** — should ds-ide ship a starter
  template with detailed comments explaining the `// ds-ide:controls` convention? Or a wizard
  command that scaffolds a new effect project? *Trade-off: template is simpler; wizard is more
  guided.*

- **Extend controls convention to initialization block** — add `// ds-ide:controls:init:begin`
  and `// ds-ide:controls:init:end` markers so the IDE can also generate/manage the
  initialization calls (`knob1_cfg.InitSingle(...)`, etc.) and not just the declarations.
  *This is a natural follow-on to D16 (declarations only in v3).*

- **Plugin extension points: declarative control definition** — a broader mechanism by which
  third parties (or the user) can define new control types that the Controls and Wiring Editors
  understand, including code template integration. *Large, exploratory — not yet scoped.*

---

## Open Conflicts

- **D18 superseded** — the v3 decision D18 ("two-mode panel: Design / Run") is replaced by the
  single-mode handle-based UX described in §6b. Requirements (FR-CE-1, FR-CE-4, FR-CE-5) and
  architecture (§04 §3) must be updated before v4 work begins.
