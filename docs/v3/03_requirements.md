# 03 — Requirements (v3)

> **v1 complete** — all v1 requirements implemented; ACs AC-1…AC-8 green.
> Archived: [`docs/v1/03_requirements.md`](v1/03_requirements.md).
>
> **v2 complete** — all v2 requirements (FR-AU-5…FR-VE-4, NFR-11…12, CR-6…7) implemented;
> ACs AC-9…AC-17 green. Archived: [`docs/v2/03_requirements.md`](v2/03_requirements.md).

Clear, testable requirements for **ds-ide v3**, derived from [01_input-ideas.md](01_input-ideas.md)
and [02_assumptions-and-risks.md](02_assumptions-and-risks.md).

**Conventions** (unchanged from v1/v2):
- IDs: `FR-*` functional · `NFR-*` non-functional · `CR-*` constraint. Stable; referenced by tests.
- "**shall**" = a v3 commitment.
- v3 IDs start after v2: new requirement groups `FR-CE-*`, `FR-WE-*`; bug fixes `FR-VZ-4`, `FR-UI-1`; new ACs start at AC-18.

**v3 in one sentence:** extend ds-ide so the developer can visually wire physical hardware devices
to Daisy Seed pins (Wiring Editor), see those devices reflected automatically in a unified
design/run control panel (Controls Editor), and get the first round of post-v2 visual polish.

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

## 2. v3 decisions (new)

| Ref | Decision |
|-----|----------|
| **D15** | **`ds-ide:controls` convention** — C++ effect source uses a comment-delimited block (`// ds-ide:controls:begin` … `// ds-ide:controls:end`) with per-line `// ds-ide: id=..., kind=..., pin=...` annotations. No ds-ide header required; compiles unchanged for hardware builds. |
| **D16** | **Wiring Editor generates declarations only (v3)** — generated C++ is `TypeName varname; // ds-ide: id=…`. Full init calls (`.InitSingle`, `.Init`) deferred to vX. |
| **D17** | **Wiring Editor is a separate VS Code panel** (C10); Controls Editor stays in C2. |
| **D18** | **Controls Editor merges design and runtime panels** — replaces the current "Controller Editor" tab + "Effect controls" section with a single two-mode panel (Design / Run). |

---

## 3. Functional requirements

### 3.1 Controls Editor (`FR-CE-1…FR-CE-6`)

> **Context:** The v3 Controls Editor replaces the current split between the "Controller Editor"
> tab (design time) and the "Effect controls" section (runtime). Single C2 panel, two modes.
> Infers available controls from C++ source via the `ds-ide:controls` convention (D15).
> Uses `controllers.yaml` for placement only.

- **FR-CE-1** — The Controls Editor shall be a single C2 panel with two explicit modes:
  **Design** (arrange controls on canvas) and **Run** (live interaction while emulator runs).
  The active mode shall be indicated clearly in the panel header.
- **FR-CE-2** — The Controls Editor shall infer available controls by parsing the C++ source
  for a `// ds-ide:controls:begin` … `// ds-ide:controls:end` block (D15). Each line within
  the block that carries a `// ds-ide: id=..., kind=..., pin=...` annotation constitutes a
  declared control.
- **FR-CE-3** — The Controls Editor shall read `controllers.yaml` for placement positions
  (`editor_pos`). Controls present in code but absent from yaml shall receive a default
  position. Controls absent from code but present in yaml shall show a "not in code" indicator.
- **FR-CE-4** — In **Design mode**, the developer may drag controls to rearrange them. On save,
  updated positions shall be written back to `controllers.yaml`. No C++ source is modified.
- **FR-CE-5** — In **Run mode** (emulator running), the Controls Editor shall function as the
  live interactive control panel: pots render as sliders, buttons as clickable buttons, LEDs as
  lit/unlit indicators. Interaction uses the existing IPC channels (≤ 50 ms update per NFR-3).
- **FR-CE-6** — If no `// ds-ide:controls` block is detected in the C++ source, the Controls
  Editor shall surface a diagnostic ("Code convention not detected — running in yaml-only mode")
  and fall back to reading `controllers.yaml` directly (current M10b behaviour).

### 3.2 Wiring Editor (`FR-WE-1…FR-WE-6`)

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

