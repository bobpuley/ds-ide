# M93 — Extension Robustness Quick Fixes

**Version:** 0.25.2
**Status:** in progress
**Source:** 2026-11-21 Node.js/TypeScript code review — HIGH findings #6, #7, #8 (intake 2026-11-23)

## Goal

Close three small, contained gaps in the Extension Host's trust boundary and debug plumbing. After this milestone, a malformed or hostile IPC line cannot bypass the whitelist or abort the read loop, a crashed lldb-dap ends the debug session cleanly instead of throwing EPIPE, and a failed run-session launch is answered instead of hanging in "launching".

## Sprint Tasks

### [ ] fix: Resolve IPC narrowers from own keys only and isolate per-line failures (FR-IPC-8)

`parseIpcMessage` indexes a plain object with the untrusted `type`, so `"constructor"` returns the raw message as valid and `"__proto__"` throws inside the socket `data` handler, losing the rest of the chunk.

**Affected files:** `src/ipc/narrow.ts`, `src/emulator/ipc-client.ts`, `src/test/unit/ipc/narrow.test.ts`

**DoD:**
- `NARROWERS` is a `Map` (or a null-prototype frozen object); lookup never reaches `Object.prototype`
- `parseIpcMessage` returns `undefined` for `constructor`, `__proto__`, `toString`, `valueOf` and `hasOwnProperty` (unit tests)
- `IpcClient.onData` catches an exception from parse, narrow or emit for one line, counts it as malformed with the usual warning, and processes the next line of the same chunk (unit test with a throwing narrower)
- `npm test` green

---

### [ ] fix: Handle lldb-dap stream errors and child exit in the debug proxy (FR-DBG-1)

`FilteringLldbDapAdapter` has no `error` listener on the child's `stdin`/`stdout` and ignores `exit`, so a dead lldb-dap produces an uncaught EPIPE and a debug session that never ends.

**Affected files:** `src/debug/debug-adapter.ts`, `src/test/unit/debug/debug-adapter.test.ts`

**DoD:**
- `error` on `stdin` or `stdout` is logged to the debug output channel and does not throw (unit test with a fake child)
- On child `exit`, exactly one DAP `terminated` event is emitted, even if `exit` and `error` both fire
- After exit, `handleMessage` writes nothing; writes are also skipped when `stdin` is not writable
- `npm test` green

---

### [ ] fix: Answer a failed run-session launch and end the session (FR-DBG-2)

`handleMessage` fires `void this.launch(req)` and `launch` has no `try/catch`, so a rejection from `rebuildAndDeploy` or `attachDebugger` becomes an unhandled rejection and the launch request is never answered.

**Affected files:** `src/debug/run-session-adapter.ts`, `src/test/unit/debug/run-session-adapter.test.ts`

**DoD:**
- A rejection in `launch` sends a `launch` response with `success: false` and the error message, stops the emulator the adapter started, and sends `terminated`
- Unit test: a fake host whose `rebuildAndDeploy` rejects (and one whose `attachDebugger` rejects) produces the failed response and the `terminated` event, with no unhandled rejection
- `npm test` green
