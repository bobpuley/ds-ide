# M84 — Windows Verification & Merge Readiness

**Version:** 0.25.0-win.8
**Status:** planned
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m84-windows-verification` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

Many Windows behaviours cannot be settled from the repository and the work has not touched `main`. After this milestone the Windows verification matrix is executed and recorded on a real Windows machine, every open question in the plan is closed or deferred explicitly, and the final merge-readiness checklist for merging `feat/windows-support` into `main` is complete — the merge itself waits for explicit user approval.

## Sprint Tasks

### [ ] test: execute and record the Windows verification matrix (FR-WIN-VER-1)

**Affected files:** `docs/measurements/windows-verification.md`, `multiplatform_plan.md`

**DoD:**
- on a Windows machine: sample effect builds and runs; scope, FFT and controls work over TCP IPC; real-time audio and M80 measurements are repeated on the final build
- deferred from M80 (closed without a Windows run): re-run the WASAPI-shared output-only measurement after the FR-WIN-AUD-6 period fix — `reported` should read 512 and `latency ms` ≈ 12.0 / 13.3 / 16.0 for 64 / 128 / 256 (`docs/measurements/windows-audio.md`, "Not yet re-run"); ASIO stays unmeasured unless an SDK and device are available, in which case it is recorded as deferred with that reason
- F5 debugging works: PID attach, whether a spurious stop occurs on attach/detach, mute-on-breakpoint under the debugger, DWARF breakpoints and variables in effect code; `lldb-dap` runs standalone and `liblldb.dll` loads without a separate Python
- Build & Flash with `dfu-util`, the MIDI bridge, and a fresh-profile install with the managed toolchain download are exercised
- every item in `multiplatform_plan.md` §6 is closed with evidence or explicitly deferred with a reason

---

### [ ] chore: merge-readiness checklist for main (FR-WIN-VER-2)

`feat/windows-support` must reach `main` only when nothing is broken.

**Affected files:** `CHANGELOG.md`, `docs/05_dev-plan.md`, `multiplatform_plan.md`

**DoD:**
- all M77–M84 milestone branches are merged into `feat/windows-support` and tagged `0.25.0-win.1`…`-win.8`
- the full macOS suites are green on the final tip of `feat/windows-support`, rebased or merged with current `main`, with no test removed or weakened
- `CHANGELOG.md` is complete; the next real semver tag for `main` is proposed to the user
- the checklist is presented to the user, and the merge into `main`, the semver tag and the push are performed only after explicit approval
