# 06 — C/C++ Emulator Review (v23)

> **v22 review archived** — [`docs/v22/06_emulator_review.md`](v22/06_emulator_review.md).

*v23 review not yet generated. Run the appropriate `/doc-creator-driver:*-review` command to produce it.*

## Findings recorded outside a full review

### [HIGH] macOS Live input cannot start when input and output are different devices

**Found:** 2026-10-06, M80 sprint-gate human test (macOS, MacBook Pro Microphone in + EDIFIER R1700BT Bluetooth out).
Not an M80 regression — the pre-M80 backend (`c289bfb`) fails identically. **Deferred** by the user until the
Windows-support initiative (v25, M77–M84) is closed.

**Symptom:** selecting *Live input* in the Scope falls straight back to *Sine*; the emulator sends
`realtime_unavailable` (see the companion webview finding in `06_vscode_extension_review.md`).

**Cause** (`emulator/runtime/core_audio_device.cpp`, `CoreAudioDevice::start()`):
1. The "disable output side of input bus" call — `EnableIO`, `kAudioUnitScope_Output`, element 1 — is invalid on
   AUHAL and always returns `kAudioUnitErr_InvalidElement` (-10877), even on a fresh unit. Since M38 (`e8603fe`,
   2026-07-04, FR-EMU-3 "every setup OSStatus is now checked") that error aborts `start()` every time.
2. Behind it, `kAudioOutputUnitProperty_CurrentDevice` is set on element 1 to the default *input* device, which also
   fails. More fundamentally, one AUHAL unit drives exactly one device, so a separate microphone and separate
   speakers cannot be paired this way. Before M38 both errors were ignored, so Live input only worked when the
   default input and output were the same device (e.g. a USB/Bluetooth headset).

**Reproduction:** call `CoreAudioDevice::start(48000, 64, ...)` with the default input and output on different
devices → returns `false`; instrumenting the `stop(); return false;` paths shows the EnableIO call failing first.

**Fix direction (to be planned through intake):** two AUHAL units — an input unit on the default input device and
an output unit on the default output device — joined by a lock-free SPSC ring buffer with drift handling (the same
independent-clocks problem RtAudio solves on Windows), or a CoreAudio aggregate device. Remove the invalid
`EnableIO` call either way. Add a contract/regression test that `start()` does not fail on the AUHAL setup calls.
