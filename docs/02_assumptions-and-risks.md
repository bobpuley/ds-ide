# 02 — Assumptions & Risks (v9)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v8 complete** — all v8 bets held; risks resolved or managed.
> Archived: [`docs/v8/02_assumptions-and-risks.md`](v8/02_assumptions-and-risks.md).

## v9 Bets & Risks

Derived from the 2026-06-28 code review findings. Items marked with `> ⚠️ ASSUMPTION:` flag assumptions that were held in prior versions but revealed as incorrect or risky by the review.

---

### False assumptions revealed by the review

> ⚠️ ASSUMPTION (now invalidated): ADC pin-to-index mapping is fully linear (pin − 15) for all documented ADC-capable pins.

**Revealed by:** HIGH finding in `controls-writer.ts` — D28 breaks the linear sequence (D28 → A11, not A13).  
**Correction:** A special case for D28 is required; the formula `pin - 15` is only correct for D15–D25.  
**Resolution:** FR-PIN-1 in M32.

---

> ⚠️ ASSUMPTION (now invalidated): All code paths invoked from the emulator shim (including `Led::Update`) are safe to call from the CoreAudio real-time thread.

**Revealed by:** HIGH finding — `emit_led_change` acquires `send_mutex` and calls `::send()`, both prohibited on an RT thread.  
**Correction:** Shim functions that emit IPC messages must route through the lock-free SPSC queue.  
**Resolution:** FR-RTS-3 in M31.

---

> ⚠️ ASSUMPTION (now invalidated): The `SessionRecorder::writeBlock` path is safe to call from the RT thread because modern SSDs on Apple Silicon are fast enough.

**Revealed by:** HIGH finding — `::write(fd_)` on the RT thread is prohibited regardless of storage speed; the OS can pause the RT thread for arbitrarily long.  
**Correction:** All file I/O must occur on a non-RT thread; the RT thread only enqueues data.  
**Resolution:** FR-RTS-1 in M31.

---

> ⚠️ ASSUMPTION (now invalidated): The SPSC slot size (16 kB) is sufficient for all IPC messages emitted from the RT thread.

**Revealed by:** HIGH finding — the default scope message is ~76 kB, exceeding `MAX_MSG` by 4.7×, triggering heap reallocation in `ipc_queue.push()` on the RT thread.  
**Correction:** `MAX_MSG` must be sized to the actual maximum message, not an arbitrary constant.  
**Resolution:** FR-RTS-2 in M31.

---

### Risks carried into v9

**Risk: RT-safety regression on future shim additions**  
Any new shim function (GPIO, DAC, I2C, etc.) that emits an IPC message could re-introduce the same `send_mutex`-on-RT-thread bug if the fixed LED pattern is not documented as the required template.  
**Mitigation:** Document the SPSC-queue-only pattern in `emulator/shim/README.md` or a code comment on `emit_led_change`; add a TSAN CI step that runs an audio callback workload.

**Risk: Scope message size grows with future parameters**  
`MAX_MSG` is set for the current scope configuration. Adding more channels or increasing `SCOPE_BLOCKS` without updating `MAX_MSG` reintroduces the RT heap reallocation.  
**Mitigation:** Replace the magic constant with a `static_assert` that computes the maximum message size from `SCOPE_BLOCKS`, `SCOPE_STEP`, `rt_buffer_size`, and channel count (FR-RTS-2 DoD).

**Risk: Extension host blocking regression as new features are added**  
Converting all sync I/O to async (M32/FR-EXT-1) requires callers to be `async`. New code that calls newly-async helpers from a sync context will silently drop the promise.  
**Mitigation:** Enable the `@typescript-eslint/no-floating-promises` rule in `tsconfig.json` or `.eslintrc` to catch unhandled promises at compile time.

**Risk: Webview JS extraction (M33) is the largest refactor in v9**  
Moving embedded JS to compiled `.ts` files changes the build pipeline and HTML injection pattern. If esbuild output paths differ between dev and production builds, webviews may load blank pages.  
**Mitigation:** Implement and test locally before merging; verify against the existing manual test checklist (controls drag, scope display, wiring pin assignment) in both dev and `npm run package` production builds.
