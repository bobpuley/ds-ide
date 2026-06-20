# 03 — Requirements (v4)

> **v1 complete** — all v1 requirements implemented; ACs AC-1…AC-8 green.
> Archived: [`docs/v1/03_requirements.md`](v1/03_requirements.md).
>
> **v2 complete** — all v2 requirements (FR-AU-5…FR-VE-4, NFR-11…12, CR-6…7) implemented;
> ACs AC-9…AC-17 green. Archived: [`docs/v2/03_requirements.md`](v2/03_requirements.md).
>
> **v3 complete** — all v3 requirements (FR-CE-1…FR-CE-6, FR-WE-1…FR-WE-7, FR-VZ-4, FR-UI-1)
> implemented; ACs AC-18…AC-23 green.
> Archived: [`docs/v3/03_requirements.md`](v3/03_requirements.md).

Clear, testable requirements for **ds-ide v4**, derived from [01_input-ideas.md](01_input-ideas.md)
and [02_assumptions-and-risks.md](02_assumptions-and-risks.md).

**Conventions** (unchanged from v1/v2/v3):
- IDs: `FR-*` functional · `NFR-*` non-functional · `CR-*` constraint. Stable; referenced by tests.
- "**shall**" = a v4 commitment.
- v4 IDs continue from v3: new requirement groups `FR-CM-*`, `FR-SC-*`; revised `FR-CE-1/4/5/7`;
  new `FR-WE-8/9`. ACs start at AC-24.

**v4 in one sentence:** refine the Controls Editor to a single-mode handle-based UX (replacing the
D18 two-mode design), polish the Wiring Editor SVG, and streamline the command surface.

---

## 1. Inherited decisions (carried forward, not re-litigated)

| Ref | Decision |
|-----|----------|
| D1 | Native host simulation (Option A). |
| D2 | VS Code extension. |
| D3 | Bare libDaisy/DaisySP C++. |
| D4 | macOS-first; cross-platform where practical. |
| D10 | Audio input: live host / WAV / sine (v2). |
| D11 | Host speaker monitoring (v2). |
| D12 | Virtual buttons / GPIO / Switch + LED outputs (v2). |
| D13 | Full stepping + variable inspection via lldb-dap (v2). |
| D14 | In-IDE arm-none-eabi build + DFU flash (v2). |

---

## 2. v3 decisions (new, all shipped)

| Ref | Decision |
|-----|----------|
| **D15** | **`ds-ide:controls` convention** — C++ effect source uses a comment-delimited block (`// ds-ide:controls:begin` … `// ds-ide:controls:end`) with per-line `// ds-ide: id=..., kind=..., pin=...` annotations. No ds-ide header required; compiles unchanged for hardware builds. |
| **D16** | **Wiring Editor generates declarations only (v3)** — generated C++ is `TypeName varname; // ds-ide: id=…`. Full init calls (`.InitSingle`, `.Init`) deferred to vX. |
| **D17** | **Wiring Editor is a separate VS Code panel** (C10); Controls Editor stays in C2. |
| ~~**D18**~~ | ~~**Controls Editor two-mode panel (Design / Run)**~~ — *superseded by D19 (v4).* Shipped in M17 but replaced before any downstream dependence outside C2. |

## 2b. v4 decisions (new)

| Ref | Decision |
|-----|----------|
| **D19** | **Controls Editor single-mode handle UX** — replaces D18. The Controls Editor is a single always-visible panel; no explicit mode toggle. Each control has a drag handle. Dragging the handle rearranges the layout and is available at all times (emulator running or stopped). Interacting with the control body (pot slider, button click, LED state) sends live data to the emulator and is available only while the emulator is running; the control body is grayed-out when the emulator is stopped. (A18) |

---

## 3. Functional requirements

### 3.1 Controls Editor (`FR-CE-1…FR-CE-7`)

> **Context (v3 shipped, v4 in progress):** The v3 Controls Editor unified the old split panel
> into a single C2 panel with explicit Design / Run modes (D18, shipped M17). v4 replaces D18
> with a single-mode handle-based UX (D19). FR-CE-2, FR-CE-3, FR-CE-6 are unchanged from v3.
> FR-CE-1, FR-CE-4, FR-CE-5 are revised for D19. FR-CE-7 is new.

- **FR-CE-1** *(revised for D19)* — The Controls Editor shall be a single C2 panel with **no
  explicit mode toggle**. Each control shall be rendered with a visible **drag handle**. The panel
  is always visible regardless of emulator state. Emulator running/stopped state shall be
  indicated in the panel header or status area.
