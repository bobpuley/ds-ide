# 03 — Requirements (v13)

> **v12 complete** — all v12 requirements implemented; ACs green.
> Archived: [`docs/v12/03_requirements.md`](v12/03_requirements.md).

## v13 Requirements

All requirements below are derived from the 2026-07-02 code review findings. See `01_input-ideas.md` for the raw bug list and `02_assumptions-and-risks.md` for the assumptions each requirement corrects.

---

### Emulator Code Quality & Hygiene (v13 / M41)

**FR-QA-EMU-1 — Reported latency is either real or honestly labeled**
`lastLatencyMs()` either sums measured `kAudioDevicePropertyLatency` + safety offset + buffer frames for input/output, or the IPC field is renamed `estimatedMs` to stop implying a measurement.

**FR-QA-EMU-2 — `CoreAudioDevice` cannot be double-freed via accidental copy**
`Impl*` is replaced with `std::unique_ptr<Impl>`; copy constructor/assignment are explicitly deleted.

**FR-QA-EMU-3 — `StartAudio` registration reflects the most recent call**
Each `StartAudio` overload nulls the other callback pointer; `use_block` is re-evaluated per block (callback pointers made `std::atomic`); a warning event fires if `StartAudio` is called more than once.

**FR-QA-EMU-4 — `System::Delay` does not accumulate drift**
`Delay(ms)` computes an absolute deadline and sleeps to `min(deadline, now + 1ms)` per iteration instead of a fixed 1ms-per-iteration loop.

**FR-QA-EMU-5 — Pot values from IPC are physically plausible**
The `pot`/`potSnapshot` handlers clamp to `[0, 1]` and reject non-finite (`NaN`/`Inf`) values, matching the existing `outputVolume` handler's behavior.

**FR-QA-EMU-6 — `json_get` decodes standard JSON escapes**
The string-value scanner translates `\n \t \r \b \f \" \\ \/` and decodes or rejects `\uXXXX`, instead of dropping the backslash.

**FR-QA-EMU-7 — `PrintLine` is format-checked and hardware-faithful**
The declaration gains `__attribute__((format(printf, 2, 3)))`; output emits `\r\n` to match hardware.

**FR-QA-EMU-8 — Runtime code builds with optimization and stronger warnings**
`effect_obj` keeps `-O0 -g`; `RUNTIME_SRC`/`SHIM_SRC` build at `-O2 -g`; `-Wextra -Wshadow` are added to both targets and any resulting warnings are fixed.

---

### Extension/Tooling Polish (v13 / M42)

**FR-QA-EXT-1 — Webview and extension bundles use platform-appropriate esbuild configs**
`esbuild.js` is split into an extension config (`platform: 'node'`, `external: ['vscode']`) and a webview config (`platform: 'browser'`, `format: 'iife'`).

**FR-QA-EXT-2 — IPC client failures are observable**
`IpcClient.send()` emits a counted warn-level event when the socket is absent/destroyed; malformed JSON lines are logged, not silently discarded; a receive-buffer overflow resynchronizes to the next `\n` instead of resuming mid-fragment.

**FR-QA-EXT-3 — dfu-util success detection is version-robust**
The non-zero-exit-code success path accepts only the specific known code(s) for "download OK, device left DFU mode"; the output-string match remains a secondary signal only, with a comment pinning the dfu-util versions verified.

**FR-QA-EXT-4 — The YAML parser and project scaffold agree on section names**
Non-blank, non-comment lines matching no parser rule produce a parse error instead of silent skipping; `create-effect-project.ts`'s scaffolded file uses a key the parser actually reads (`controllers:`, not `controls:`).

**FR-QA-EXT-5 — Toolchain/type hygiene matches the actual runtime**
`@types/node` is pinned to `^18` (matching the `node18` esbuild target); `which`-shelling via `cp.exec` is replaced with `execFile`; duplicated knob geometry constants are hoisted to one shared location; `buildForHardware`'s output-channel parameter is required, not defaulted.

**FR-QA-EXT-6 — Marketplace metadata is internally consistent**
`package.json`'s `version` matches the latest CHANGELOG entry; the referenced icon asset exists; unused or missing icon theme variants are resolved (used or deleted); keybindings gain `when`/`enablement` gates scoped to Daisy projects.

**FR-QA-EXT-7 — Extension Host command paths avoid synchronous I/O**
`mkdirSync`, `readdirSync`, `statSync` in command paths are replaced with `fs.promises` equivalents; `ScopePanel.show()` posts current state on reveal instead of regenerating `webview.html` (which discards scope/spectrum history).

**FR-QA-EXT-8 — Machine/workspace-specific settings declare the correct scope**
`armToolchainPath` declares `"scope": "machine-overridable"`; `effectSource` declares `"scope": "resource"` (or documents its `window`-scope resolution order); both gain `markdownDescription`.

**FR-QA-EXT-9 — The debug contribution is discoverable and responsive**
`daisy-debug` is marked internal or gains a configuration snippet; the build+deploy step inside `resolveDebugConfiguration` reports progress via `vscode.window.withProgress`; lldb-dap discovery extends to versioned Linux binary names on PATH.
