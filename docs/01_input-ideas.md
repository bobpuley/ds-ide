# 01 — Input Ideas (v13)

> **v1 complete** — ds-ide 0.1.0–0.1.7 (M0–M7), all ACs green. Full v1 ideas archived in
> [`docs/v1/01_input-ideas.md`](v1/01_input-ideas.md).
>
> **v2 complete** — ds-ide 0.2.0–0.2.9 (M8–M15), all ACs green. Full v2 ideas archived in
> [`docs/v2/01_input-ideas.md`](v2/01_input-ideas.md).
>
> **v3 complete** — ds-ide 0.3.0–0.3.3 (M16–M18), all ACs green. Full v3 ideas archived in
> [`docs/v3/01_input-ideas.md`](v3/01_input-ideas.md).
>
> **v4 complete** — ds-ide 0.4.0–0.4.3 (M19–M22), all ACs green. Full v4 ideas archived in
> [`docs/v4/01_input-ideas.md`](v4/01_input-ideas.md).
>
> **v5 complete** — ds-ide 0.5.0–0.5.1 (M23–M24), all ACs green. Full v5 ideas archived in
> [`docs/v5/01_input-ideas.md`](v5/01_input-ideas.md).
>
> **v6 complete** — archived to `docs/v6/` on 2026-06-21. Full v6 ideas archived in
> [`docs/v6/01_input-ideas.md`](v6/01_input-ideas.md).
>
> **v7 complete** — archived to `docs/v7/` on 2026-06-21. Full v7 ideas archived in
> [`docs/v7/01_input-ideas.md`](v7/01_input-ideas.md).
>
> **v8 complete** — archived to `docs/v8/` on 2026-06-22. Full v8 ideas archived in
> [`docs/v8/01_input-ideas.md`](v8/01_input-ideas.md).
>
> **v9 complete** — archived to `docs/v9/` on 2026-06-29. Full v9 ideas archived in
> [`docs/v9/01_input-ideas.md`](v9/01_input-ideas.md).
>
> **v10 complete** — archived to `docs/v10/` on 2026-06-30. Full v10 ideas archived in
> [`docs/v10/01_input-ideas.md`](v10/01_input-ideas.md).
>
> **v11 complete** — archived to `docs/v11/` on 2026-07-04. Full v11 ideas archived in
> [`docs/v11/01_input-ideas.md`](v11/01_input-ideas.md).
>
> **v12 complete** — archived to `docs/v12/` on 2026-07-05. Full v12 ideas archived in
> [`docs/v12/01_input-ideas.md`](v12/01_input-ideas.md).

## v13 Planning — Bug Reports from Code Review (2026-07-02)

The three automated code reviews (`docs/06_emulator_review.md`, `docs/06_nodejs_review.md`, `docs/06_vscode_extension_review.md`) produced 46 distinct findings after merging duplicates independently flagged by both the Node.js/TS review and the VS Code extension review (the deploy-lock unhandled rejection, the stale-PID kill, and the unvalidated-IPC-forwarded-to-webview finding each appeared in two reports and are logged once below).

Grouping: spread across three versions by severity tier — **v11 = all HIGH findings**, **v12 = all MEDIUM findings**, **v13 = all LOW findings** — with milestones inside each version split by subsystem (emulator C/C++ vs. extension/IPC TypeScript). This mirrors the v9 bugfix intake, scaled to multiple versions per this intake's instruction to spread tasks across versions.

---

### v13 / M41 — Emulator Code Quality & Hygiene (emulator LOW)

- **Bug (LOW):** `lastLatencyMs()` reports `budget_ms * 2.0` under the field name `measuredMs` — a synthetic constant, not a real timestamp-based measurement.
  *Expected:* Sum `kAudioDevicePropertyLatency`, safety offset, and buffer frames for input+output at start time, or rename the field to `estimatedMs`.

- **Bug (LOW):** `CoreAudioDevice` owns `Impl*` as a raw pointer with copy/move left implicit — copying a started device yields two owners and a double `delete` in `stop()`/destructor.
  *Expected:* `std::unique_ptr<Impl>` with copy explicitly deleted.

- **Bug (LOW):** An effect can register both `StartAudio(InterleavingAudioCallback)` and `StartAudio(AudioCallback)`; the shim stores both pointers without clearing the other, and `use_block` is latched once for the process lifetime — a later interleaved registration is silently ignored.
  *Expected:* Each `StartAudio` overload nulls the other pointer; re-evaluate `use_block` per block; emit a warning event on repeated `StartAudio` calls.

- **Bug (LOW):** `System::Delay(ms)` sleeps 1 ms at a time in a loop; scheduler overshoot compounds per iteration, so `Delay(1000)` can take up to 2× the requested time under load — hardware `System::Delay` is tick-accurate.
  *Expected:* Compute an absolute deadline and `sleep_until(min(deadline, now + 1ms))` each pass.

- **Bug (LOW):** Pot values from the `pot`/`potSnapshot` IPC handlers are stored verbatim, including negatives, `>1`, `NaN`, and `Inf` (`std::stof` accepts `nan`/`inf`) — unlike the `outputVolume` handler, which clamps.
  *Expected:* Clamp to `[0, 1]` and reject non-finite values in both pot paths.

