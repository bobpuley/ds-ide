# 04 — Architecture (v9)

> **v8 complete** — full v8 architecture in
> [`docs/v8/04_architecture.md`](v8/04_architecture.md).

## v9 Architecture Notes

### Overall system design — unchanged

The two-process architecture (VS Code extension ↔ native emulator process over a UNIX domain socket) is unchanged from v8. No new IPC message types, no new processes, no new build system changes are required for v9.

---

### LED shim message path (corrected)

**v8 path (incorrect):** `Led::Update()` / `DaisySeed::SetLed()` → `emit_led_change` → `lock_guard(send_mutex)` → `send_ipc()` → `::send()` [on RT thread]

**v9 path (correct):** `Led::Update()` / `DaisySeed::SetLed()` → `emit_led_change` → `ipc_queue.push()` [lock-free SPSC, same path as `ipc_send`] → drain thread → `send_ipc()` → `::send()` [off RT thread]

This is the same SPSC + drain-thread path that scope frames, spectrum bins, and event messages already use. No new infrastructure is needed.

---

### Session recorder write path (corrected)

**v8 path (incorrect):** `ca_process` (CoreAudio RT thread) → `process_one_block` → `SessionRecorder::writeBlock` → `flushPending` → `::write(fd_)` [blocking I/O on RT thread]

**v9 path (correct):** `ca_process` → enqueue audio block data into a non-blocking ring buffer or the existing `pending_` queue → dedicated recorder-drain thread (separate from IPC drain) → `::write(fd_)` [off RT thread]

The `pending_` queue infrastructure in `SessionRecorder` is already close to the right abstraction; the fix moves the flush trigger off the RT thread.

---

### SPSC slot sizing

`MAX_MSG` in `SpscIpcQueue` increases from 16 kB to ≥ 80 kB to accommodate the maximum scope message size (~76 kB with default `SCOPE_BLOCKS=33`, `SCOPE_STEP=4`, `rt_buffer_size=256`). This is a compile-time constant change with no protocol or IPC format impact.

---

### Webview JS extraction (M33 — planned)

`controls-view-provider.ts`, `scope-panel.ts`, and `wiring-panel.ts` each embed several hundred lines of untyped JavaScript in template-string HTML. In M33, this JavaScript is extracted to `src/webview/*.ts` entry points, compiled by the existing esbuild pipeline, and injected via `panel.webview.asWebviewUri(...)`. The extension host TypeScript and webview TypeScript are separate bundles (as esbuild already supports via `esbuild.js`). This does not change any IPC message format or VS Code API surface.

---

### No other architectural changes

The following v9 fixes are localized to their implementation files and require no architectural decisions:

- D28 pin mapping: one-line fix in `controls-writer.ts`; shared helper module extraction
- Extension host async I/O: API substitution (sync → async equivalents), no control-flow changes
- Deploy concurrency: return `deployLock` instead of `undefined`, no new state
- `contributes.configuration` and `@vscode/vsce`: `package.json` changes only
- Emulator robustness fixes (WAV size guard, fd double-close, socket path length): localized to `wav_reader.cpp` and `ipc_server.cpp`
