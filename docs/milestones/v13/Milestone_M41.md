# M41 — Emulator Code Quality & Hygiene

**Version:** 0.14.0
**Status:** planned
**Source:** 2026-07-02 C/C++ emulator code review — LOW findings

## Goal

Clear the remaining low-severity emulator findings: a fabricated latency metric, a latent double-free risk, a callback-registration bug, scheduler drift, unclamped pot input, escape-sequence corruption, format-string safety, and weak build flags. None of these are urgent on their own, but each is cheap to fix now and left alone accumulates into the kind of "confusing but hard to reproduce" report class the review flagged elsewhere.

## Sprint Tasks

### [ ] fix: Report real or honestly-labeled audio latency (FR-QA-EMU-1)

`lastLatencyMs()` reports `budget_ms * 2.0` under the field name `measuredMs` — a synthetic constant, not a measurement.

**Affected files:** `emulator/runtime/core_audio_device.cpp`, `emulator/runtime/audio_engine.cpp`

**DoD:** either sum `kAudioDevicePropertyLatency` + safety offset + buffer frames for input/output at start time, or rename the IPC field to `estimatedMs`.

---

### [ ] fix: Replace `CoreAudioDevice`'s raw owning pointer with `unique_ptr` (FR-QA-EMU-2)

`Impl*` has no deleted copy/move; copying a started device would yield two owners and a double `delete`.

**Affected files:** `emulator/runtime/core_audio_device.h`, `emulator/runtime/core_audio_device.cpp`

**DoD:** `Impl*` replaced with `std::unique_ptr<Impl>`; copy constructor/assignment explicitly deleted.

---

### [ ] fix: Make `StartAudio` registration reflect the most recent call (FR-QA-EMU-3)

Both `StartAudio` overloads set their own pointer without clearing the other; `use_block` is latched once for the process lifetime.

**Affected files:** `emulator/shim/src/daisy_seed.cpp`, `emulator/runtime/audio_engine.cpp`

**DoD:** each overload nulls the other pointer; `use_block` is re-evaluated per block (callback pointers made `std::atomic`); a warning event fires if `StartAudio` is called more than once.

---

### [ ] fix: Eliminate cumulative scheduler drift in `System::Delay` (FR-QA-EMU-4)

`Delay(ms)` sleeps 1ms at a time in a loop; scheduler overshoot compounds per iteration.

**Affected files:** `emulator/shim/src/system.cpp`

**DoD:** an absolute deadline is computed up front; the loop sleeps to `min(deadline, now + 1ms)` each pass, checking shutdown every iteration.

---

### [ ] fix: Clamp and validate pot values from IPC (FR-QA-EMU-5)

The `pot`/`potSnapshot` handlers store any float, including negatives, `>1`, `NaN`, `Inf` — unlike `outputVolume`, which clamps.

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:** both pot paths clamp to `[0, 1]` and reject non-finite values, matching `outputVolume`'s existing behavior.

---

### [ ] fix: Decode standard JSON escape sequences in `json_get` (FR-QA-EMU-6)

The string-value scanner drops the backslash on any escape it doesn't special-case (`\n` → `n`, `\uXXXX` → `uXXXX`).

**Affected files:** `emulator/runtime/ipc_server.cpp`

**DoD:** the standard escape set (`\n \t \r \b \f \" \\ \/`) is translated correctly; `\uXXXX` is decoded or explicitly rejected.

---

### [ ] fix: Add format-string checking and hardware-faithful line endings to `PrintLine` (FR-QA-EMU-7)

No `format(printf, 2, 3)` attribute means mismatched varargs are undetected UB; output emits `\n` where hardware emits `\r\n`.

**Affected files:** `emulator/shim/src/daisy_seed.cpp`, `emulator/shim/include/daisy/daisy_seed_class.h`

**DoD:** the declaration gains the format attribute; output emits `\r\n`.

---

### [ ] fix: Build the runtime at `-O2` with stronger warnings (FR-QA-EMU-8)

Both the effect object and the entire runtime compile at `-O0 -g` with only `-Wall`.

**Affected files:** `emulator/CMakeLists.txt`

**DoD:** `effect_obj` keeps `-O0 -g`; `RUNTIME_SRC`/`SHIM_SRC` build at `-O2 -g`; `-Wextra -Wshadow` are added to both targets and any resulting warnings are fixed.