### 3.3 Bug fixes (`FR-VZ-4`, `FR-UI-1`)

- **FR-VZ-4** — The spectrum / FFT view (FR-VZ-1, v2) shall display frequency-axis labels
  without visual overlap. All labels shall be legible at the default panel size. **Verify:** AC-20.
- **FR-UI-1** — The Emulator Scope view panel shall have a visible border on all sides; scope
  content shall not appear visually clipped at panel edges. **Verify:** AC-21.

---

## 4. Non-functional requirements

No new NFRs for v3. All v1/v2 NFRs (NFR-1…NFR-12) remain in force. See
[`docs/v2/03_requirements.md`](v2/03_requirements.md) §4 for the full list.

---

## 5. Constraints

- **CR-6** (carried forward) — v1/v2 emulator build and features shall remain available; v3 features are additive.
- **CR-7** (carried forward) — Any third-party library added in v3+ shall be MIT/permissive licensed.
- **CR-8** — The `// ds-ide:controls` block written by the Wiring Editor shall compile unmodified by `arm-none-eabi-g++` without any ds-ide header or include. (No ds-ide-specific macros or types in the generated code.)

---

## 6. Out of scope for v3

### Deferred to vX (pre-public-release)

- **Wiring Editor — static pin-capability filtering** (all device types shown with warnings in v3; filtering deferred).
- **Wiring Editor — full init code generation** (declarations only in v3 per D16).
- **Wiring Editor — PCB illustration** (schematic SVG in v3 per FR-WE-2).
- **Wiring Editor — device details panel** (edit id/varname, configure device parameters such as pot range) — deferred to vX; id/varname is only editable at wiring time (first assign) in v3.
- **Wiring Editor — per-item Unwire button on device card** — deferred to vX; v3 removal is via the assigned-pin popup (FR-WE-7).
- **Auto-derived controllers (arbitrary code)** — parse arbitrary `AdcChannelConfig` / GPIO init calls (without the ds-ide:controls convention) to draft `controllers.yaml`. *(v3 covers the convention-following case; vX covers arbitrary existing code.)*
- **Built-in board maps** for Daisy Pod, Patch, Petal, Field, Terrarium.
- **MIDI input/output shim**.
- **Cross-platform debug** (`gdb` parity for Windows/Linux).
- **Windows/Linux host audio** (WASAPI/ALSA/JACK).
- **ARM toolchain bundle**.

### Deferred to v3+ (from v2)

- **FR-VZ-3 — Parameter automation**: record pot-movement timelines and replay as automated sweeps.

---

## 7. Open items

*(none at v3 kick-off)*

---

## 8. Acceptance criteria (v3)

- **AC-18** — Controls Editor (convention): given an effect source with a `// ds-ide:controls:begin`
  block declaring one pot and one button, open the Controls Editor and verify: (a) both controls
  appear on the canvas in Design mode; (b) in Run mode with the emulator running, the slider
  updates pot value and button press updates button state. *(FR-CE-1…FR-CE-5)*
- **AC-19** — Wiring Editor (add device): open the Wiring Editor, click an unassigned pin, select
  "Pot" — verify: (a) pot icon appears linked to pin in SVG diagram; (b) the project C++ source
  contains a new line in the `// ds-ide:controls` block for that pot. *(FR-WE-1…FR-WE-5)*
- **AC-20** — Spectrum labels: open spectrum view with a running effect; verify no frequency-axis
  labels overlap at default panel size. *(FR-VZ-4)*
- **AC-21** — Scope panel border: open emulator scope view; verify visible border on all sides and
  no content clipping. *(FR-UI-1)*
- **AC-23** — Wiring Editor (remove device): open the Wiring Editor with an effect source
  that has one assigned pin; click the assigned pin — verify a popup appears showing the
  device type and id. Click Remove — verify: (a) the pin is unassigned in the SVG; (b) the
  annotation line is absent from the C++ convention block. *(FR-WE-7)*
- **AC-22** — Controls Editor fallback: open an effect project whose C++ source has **no**
  `// ds-ide:controls` block; open the Controls Editor and verify: (a) a diagnostic banner
  reading "Code convention not detected — running in yaml-only mode" is visible; (b) controls
  defined in `controllers.yaml` appear on the canvas. *(FR-CE-6)*
