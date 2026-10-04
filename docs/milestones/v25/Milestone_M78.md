# M78 — IPC Transport & Process Lifecycle

**Version:** 0.25.0-win.2
**Status:** planned
**Source:** intake session, 2026-10-04 (`multiplatform_plan.md`; 01_input-ideas.md). Branch `feat/m78-ipc-transport-lifecycle` is created from `feat/windows-support` and merged back into `feat/windows-support` at close (never `main`) — FR-WIN-GIT-1

## Goal

The extension and emulator talk over an `AF_UNIX` socket and manage the emulator's life with POSIX signals and `ps`, none of which work on Windows. After this milestone the IPC runs over a transport abstraction — Unix socket on macOS (unchanged) and token-protected TCP loopback on Windows — a graceful `shutdown` message works on every platform, and stale emulators are reclaimed without `ps`, so the full `effect_emu` links and runs on Windows (silently, without audio).

## Sprint Tasks

### [ ] feat: transport abstraction and TCP loopback server in the emulator (FR-WIN-IPC-1)

`ipc_server.cpp` is written directly against `<sys/socket.h>`/`<sys/un.h>`/`<unistd.h>` with `AF_UNIX`.

**Affected files:** `emulator/runtime/ipc_server.cpp`, `emulator/runtime/ipc_server.h`, `emulator/runtime/ipc_transport.h`, `emulator/runtime/ipc_transport_unix.cpp`, `emulator/runtime/ipc_transport_tcp.cpp`, `emulator/CMakeLists.txt`, `emulator/runtime/main.cpp`

**DoD:**
- message handling is separated from socket creation/accept/IO behind a small transport interface
- the Unix-socket transport keeps its exact current behaviour on macOS
- the TCP transport (Windows) binds `127.0.0.1` on an ephemeral port, sets `TCP_NODELAY`, uses Winsock (`WSAStartup`/`WSACleanup`, `closesocket`) and announces `DAISY_EMU_SOCKET:127.0.0.1:<port>`
- the full `effect_emu` links under clang/MinGW on Windows (silent audio stub)
- a transport unit test runs against both transports where the platform allows, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] feat: transport-aware IpcClient and EmulatorManager (FR-WIN-IPC-1)

`IpcClient.connect()` and `EmulatorManager` assume the announced value is a filesystem path (and size sockets paths for the ~103-byte `AF_UNIX` limit).

**Affected files:** `src/emulator/ipc-client.ts`, `src/emulator/manager.ts`, `src/extension.ts`, `src/test/unit/emulator/ipc-client.test.ts`, `src/test/unit/emulator/manager.test.ts`

**DoD:**
- the announce value is parsed into a transport descriptor (path or `host:port`); `IpcClient.connect()` supports both
- the `.sock` cleanup and runtime-dir logic stay macOS-only
- handshake and `PROTOCOL_VERSION` checks behave as before on both transports
- unit tests cover both descriptors, malformed announces and connect timeouts, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] feat: per-session token on the TCP transport (FR-WIN-IPC-2)

Any local process could connect to a loopback TCP port; the Unix socket is protected by filesystem permissions.

**Affected files:** `emulator/runtime/ipc_transport_tcp.cpp`, `emulator/runtime/main.cpp`, `src/emulator/manager.ts`, `src/emulator/ipc-client.ts`

**DoD:**
- the extension generates a random per-session token and passes it to the emulator at spawn, avoiding exposure on a world-visible command line where the platform allows
- the emulator closes any TCP connection that does not present the token first
- a unit/integration test shows a wrong or missing token is rejected and the right one accepted
- the Unix transport is unaffected

---

### [ ] feat: graceful IPC shutdown message (FR-WIN-IPC-3)

On Windows `process.kill(pid, 'SIGTERM')` is `TerminateProcess`: signal handlers never run, so the recorder/session flush (FR-EMU-8) is skipped.

**Affected files:** `emulator/runtime/ipc_server.cpp`, `emulator/runtime/main.cpp`, `src/emulator/manager.ts`, `src/emulator/ipc-client.ts`, `src/ipc/narrow.ts`

**DoD:**
- a host-to-emulator `shutdown` message makes the emulator stop the audio engine, flush the session recorder and exit 0
- the extension sends `shutdown` first on all platforms and falls back to terminating the process after a grace period
- POSIX SIGTERM/SIGINT handling still works
- `PROTOCOL_VERSION`/capability handling for the new message and announce format is defined, and an old emulator with a new extension fails with the existing clear error
- tests cover graceful exit, fallback kill after timeout, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)

---

### [ ] fix: cross-platform stale-process check (FR-WIN-IPC-4)

`isEffectEmuProcess()` shells out to `ps -p <pid> -o comm=`, which does not exist on Windows, and compares against `effect_emu` without `.exe`; a stale emulator would never be reclaimed.

**Affected files:** `src/emulator/manager.ts`, `src/test/unit/emulator/manager.test.ts`

**DoD:**
- identity of the PID in `emu.pid` is checked by a mechanism that works on macOS and Windows (including `effect_emu.exe`)
- an unrelated process that reused the PID is never killed
- unit tests cover reclaim, PID reuse by another process, and a missing/garbled pid file on both platforms, and the existing macOS suites (TypeScript unit tests, emulator C++ test runners, `tests/build-flags`, runtime/functional tests) pass unchanged (FR-WIN-GIT-2)
