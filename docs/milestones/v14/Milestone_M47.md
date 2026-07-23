# M47 — MIDI: TRS & USB

**Version:** 0.14.4
**Status:** released
**Source:** intake 2026-07-21 — device support expansion

## Goal

Extend ds-ide's usefulness from audio effects to synthesis. MIDI-driven projects are currently
undevelopable without hardware, since nothing can send the emulator a note. After this milestone
the emulator implements both MIDI transports — TRS over UART and USB in its `INTERNAL` (micro USB
connector) and `EXTERNAL` (USB HS, D29–D30) modes — and the extension provides an on-screen
keyboard and message monitor, with a host CoreMIDI bridge on macOS so a real controller can drive
the emulated device.

M44 has proven the registry (three devices stressing it three different ways) and M45 has landed
the bus-peripheral UI (Peripherals section, collapsed brackets, conflict-with-remedy). The sprint
tasks below finalise FR-DEV-16 through FR-DEV-18 in
[`v14/03_requirements.md`](../../v14/03_requirements.md) against that foundation. Host MIDI bridging
is macOS-only for v14 by explicit decision, recorded in
[`v14/02_assumptions-and-risks.md`](../../v14/02_assumptions-and-risks.md); the on-screen keyboard is
the cross-platform fallback.

> ⚠️ ASSUMPTION: MIDI is the first *inbound* peripheral — every prior peripheral/control only ever
> sends data *out* of the emulator (a pot's `controlValue`, the OLED's framebuffer). A note played
> on the virtual keyboard or a physical controller via the host bridge must travel extension →
> emulator → effect. This direction doesn't fit `controlValue{id,value}` (FR-DEV-1's "no message
> kinds" promise is scoped to *wired controls* whose runtime shape is a scalar level; MIDI's is a
> discrete, ordered event stream) — matching the precedent architecture already set for the OLED
> framebuffer ("a separate message carrying an opaque payload... the one exception"). MIDI gets its
> own message kind for the same reason.

> ⚠️ ASSUMPTION: no corpus example exercises `MidiUartHandler` (only
> `daisy-seed-knowledge/examples/USB_MIDI/USB_MIDI.cpp` for USB). Its API is modelled on
> `MidiUsbHandler`'s confirmed shape (`Config`, `Init()`, `Listen()`, `HasEvents()`, `PopEvent()`,
> shared `MidiEvent`/message-type enum — graphify's corpus graph links `MidiHandler` and
> `UartHandler` as sharing data, consistent with real libDaisy's `MidiHandler<Transport>` template
> where only the transport, not the parsing, varies) rather than confirmed against a header in this
> project's corpus. Verify the exact `MidiUartHandler::Config` field names before a hardware build
> is attempted; doesn't affect emulator behavior (the shim defines its own type regardless of what's
> declared).

> ⚠️ ASSUMPTION: FR-DEV-16 says "USART1 (D13–D14) or an alternative UART." Scoped down to USART1
> only for v14 — it's the sole UART the pin table (`attachment.ts`'s `canonicalBusSignal` comment)
> already reserves for MIDI TRS, and no corpus evidence names a second UART actually used this way
> on Daisy Seed. A `busChoices`-style alternative-UART picker is deferred the same way M46 deferred
> its bus-switch selector UI — real capability (`resolveBusFootprint` works for any UART name) with
> no picker built until a real project needs one.

## Sprint Tasks

### [x] feat: add MIDI TRS shim (FR-DEV-16)

