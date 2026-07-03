# 02 — Assumptions & Risks (v11)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v10 complete** — all v10 bets held; risks resolved or managed.
> Archived: [`docs/v10/02_assumptions-and-risks.md`](v10/02_assumptions-and-risks.md).

## v11–v13 Bets & Risks

Derived from the 2026-07-02 code review findings (see `01_input-ideas.md`). Items marked `> ⚠️ ASSUMPTION:` flag assumptions held in prior versions but revealed as incorrect by this review.

---

### False assumptions revealed by the review

> ⚠️ ASSUMPTION (now invalidated): CoreAudio always delivers exactly `bufferSize` frames per render callback.

**Revealed by:** HIGH finding in `core_audio_device.cpp` — hardware minimum clamping can make `inNumberFrames` exceed the requested `bufferSize`; the code already comments on this elsewhere but `inputBufList` allocation didn't account for it.
**Correction:** All RT-callback buffers must be sized for the maximum possible frame count, not the requested one.
**Resolution:** M36 (v11), duplex render callback finding.

---

> ⚠️ ASSUMPTION (now invalidated): It's safe to resize RT-callback-visible buffers on the control thread shortly after `AudioOutputUnitStart()`, since the callback "probably hasn't started yet."

**Revealed by:** HIGH finding — `start()`/`start_output_only()` resize `in_interleaved`/`out_interleaved`/`silentInput`/`workOut` after starting the unit; the RT callback can already be running concurrently.
**Correction:** Query hardware frame size and size all callback buffers before `AudioOutputUnitStart()`; never mutate callback-visible containers while the unit is running.
**Resolution:** M36 (v11).

---

> ⚠️ ASSUMPTION (now invalidated, recurring from v9): Blocking file I/O and mutex acquisition are acceptable on the RT thread if the operation is "usually fast" (fast SSDs, small mutex hold times).

