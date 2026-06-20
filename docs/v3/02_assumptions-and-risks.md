# 02 — Assumptions & Risks (v3)

> **v1 complete** — all v1 bets (A1–A8) held. Archived: [`docs/v1/02_assumptions-and-risks.md`](v1/02_assumptions-and-risks.md).
>
> **v2 complete** — all v2 bets (A9–A14) held; all risks (R12–R18) resolved or managed.
> Archived: [`docs/v2/02_assumptions-and-risks.md`](v2/02_assumptions-and-risks.md).

What ds-ide **v3 is betting on**, and where those bets could be wrong. Derived from the v3
feature set in [01_input-ideas.md](01_input-ideas.md).

Legend — **Impact if wrong**: 🔴 high · 🟠 medium · 🟡 low.

---

## 1. Carried-forward bets (still hold in v3)

The following v1/v2 bets remain valid and are not re-litigated:

| ID | Bet (summary) | Source |
|----|---------------|--------|
| A1 | Daisy effects are host-portable C++ | v1, confirmed |
| A2 | Host libDaisy shim has bounded surface | v1+v2, extended to Switch/GPIO |
| A3 | DaisySP runs natively unchanged | v1, confirmed |
| A4 | VS Code extension model is sufficient | v1+v2, confirmed |
| A6 | macOS-first with portable APIs | carried forward |
| A9 | Real-time host audio achievable in out-of-process runtime | v2, confirmed in M8 |
| A11 | Switch/GPIO shim feasible (mirrors ADC shim) | v2, confirmed in M10 |
| A12 | Full debug comes nearly for free from lldb-dap | v2, confirmed in M11 |
| A13 | arm-none-eabi-g++ and dfu-util run on macOS Apple Silicon | v2, confirmed in M12 |

---

## 2. v3 bets

| ID | We are betting that… | Why we believe it | Impact if wrong |
|----|----------------------|-------------------|-----------------|
| **A15** | **Effect code follows a parseable init convention**: the `// ds-ide:controls:begin` block can be located and parsed with a line-by-line regex — no full C++ AST needed. | The convention is a structured comment-delimited section; the annotation format (`// ds-ide: id=…`) is machine-readable by design. We control the format. | 🟡 If the block is present but malformed, the parser returns errors and falls back to yaml-only mode — degraded but not broken. |
| **A16** | **Writing a new declaration line into the controls block is safe**: C1 can insert one line before `// ds-ide:controls:end` without corrupting surrounding code. | The block is delimiter-bounded; we insert only between markers. The operation is reversible via VS Code undo. | 🟠 If the file has unusual encoding or the block markers are inside a `#if 0` / string literal, the insert may corrupt the file. Mitigation: validate markers are at column 0 before writing. |

---

## 3. v3 risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| **R19** | **Convention non-compliance** — effects without a `// ds-ide:controls` block cannot be parsed; the Controls Editor falls back to yaml-only mode and silently diverges from the source. | Medium (existing projects) | 🟠 | Surface clear diagnostic: "Code convention not detected — yaml-only mode." Provide docs on adopting the convention; Wiring Editor creates the block on first use. |
| **R20** | **Code generation style mismatch** — generated declaration type names (`AdcChannelConfig`, `Switch`, `Led`) may differ from what the developer already uses (e.g. they may use `AnalogControl`, a different wrapper). | Low–Med | 🟡 | Document the expected type names for each device kind. The generated line is editable; only the `// ds-ide:` annotation is load-bearing for the parser. |

---

## 4. Open items

*(none at v3 kick-off)*