`MidiUartHandler` — the first bus-attached peripheral whose runtime data is an inbound event
stream rather than outbound telemetry. Fixed footprint (USART1 → D13–D14, per the canonical
assignment `attachment.ts` already carved out), enabled/disabled like `sdcard` (no per-instance id).
Introduces the shared MIDI plumbing both this task and FR-DEV-17 depend on: a byte-triplet wire
message (`midiEvent {status,data1,data2}`, extension → emulator — mirroring real hardware's
raw serial bytes rather than a pre-parsed struct, so both transports share one parser exactly as
real libDaisy's `MidiHandler<Transport>` does), a mutex-guarded bounded FIFO of parsed `MidiEvent`s
in `EmulatorState` (`midi_in_queue` — not RT-audio-path, so a mutex is fine here, matching
`recorder_mutex`/`player_mutex`'s existing non-RT convention, unlike the lock-free `SpscIpcQueue`
used for RT telemetry), and a dedicated outbound `midi_queue` (own `SpscIpcQueue` instance, same
"different producer thread" reasoning M46 gave `oled_queue`) carrying a `midiRx` message for every
parsed event — populated regardless of whether the effect has called `PopEvent()` yet, so the
monitor (FR-DEV-18) shows real-time traffic rather than only what's been drained.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/midi-trs.ts`,
`emulator/shim/include/daisy_seed.h`, `emulator/shim/include/daisy/midi_event.h`,
`emulator/shim/src/midi_event.cpp`, `emulator/shim/include/daisy/midi_uart_handler.h`,
`emulator/shim/src/midi_uart_handler.cpp`, `emulator/runtime/emulator_state.h`,
`emulator/runtime/ipc_server.cpp`, `emulator/runtime/audio_engine.cpp`, `emulator/CMakeLists.txt`

**DoD:**
- `midiTrs` registry entry declares `attachmentKind: 'bus'`, `bus: 'USART1'`, resolving its
  footprint via the existing `resolveBusFootprint` — no static pin list.
- `midi_event.h`/`.cpp` parses a 3-byte MIDI message into a `MidiEvent` (type — `NoteOn`, `NoteOff`,
  `ControlChange`, ... — plus channel and type-specific fields, `AsNoteOn()`-style accessors)
  shared by both this task's `MidiUartHandler` and FR-DEV-17's `MidiUsbHandler`.
- The `midiEvent` IPC handler in `ipc_server.cpp` parses the incoming byte triplet, pushes the
  result onto `EmulatorState::midi_in_queue` (bounded; a full queue drops the *new* event and
  increments a `midi_in_drops` counter, preserving already-queued ordering), and also formats a
  `midiRx` message (raw bytes + parsed fields) onto the dedicated `midi_queue` for the monitor.
- `MidiUartHandler::Init()`/`Listen()`/`HasEvents()`/`PopEvent()` match the corpus-confirmed
  `MidiUsbHandler` shape; `Listen()` is a no-op (parsing already happened at IPC-receipt time, not
  simulated byte-by-byte), `HasEvents()`/`PopEvent()` drain `midi_in_queue`.
- Generated code declares `MidiUartHandler` and emits its `Init()` exactly once when enabled,
  removed cleanly when disabled — mirrors `sdcard`'s at-most-once `PeripheralCodegenStrategy`.
- Unit tests (`tests/midi-shim/`) cover: byte-triplet → `MidiEvent` parsing for NoteOn/NoteOff/CC,
  `midi_in_queue` FIFO ordering and overflow-drops-newest behaviour, and a concurrent
  producer(IPC thread)/consumer(effect thread) stress test proving neither `midi_in_queue` nor the
  dedicated `midi_queue` blocks or corrupts under load (same shape as `test_oled.cpp`'s stress
  test). TS-side tests cover the codegen strategy and registry entry.

> Discovered and fixed in this task: `emulator/shim/include/daisy_seed.h` (the only header a
> generated effect includes, per `create-effect-project.ts`'s scaffold) never included
> `switch3.h`/`rgb_led.h`/`encoder.h`/`fatfs_host.h`/`oled_display.h` — each landed as an isolated,
> directly-included unit test target (`tests/*-shim/`) but was never reachable from a real
> end-to-end generated project, so a Wiring-Editor-placed toggle/RGB LED/encoder/SD card/OLED
> failed to compile with "unknown type name" at deploy time despite its own milestone's shim tests
> passing. Confirmed via a standalone probe compile before and after. Fixed for all five alongside
> `midi_uart_handler.h`, whose own `Init()`-emitting DoD bullet above would have been false under
> the same gap — folding in the pre-existing misses rather than leaving a known compile break in
> place for released devices. No behavior change to any shim itself, just wiring the umbrella
> header — recorded here since it isn't a new FR.

---

### [x] feat: add MIDI USB shim (FR-DEV-17)

`MidiUsbHandler` — a peripheral whose declared C++ type is mode-invariant (unlike OLED, real
libDaisy has exactly one `MidiUsbHandler` class; `INTERNAL` vs `EXTERNAL` is a `Config` field, not a
template parameter), so the mode selection lives in the **init** line rather than the decl line.
Modeled as `busChoices: ['INTERNAL', 'USB_HS_D']` — reusing FR-DEV-14's whole multi-variant machinery
(`currentBusOf`, `computePeripheralDisplayStates`, `insertPeripheralIntoSource`'s bus param,
`extension.ts`'s existing bus-conflict check) unchanged, by choosing `busChoices` values that are
*also* valid `resolveBusFootprint` inputs: `'USB_HS_D'` resolves D29–D30 for real (a genuine bus,
extended below), `'INTERNAL'` resolves to zero pins (no pin's canonical signal starts with
`INTERNAL_`) — which is pin-wise correct for the micro USB connector even though it isn't modeled
as a true `attachment.kind:'connector'`.

> ⚠️ ASSUMPTION (scope, deliberately simplified): `attachment.ts` already reserves
> `KNOWN_CONNECTORS = ['microusb']` for exactly this device, and a fully general
> `resolveAttachment(mode): Attachment` giving `INTERNAL` a real connector attachment (participating
> in `findConflicts`'s separate `connectorConflicts` bucket) was considered. Deferred: v14 has no
> second connector-attached peripheral to actually collide with `microusb`, so the extra mechanism
> has no observable behavior to justify it yet (Simplicity First). Revisit — give `INTERNAL` a real
> `{kind:'connector', id:'microusb'}` attachment — the day a second connector-attached device is
> proposed.

**Affected files:** `src/devices/registry.ts`, `src/devices/codegen/types.ts`,
`src/devices/codegen/midi-usb.ts`, `src/wiring/peripheral-config.ts`, `src/extension.ts`,
`scripts/gen-pin-table.ts`, `emulator/shim/include/daisy/midi_usb_handler.h`,
`emulator/shim/src/midi_usb_handler.cpp`, `emulator/CMakeLists.txt`

**DoD:**
- `gen-pin-table.ts`'s `canonicalBusSignal` derivation extends to recognise D29/D30's `USB_HS_D_-`/
  `USB_HS_D_+` schematic names under a `USB_HS_D` bus prefix (parallel to the existing SPI/I2C/UART/
  USART/SDMMC handling), regenerating `pin-table.gen.ts` — the pinout CSV stays the single source
  of truth per `04_architecture.md`, no hand-added pin constant.
- `PeripheralCodegenStrategy.initLines` gains an optional `bus?: string` parameter (mirroring
  `declLine(bus?)`'s existing shape); `insertPeripheralInitIntoSource` threads it through from the
  same `bus` value `insertPeripheralIntoSource` already receives at its `extension.ts` call site.
  Every existing implementation (`sdcard`, `oled`) ignores the new parameter — bus-invariant Init()
  calls, unaffected.
- `midiUsb` registry entry declares `busChoices: ['INTERNAL', 'USB_HS_D']`; `declLine()` always emits
  one mode-invariant `MidiUsbHandler` declaration, `initLines(mode)` emits the `Config` + `periph =
  MidiUsbTransport::Config::INTERNAL`/`EXTERNAL` + `Init()` lines for the selected mode, and
  `busOfDeclLine` reads the mode back from whichever `periph = ...` line is present in source (the
  same "source is the source of truth" convention, just scanning an init line instead of a decl
  line — `peripheral-state.ts`'s `currentBusOf` already scans every line, not only decl lines).
- Selecting `USB_HS_D` while another enabled peripheral occupies D29/D30 is refused with a remedy
  exactly like FR-DEV-13's existing flow — no new conflict-handling path, since `USB_HS_D` flows
  through the same `bus` string `extension.ts`'s conflict check already resolves via
  `resolveBusFootprint`.
- `MidiUsbHandler::Init(Config)`/`Listen()`/`HasEvents()`/`PopEvent()` match the corpus-confirmed
  `USB_MIDI.cpp` shape, sharing FR-DEV-16's `MidiEvent` parser and `midi_in_queue`/`midi_queue`
  plumbing — no separate queue per transport, since only one MIDI peripheral is realistically
  enabled at a time in a given effect and the virtual keyboard/host bridge (FR-DEV-18) is one
  logical input.
- Unit tests (`tests/midi-shim/`, extending FR-DEV-16's suite) cover: `initLines('INTERNAL')` vs
  `initLines('USB_HS_D')` content, the mode round-trip (`busOfDeclLine` reading each back), and pin
  conflict detection for `USB_HS_D` mode against another D29/D30 occupant. TS-side tests cover the
  registry entry and `computePeripheralDisplayStates`' resolved footprint for each mode (empty for
  `INTERNAL`, D29/D30 for `USB_HS_D`).

> Found in human-driven testing, fixed before merge: the Peripherals section's pins column rendered
> blank for `INTERNAL` mode — correct footprint-wise (zero pins), but indistinguishable from "not
> connected to anything." `wiring-webview.ts`'s `renderPeripherals` now falls back to the bus/mode
> label itself (`p.bus`) when `p.pins` is empty, so the row reads "MIDI USB · INTERNAL" instead of a
> blank cell.
>
> A second round of the same testing found the list-row fix wasn't the whole gap: the board/schematic
> SVG itself showed nothing near the micro USB connector either — every other peripheral's "connected"
> state is drawn on the board via its resolved pins (a bus bracket, FR-DEV-12), but `INTERNAL` mode
> resolves to zero pins, so there was nothing to draw a bracket around. Fixed: the board's existing
> (previously static, unlabelled) USB port graphic is now grouped under `id="usb-port-group"`
> (`wiring-panel.ts`) and highlighted with an `.active` class plus a hover tooltip naming the owning
> peripheral (`wiring-webview.ts`'s new `updateUsbPortIndicator`) whenever a peripheral is enabled with
> `bus === 'INTERNAL'` — the zero-pin equivalent of a bus peripheral's pin highlight.

---

### [x] feat: add MIDI I/O surface — virtual keyboard, message monitor, host bridge (FR-DEV-18)

The developer-facing half: a webview panel (`MidiPanel`, mirroring `OledPanel`'s lifecycle/
`webviewReady` handshake) combining an on-screen piano keyboard that sends note messages and a
message monitor that renders every `midiRx` event the shim confirms it parsed — the same
observability principle FR-DEV-15 established for OLED (watch what the effect actually receives,
not just what was sent). A physical controller reaches the same pipeline via a macOS-only CoreMIDI
bridge, per `02_assumptions-and-risks.md`'s recorded decision; elsewhere the on-screen keyboard is
the only input.

**Affected files:** `src/webview/midi-panel.ts`, `src/webview/midi-webview.ts`,
`src/webview/midi-monitor.ts`, `src/webview/messages.ts`, `src/extension.ts`,
`src/devices/registry.ts`, `src/webview/wiring-webview.ts`, `src/webview/controls-webview.ts`,
`src/emulator/manager.ts`, `src/midi/host-bridge.ts`, `esbuild.js`, `package.json`,
`.vscodeignore`, `scripts/verify-vsix.sh`

**DoD:**
- New `MidiHostMessage`/`MidiWebviewMessage` pair in `messages.ts`: webview → extension `noteOn`/
  `noteOff` (from clicking the on-screen keyboard; no controller UI to produce a `controlChange` in
  this milestone) and extension → webview `midiRx` (relaying the shim's parsed-event confirmation
  for the monitor).
- `manager.ts` gains `sendMidiEvent(status, data1, data2)`, calling
  `ipcClient.send({type:'midiEvent', status, data1, data2})` — the extension-side half of
  FR-DEV-16's wire message. `MidiPanel` translates a webview note action into that byte triplet via
  the pure `noteToBytes` helper (`midi-monitor.ts`) before calling it.
- The on-screen keyboard renders at least one octave, sends `NoteOn`(velocity>0)/`NoteOff` on
  press/release, and works with no MIDI peripheral required to be enabled to *view* the panel (only
  to have an effect actually observe the notes).
- The message monitor lists incoming events (channel, type, note/velocity or controller/value) as
  `midiRx` messages arrive, newest entry visible without scrolling, bounded history via the pure
  `pushMonitorEntry` reducer (older entries drop off) rather than growing unbounded.
- `src/midi/host-bridge.ts` enumerates host MIDI input ports (macOS only, gated via an injectable
  platform parameter defaulting to `process.platform`) and forwards every port's messages through
  `sendMidiEvent`; loading the native `midi` binding is wrapped in try/catch so a missing/broken
  addon for the current platform/arch degrades to inert (no-op, no crash) rather than failing
  activation.
- `registry.ts`'s `hasLiveView` flag replaces the `id === 'oled'` hardcoding in
  `wiring-webview.ts`'s "View" button and `extension.ts`'s viewPeripheral handler / auto-open
  trigger, now that `oled`, `midiTrs` and `midiUsb` are three consumers — generalizing exactly where
  FR-DEV-15's own comment predicted this moment would come.
- The Peripherals section's `midiTrs`/`midiUsb` entries gain a "view" action opening the panel
  (mirrors OLED's, FR-DEV-15), and the panel auto-opens on deploy when either is enabled.
- Unit tests cover: the webview → byte-triplet translation (`noteToBytes`), the monitor's
  bounded-history reducer (`pushMonitorEntry`) as a pure function, and `HostMidiBridge` (platform
  gating, native-load-failure inertness, per-port opening, message forwarding, `stop()`) via an
  injectable `MidiInputFactory` — no real MIDI hardware or native binding needed to test it.
- `tests/human-driven/showcase.js` does not exist yet in this repo, so no manual-check entry was
  added there — noted rather than silently skipped, per the workflow's own conditional.

> Discovered and fixed in this task: `midi` is a native addon esbuild can't inline, but
> `package.json`'s `package` script used `vsce package --no-dependencies` on the assumption of zero
> runtime dependencies, and `.vscodeignore` blanket-excluded all of `node_modules/**` — together
> these would have shipped a `.vsix` where the host bridge fails to load at runtime despite working
> in dev mode. Fixed: dropped `--no-dependencies`, carved the specific files `midi` needs (plus its
> `bindings`/`file-uri-to-path` dependency chain) back into `.vscodeignore`, and extended
> `scripts/verify-vsix.sh` to package the extension and actually `require()` the module from the
> unzipped layout — not just check the file is present. Recorded in full in
> `02_assumptions-and-risks.md`, including the known remaining limitation (the packaged binary is
> single-platform/arch; unaddressed here, degrades to inert rather than crashing elsewhere).