**Revealed by:** Two HIGH findings — simulated-mode replay runs `SessionPlayer::nextBlock()` (`::read()`/`::lseek()`) inside the CoreAudio callback, and `SessionRecorder::enqueueBlock()`'s synchronization with `start()`/`stop()` relies on a relaxed atomic load that doesn't order against the initializing writes.
**Correction:** All I/O must be off the RT thread via a lock-free SPSC ring (the pattern the project already uses for `SessionRecorder`'s write path and for scope/spectrum/event messages); atomics guarding RT-visible state must use acquire/release, not relaxed.
**Resolution:** M36 (v11) — replay ring buffer, recorder acquire/release fix.

---

> ⚠️ ASSUMPTION (now invalidated): A same-user local UNIX-socket IPC channel between two processes we control does not need input validation, since both ends are "our own code."

**Revealed by:** MEDIUM findings across both C++ and TS reviews — hand-rolled `json_get` substring key matching, unescaped output injection, and unvalidated IPC JSON spread wholesale into webview `postMessage` calls that reach an `innerHTML` sink.
**Correction:** Treat the IPC boundary as untrusted in both directions: a version-skewed emulator build mid-refactor, a malformed line, or an unexpected field shape must degrade gracefully, not corrupt state or crash the receiver.
**Resolution:** M38 (v12, emulator JSON), M39 (v12, IPC schema validation + webview field whitelisting).

---

> ⚠️ ASSUMPTION (now invalidated): A PID recorded in `emu.pid` remains valid, and `/tmp/daisy_emu_*.sock` files found at activation always belong to a dead or this-workspace's emulator.

**Revealed by:** HIGH finding — PID reuse after reboot lets `killStalePid` SIGKILL an unrelated process; indiscriminate socket sweep on activation deletes other concurrently running VS Code windows' live sockets.
**Correction:** Process identity must be verified before signaling; socket lifecycle must be scoped per-workspace, never swept globally.
**Resolution:** M37 (v11).

---

> ⚠️ ASSUMPTION (now invalidated): Code that compiles and runs correctly against the emulator shim is portable to real libDaisy, because the shim's job is to be API-compatible.

**Revealed by:** HIGH finding — the Wiring Editor's generated ADC init code only compiles against a shim-only variadic `Init(Args...)` overload added specifically to accommodate the generator's wrong call shape; real libDaisy's `AdcHandle::Init` takes an array pointer.
**Correction:** The shim must not grow API surface that doesn't exist on hardware just to make generated code compile — any such divergence defeats the emulator↔hardware parity guarantee. Generated code must match the documented libDaisy pattern; the shim mirrors hardware, never the other way around.
**Resolution:** M37 (v11) — regenerate correct code, remove the shim's variadic overload.

---

> ⚠️ ASSUMPTION (now invalidated): Because the extension works correctly when run from the extension-development host (F5 in this repo), it will also work when packaged and installed as a `.vsix`.

**Revealed by:** HIGH finding — `.vscodeignore` excludes `emulator/**` from the package, so the packaged extension's core "Build for Emulator" command has no CMake project to build; this was invisible because all testing to date has used the repo checkout directly.
**Correction:** Packaging must be smoke-tested against the actual `.vsix` contents, not assumed correct because dev-mode works.
**Resolution:** M37 (v11) — include `emulator/**`, add a packaging smoke test.

---

### Risks carried into v11–v13

**Risk: Severity-tiered version split leaves MEDIUM/LOW emulator bugs live through v11**
Grouping by severity (v11=HIGH, v12=MEDIUM, v13=LOW) means bugs like the replay stale-sample tail, the scope JSON size overrun, and the config-latching issue (all MEDIUM, M38) remain in the codebase while v11's HIGH fixes ship and users pick them up. None of the v11 fixes depend on the MEDIUM findings, so this is judged safe, but any new v11 work touching `audio_engine.cpp` should re-check against the M38 list before merging to avoid compounding interactions (e.g. the M36 replay-ring-buffer fix and the M38 stale-sample-tail fix both touch `SessionPlayer::nextBlock()` and should land in a coordinated order — M36 first, since it changes the read path structurally).
**Mitigation:** Sequence M38 immediately after M36 rather than deferring the whole of v12 behind unrelated v11 work; note the `nextBlock()` dependency explicitly in the M38 milestone file.

**Risk: RT-safety regression on future shim/engine additions**
Any new shim function or engine code path that touches the RT thread could reintroduce a blocking, allocating, or relaxed-atomic pattern if the fixes in M36 aren't documented as the required template (this is the same class of risk flagged in v9 for `emit_led_change`, now recurring for the replay and recorder paths).
**Mitigation:** Document the SPSC-queue-only / acquire-release pattern in `emulator/runtime/README.md` or inline on the fixed functions; keep TSAN/ASAN CI coverage exercising both recording and replay workloads.

**Risk: IPC schema validation (M39) is a cross-cutting refactor touching every webview message handler**
Extending `narrow.ts` and switching from `...msg` spreads to whitelisted fields touches `ipc-client.ts`, `scope-panel.ts`, `controls-editor-panel.ts`, and all three webview scripts simultaneously — the largest coordinated TS change in this batch, with real risk of missing a field a webview silently depended on.
**Mitigation:** Land M39's schema/narrowing change together with removing `@ts-nocheck` from the webviews (same milestone) so the compiler catches any field a webview still needs but the new whitelist omitted.

**Risk: Process/socket lifecycle hardening (M37) changes multi-window behavior**
Scoping sockets per-workspace and adding PID identity checks is a behavior change to code every deploy path depends on; a mistake here (e.g. overly strict identity matching that never matches, or a permissions issue on the new per-workspace directory) could break deploy entirely rather than just fixing the edge case.
**Mitigation:** Manually verify two concurrent VS Code windows against two different Daisy projects both deploy and reconnect successfully before merging M37; keep the SIGTERM-then-SIGKILL escalation so a failed identity match degrades to "didn't clean up an old process" rather than "can't deploy at all."