- **FR-CE-2** *(unchanged)* — The Controls Editor shall infer available controls by parsing the
  C++ source for a `// ds-ide:controls:begin` … `// ds-ide:controls:end` block (D15). Each line
  within the block that carries a `// ds-ide: id=..., kind=..., pin=...` annotation constitutes a
  declared control.
- **FR-CE-3** *(unchanged)* — The Controls Editor shall read `controllers.yaml` for placement
  positions (`editor_pos`). Controls present in code but absent from yaml shall receive a default
  position. Controls absent from code but present in yaml shall show a "not in code" indicator.
- **FR-CE-4** *(revised for D19)* — Dragging a control via its **drag handle** shall rearrange
  the control on the canvas. This action shall be available at all times (emulator running or
  stopped). On save, updated positions shall be written back to `controllers.yaml`. No C++ source
  is modified.
- **FR-CE-5** *(revised for D19)* — Interacting with a **control body** (outside the drag
  handle) — slider movement for pots, click for buttons, read state for LEDs — shall send live
  data to the emulator via existing IPC channels (≤ 50 ms per NFR-3). This action shall be
  available **only while the emulator is running**; when stopped, control bodies shall appear
  grayed-out and interactions shall be disabled.
- **FR-CE-6** *(unchanged)* — If no `// ds-ide:controls` block is detected in the C++ source,
  the Controls Editor shall surface a diagnostic ("Code convention not detected — running in
  yaml-only mode") and fall back to reading `controllers.yaml` directly (current M10b behaviour).
- **FR-CE-7** *(v4, new)* — Pot controls in the Controls Editor shall be visually styled to
  resemble a hardware rotary knob. The overall look and feel shall be visually consistent with
  the Wiring Editor panel.
  > ⚠️ OPEN: pot interaction model (mouse wheel vs. vertical drag) not yet decided — resolve
  > before implementation of FR-CE-7.

### 3.2 Wiring Editor (`FR-WE-1…FR-WE-9`)

> **Context:** Separate VS Code panel (C10), opened by command. Design-time only — does not
> interact with the running emulator. Writes C++ declarations that C9 and the Controls Editor
> read. Does not modify `controllers.yaml`.

- **FR-WE-1** — ds-ide shall provide a **Wiring Editor** as a separate VS Code panel, opened
  by the command `ds-ide: Open Wiring Editor`. It shall not replace or block the C2 emulator panel.
- **FR-WE-2** — The Wiring Editor shall display a **schematic-style SVG pinout diagram** of the
  Daisy Seed, with all pins labeled (D0–D30, A0–A11, power/GND) and individually clickable.
  A PCB-illustration version is deferred to vX.
- **FR-WE-3** — Clicking an unassigned pin shall open a **device selection popup** listing Pot,
  Button, and LED. If the device type is likely incompatible with the pin (e.g. pot on a non-ADC
  pin), a visible warning shall be shown; the assignment shall not be blocked (v3). Static
  capability filtering is deferred to vX.
- **FR-WE-4** — Adding a device shall: (a) render a control icon visually linked to the pin in
  the SVG diagram; (b) write a C++ declaration to the `// ds-ide:controls` block in the project's
  effect source, creating the block if absent. **Verify:** AC-19.
- **FR-WE-5** — Generated declarations shall follow D15/D16:
  `TypeName varname; // ds-ide: id=<id>, kind=<pot|button|led>, pin=<n>`
  where TypeName is `AdcChannelConfig` (pot), `Switch` (button), or `Led` (led).
  The device selection popup shall propose a default `id` of `<kind><n>` (e.g. `pot1`,
  `pot2`, `button1`) where `<n>` is the next integer that does not collide with any `id`
  already present in the convention block. The developer may edit this field before
  confirming; the edited value shall be validated for uniqueness and rejected with an error
  if it already exists. `varname` is always identical to the confirmed `id`.
- **FR-WE-6** — The Wiring Editor shall **not** modify `controllers.yaml`.
- **FR-WE-7** — Clicking an already-assigned pin shall open a popup showing the assigned
  device type and `id`, with a **Remove** button. Confirming shall delete the corresponding
  annotation line from the `// ds-ide:controls` block (via VS Code WorkspaceEdit, undoable)
  and reset the pin to unassigned in the SVG diagram. **Verify:** AC-23.
- **FR-WE-8** *(v4, new)* — The Wiring Editor SVG shall render the ID label of each assigned
  control in a clearly legible position. The label shall not visually overlap the control icon
  or pin circle. Candidate layout: label right-aligned between the control icon and the Daisy
  Seed diagram, vertically centred on the pin row.
  **Verify:** AC-29.
- **FR-WE-9** *(v4, new)* — The Daisy Seed SVG diagram shall include a minimal visual indicator
  of board orientation: a micro USB port shape drawn at the correct end of the board. No other
  component illustrations required in v4.
  **Verify:** AC-30.

### 3.3 Bug fixes (`FR-VZ-4`, `FR-UI-1`) — shipped in v3

- **FR-VZ-4** — The spectrum / FFT view (FR-VZ-1, v2) shall display frequency-axis labels
  without visual overlap. All labels shall be legible at the default panel size. **Verify:** AC-20. *(Shipped: M16)*
- **FR-UI-1** — The Emulator Scope view panel shall have a visible border on all sides; scope
  content shall not appear visually clipped at panel edges. **Verify:** AC-21. *(Shipped: M16)*

### 3.4 v4 requirements (new)

> **IDs start at FR-CM, FR-SC, FR-WE-8+.** Controls Editor visual/UX already covered by
> FR-CE-1, FR-CE-4, FR-CE-5 (revised for D19 above) and FR-CE-7.

#### Commands (`FR-CM-1…FR-CM-2`)

- **FR-CM-1** — ds-ide shall provide a command `ds-ide: Build & Deploy to Emulator` that
  executes build-for-emulator and deploy-to-emulator sequentially as a single action. The
  command shall appear in the VS Code command palette and in the ds-ide command list. On build
  failure, deployment shall not proceed and an error shall be surfaced in the Output panel.
  **Verify:** AC-26.
- **FR-CM-2** — The Emulator Scope view header shall include **Stop Audio** and **Start Audio**
  toolbar buttons, in addition to (not replacing) the existing palette commands. The buttons
  shall reflect the current emulator state (Start disabled when running; Stop disabled when stopped).
  **Verify:** AC-27.

#### Scope UX (`FR-SC-1…FR-SC-2`)

- **FR-SC-1** — The session recording button labels shall be simplified: "() Record" → "()",
  "[] Stop" → "[]". The "> Replay file…" button label is unchanged. Icon glyphs carry the
  meaning; no additional tooltip change required.
  **Verify:** AC-28.
- **FR-SC-2** — The Scope view shall display the **xruns** counter in exactly one location.
  If the header and the Emulator section currently show two separate counters representing the
  same metric, one shall be removed. If they represent different metrics, the labels shall be
  disambiguated (e.g. "audio xruns" vs. "IPC xruns"). Requires investigation before implementation.
  > ⚠️ OPEN: whether header and Emulator section show the same or different xruns data must be
  > confirmed by reading the current C2 implementation before writing this AC.

#### Wiring Editor visual (`FR-WE-8…FR-WE-9`)

*(See §3.2 above — FR-WE-8 and FR-WE-9 are listed there for completeness alongside FR-WE-1…FR-WE-7.)*

---

## 4. Non-functional requirements

No new NFRs for v4. All v1/v2/v3 NFRs (NFR-1…NFR-12) remain in force. See
[`docs/v2/03_requirements.md`](v2/03_requirements.md) §4 for the full list.

---

## 5. Constraints

- **CR-6** (carried forward) — v1/v2/v3 emulator build and features shall remain available; v4 features are additive.
- **CR-7** (carried forward) — Any third-party library added in v4+ shall be MIT/permissive licensed.
- **CR-8** (carried forward) — The `// ds-ide:controls` block written by the Wiring Editor shall compile unmodified by `arm-none-eabi-g++` without any ds-ide header or include.

---

## 6. Out of scope for v4

### Deferred to vX (pre-public-release)

- **Wiring Editor — static pin-capability filtering** (all device types shown with warnings in v3; filtering deferred).
- **Wiring Editor — full init code generation** (declarations only in v3 per D16).
- **Wiring Editor — PCB illustration** (schematic SVG in v3 per FR-WE-2).
- **Wiring Editor — device details panel** (edit id/varname, configure device parameters such as pot range) — deferred to vX; id/varname is only editable at wiring time (first assign) in v3.
- **Wiring Editor — per-item Unwire button on device card** — deferred to vX; v3 removal is via the assigned-pin popup (FR-WE-7).
- **Auto-derived controllers (arbitrary code)** — parse arbitrary `AdcChannelConfig` / GPIO init calls (without the ds-ide:controls convention) to draft `controllers.yaml`.
- **Built-in board maps** for Daisy Pod, Patch, Petal, Field, Terrarium.
- **MIDI input/output shim**.
- **Cross-platform debug** (`gdb` parity for Windows/Linux).
- **Windows/Linux host audio** (WASAPI/ALSA/JACK).
- **ARM toolchain bundle**.

### Deferred to v4+ (from v3)

- **FR-VZ-3 — Parameter automation**: record pot-movement timelines and replay as automated sweeps.

### Deferred from v4 open questions

- Controls / Wiring Editor embedded as panes of the source editor.
- VS Code Run → Start Debugging / Start Without Debugging integration.
- Implementation template / "Create new effect" wizard.
- Controls convention init block (`// ds-ide:controls:init:begin/end`).
- Plugin extension points / declarative control definition.

---

## 7. Open items

- **FR-CE-7 pot interaction model** — mouse wheel vs. vertical drag not yet decided. Must be
  resolved before M20 implementation begins.
- **FR-SC-2 xruns investigation** — C2 implementation must be read to confirm whether the
  header and Emulator section show the same or different xruns data before writing AC.

---

## 8. Acceptance criteria

### v3 ACs (shipped M16–M18)

- ~~**AC-18**~~ — Controls Editor two-mode panel. *Retired: D18 is superseded by D19 (v4).
  AC-18 was green at M17 ship; replaced by AC-24 (v4).*
- **AC-19** — Wiring Editor (add device): open the Wiring Editor, click an unassigned pin, select
  "Pot" — verify: (a) pot icon appears linked to pin in SVG diagram; (b) the project C++ source
  contains a new line in the `// ds-ide:controls` block for that pot. *(FR-WE-1…FR-WE-5)*
- **AC-20** — Spectrum labels: open spectrum view with a running effect; verify no frequency-axis
  labels overlap at default panel size. *(FR-VZ-4)*
- **AC-21** — Scope panel border: open emulator scope view; verify visible border on all sides and
  no content clipping. *(FR-UI-1)*
- **AC-22** — Controls Editor fallback: open an effect project whose C++ source has **no**
  `// ds-ide:controls` block; open the Controls Editor and verify: (a) a diagnostic banner
  reading "Code convention not detected — running in yaml-only mode" is visible; (b) controls
  defined in `controllers.yaml` appear on the canvas. *(FR-CE-6)*
- **AC-23** — Wiring Editor (remove device): open the Wiring Editor with an effect source
  that has one assigned pin; click the assigned pin — verify a popup appears showing the
  device type and id. Click Remove — verify: (a) the pin is unassigned in the SVG; (b) the
  annotation line is absent from the C++ convention block. *(FR-WE-7)*

### v4 ACs (planned)

- **AC-24** — Controls Editor handle UX: given an effect source with one pot and one button
  declared, open the Controls Editor and verify: (a) both controls appear with a visible drag
  handle; (b) with emulator stopped, dragging the handle repositions the control; control body
  is grayed-out and non-interactive; (c) with emulator running, the control body is interactive —
  slider updates pot value, button click updates button state. *(FR-CE-1, FR-CE-4, FR-CE-5, D19)*
- **AC-25** — Controls Editor knob visual: open Controls Editor with a pot; verify it renders as
  a rotary knob visually resembling a hardware pot, consistent with the Wiring Editor look and
  feel. *(FR-CE-7)* *(Blocked until pot interaction model is decided)*
- **AC-26** — Build & Deploy command: invoke `ds-ide: Build & Deploy to Emulator`; verify build
  runs, then deploy runs, and the emulator starts. Invoke again with a syntax error in the
  source; verify deploy does not run and an error appears in the Output panel. *(FR-CM-1)*
- **AC-27** — Scope header buttons: with the emulator stopped, verify Start Audio button is
  enabled and Stop Audio is disabled in the Scope header. Start the emulator; verify the state
  reverses. *(FR-CM-2)*
- **AC-28** — Recording buttons: open the Scope view; verify session recording buttons read
  "()" and "[]" (not "() Record" and "[] Stop"). *(FR-SC-1)*
- **AC-29** — Wiring Editor ID labels: open the Wiring Editor with at least one assigned pin;
  verify the ID label is legible and does not overlap the control icon or pin circle. *(FR-WE-8)*
- **AC-30** — Wiring Editor USB port: open the Wiring Editor; verify a micro USB port shape
  is visible at the correct end of the Daisy Seed SVG diagram. *(FR-WE-9)*