- **Bug (LOW):** `json_get`'s string-value scanner drops the backslash on any escape it doesn't special-case — `\n` becomes `n`, `\uXXXX` becomes `uXXXX`.
  *Expected:* Translate the standard escape set and decode or reject `\uXXXX` (subsumed by adopting a real JSON parser, per the M38 finding).

- **Bug (LOW):** `DaisySeed::PrintLine` forwards to `vprintf` with no `format(printf, 2, 3)` attribute (mismatched varargs are undetected UB) and appends `\n` where hardware emits `\r\n`.
  *Expected:* Add the format attribute; emit `\r\n` to match hardware fidelity.

- **Bug (LOW):** Both the effect object and the entire emulator runtime compile at `-O0 -g` unconditionally with only `-Wall`; `-Wextra`/`-Wshadow`/`-Wconversion` are absent.
  *Expected:* Keep `-O0 -g` for `effect_obj` only; build `RUNTIME_SRC`/`SHIM_SRC` at `-O2 -g`; add `-Wextra -Wshadow` to both targets.

---

### v13 / M42 — Extension/Tooling Polish

- **Bug (LOW):** `esbuild.js` uses one build config (`platform: 'node'`, `format: 'cjs'`) for both the extension host and the three webview scripts — currently harmless since webviews have zero imports, but the first `import` added to a webview script produces a broken or Node-flavored bundle.
  *Expected:* Split into an extension config (`platform: 'node'`) and a webview config (`platform: 'browser'`, `format: 'iife'`).

- **Bug (LOW):** `IpcClient.send()` silently no-ops when the socket is absent/destroyed; malformed JSON lines are silently discarded; a 1 MB receive-buffer overflow resets the buffer without resynchronizing to the next newline, so the next fragment also parses as garbage.
  *Expected:* Emit a counted warn-level event on dropped sends and malformed lines; on buffer overflow, skip to the next `\n` before resuming parsing.

- **Bug (LOW):** `runDfuUtil` detects success via output-string sniffing (`File downloaded successfully`, working around dfu-util's exit-74-after-success quirk) — locale/version-fragile.
  *Expected:* Constrain the workaround to the specific known exit code(s); keep the string check as a secondary signal only.

- **Bug (LOW):** The hand-rolled YAML parser silently skips tab-indented lines and never reads the scaffolded `controls: []` key (the parser only recognizes `controllers`/`buttons`/`leds`) — new projects start with a YAML key nothing reads.
  *Expected:* Emit a parse error on non-blank, non-comment lines matching no rule; fix the project scaffold to match the parser's actual section names.

- **Bug (LOW):** Grab-bag hygiene: `@types/node ^20` vs. an `esbuild` target of `node18`; toolchain detection shells out via `cp.exec('which ...')` instead of `execFile`; magic numbers (200 ms stale-kill wait, knob geometry constants duplicated between two functions); `hardware-build.ts` creates a fresh output channel when none is passed.
  *Expected:* Pin `@types/node` to `^18`; switch to `execFile`; hoist knob geometry into shared constants; make the channel parameter required.

- **Bug (LOW):** `package.json` still declares `"version": "0.0.1"` against a CHANGELOG documenting releases through 0.11.0; the referenced `images/icon.png` doesn't exist (also breaks packaging, see M37); activity-bar contributions reference only dark icon variants though light variants exist; keybindings have no `when`/`enablement` gates, so four shortcuts are live in every workspace; `"lint"` duplicates `"typecheck"` with no actual linter configured.
  *Expected:* Sync `version` to the latest changelog tag; add the icon asset; add `enablement`/`when` gates (e.g. a `ds-ide.isDaisyProject` context key); use or delete the light icon variants; wire up a real linter or rename the script.

- **Bug (LOW):** Sync fs calls (`mkdirSync`, `readdirSync`/`statSync`) run on the Extension Host during command paths; `ScopePanel.show()` reassigns `panel.webview.html` on every reveal, discarding scope/spectrum history despite `retainContextWhenHidden: true` paying its memory cost anyway.
  *Expected:* Swap sync fs calls for `fs.promises` equivalents; on reveal, `postMessage` current state instead of regenerating HTML; consider `getState()/setState()` for the scope webview.

- **Bug (LOW):** `ds-ide.effectSource` and `ds-ide.armToolchainPath` are declared as bare strings with empty defaults, no `scope`, and no `markdownDescription` — both default to `window` scope though they're machine/workspace-specific paths, so Settings Sync can silently apply a desktop toolchain path on a laptop.
  *Expected:* `"scope": "machine-overridable"` for `armToolchainPath`; `"scope": "resource"` (or documented `window`) for `effectSource`; document resolution order in `markdownDescription`.

- **Bug (LOW):** The `daisy-debug` debugger contribution has no `initialConfigurations`/`configurationSnippets` (manual selection dead-ends on a "pid required" error); the potentially minute-long CMake build inside `resolveDebugConfiguration` has no `withProgress` UI, so F5 appears hung on a cold configure; lldb-dap discovery covers only macOS paths.
  *Expected:* Mark `daisy-debug` internal or add a snippet; wrap build/deploy in `vscode.window.withProgress`; extend lldb-dap discovery with PATH probing for versioned Linux binary names.

---

*Full grouping rationale, requirements, and DoDs continue in `02_assumptions-and-risks.md`, `03_requirements.md`, and `05_dev-plan.md` → `docs/milestones/v11/`, `docs/milestones/v12/`, `docs/milestones/v13/`.*
