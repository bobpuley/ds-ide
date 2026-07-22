# 02 — Assumptions & Risks (v14)

> **All prior versions complete** — full bet/risk history in their respective archives.
> **v13 complete** — all v13 bets held; risks resolved or managed.
> Archived: [`docs/v13/02_assumptions-and-risks.md`](v13/02_assumptions-and-risks.md).

---

## v14 — Device support expansion

### Bets

> ⚠️ **ASSUMPTION:** A device registry can absorb the full variety of device codegen. The known
> hard case is the pot's shared contiguous `AdcChannelConfig` array with positional indices
> (FR-CODEGEN-1, `controls-writer.ts:58-71`), which is not declaratively expressible. The bet is
> that a *strategy per device, compiled in* — rather than a declarative template — covers every
> device we plan to add. **Validated by M44**, which deliberately adds three devices that stress
> the model in different ways (multi-pin, multi-channel output, delta semantics) before OLED and
> MIDI depend on it.

> ✅ **CONFIRMED (M46, FR-DEV-14, 2026-07-22):** The SSD1306 framebuffer (128×64×1bpp = 1024
> bytes ≈ 1.4 KB base64-encoded) ships over the existing SPSC-ring mechanism without perturbing
> the real-time audio thread — with one adjustment to the original bet: it rides its **own**
> `SpscIpcQueue` instance (`EmulatorState::oled_queue`), not the audio engine's `ipc_queue`.
> `OledDisplay::Update()` is called from the effect's own `while(1)` loop (`effect_main()`'s
> thread), not the audio callback thread that already owns `ipc_queue` as its sole producer —
> sharing that instance would have silently turned it into a two-producer queue, violating its
> SPSC contract. `tests/oled-shim/test_oled.cpp`'s concurrent producer/consumer stress test
> (10,000 frames, no real-time pacing needed since the risk is queue capacity/corruption, not
> wall-clock rate) passed clean under both a plain build and ThreadSanitizer: every frame was
> either consumed or counted in `oled_queue_drops`, `oversize_drops` stayed zero, and TSan
> reported no races. The encoding step (base64 into a fixed 2 KB stack buffer, no heap allocation)
> is the only cost added to the caller's thread — negligible next to `System::Delay()`-paced
> real-world OLED update rates (the one corpus example redraws every 500 ms).

> ⚠️ **ASSUMPTION:** A FatFS shim mapping `f_open`/`f_read`/`f_write`/`f_lseek` onto host
> `stdio` covers the API surface that real sampler/looper projects actually use. Unverified
> against a corpus — if projects reach for `f_findfirst`, `f_mkfs` or raw disk I/O the shim grows.

> ⚠️ **ASSUMPTION:** Host MIDI bridging is viable on macOS via CoreMIDI, and a virtual on-screen
> keyboard is an acceptable fallback everywhere else. Consistent with the project's macOS-first
> test priority; Linux/Windows MIDI bridging is an accepted pragmatic gap for v14.

> ✅ **CONFIRMED (M44, FR-DEV-9, 2026-07-21):** Encoder delta semantics fit the generalised
> `controlValue {id, value}` message without a separate message kind. The webview accumulates
> drag detents into a wrapped position (`codegen/encoder.ts`'s `ENCODER_POSITION_MODULUS`),
> sends it as an ordinary `controlValue`, and the `Encoder` shim derives each callback's delta by
> diffing the just-read position against the value it read last time (`Debounce()`), including
> across the wraparound boundary. No wire-protocol change was needed.

> ⚠️ **ASSUMPTION (confirmed scope, 2026-07-22):** The M46 OLED shim implements pixel primitives
> only — `Fill()`, `DrawPixel()`, `Update()` and framebuffer capture — not real libDaisy's
> `WriteString()`/`SetCursor()` text API, which depends on font bitmap tables (`Font_6x8`,
> `Font_11x18`, etc.) this project has no vendored copy of and that porting would be its own
> substantial task. The only corpus example
> (`daisy-seed-knowledge/examples/OLED/OLED.cpp`) drives the display via `WriteString` — real
> effects using it will not compile against the M46 shim. Font/text support is deferred to a
> follow-up task, tracked in [`01_input-ideas.md`](01_input-ideas.md).

> ✅ **FIXED (M47, FR-DEV-16, 2026-07-22):** `emulator/shim/include/daisy_seed.h` — the one header
> a generated effect includes (`create-effect-project.ts`'s scaffold emits only `#include
> "daisy_seed.h"`) — never included `switch3.h`/`rgb_led.h`/`encoder.h`/`fatfs_host.h`/
> `oled_display.h`. Each shim's own isolated unit test (which includes its header directly) passed
> at its own milestone, masking that a real end-to-end generated project placing a toggle/RGB
> LED/encoder/SD card/OLED via the Wiring Editor would fail to compile with "unknown type name" at
> deploy time. Discovered while wiring `midi_uart_handler.h` into the same umbrella header for
> FR-DEV-16 and confirmed via a standalone probe compile; fixed for all five alongside MIDI TRS.

> ✅ **FIXED (M47, FR-DEV-18, 2026-07-22):** `midi` (RtMidi bindings, the host MIDI bridge's native
> addon) can't be inlined by esbuild the way every other dependency is — packaging originally used
> `vsce package --no-dependencies` on the assumption that zero runtime `dependencies` ever needed to
> ship as real files. Fixed: `package` script drops `--no-dependencies`, and `.vscodeignore` carves
> the seven files actually needed (`midi`'s JS glue + prebuilt `.node` binary, plus its `bindings`/
> `file-uri-to-path` dependency chain) back in from the blanket `node_modules/**` exclusion —
> verified end-to-end by `scripts/verify-vsix.sh`, which now packages the extension and `require()`s
> the module straight out of the unzipped layout. **Known limitation, not fixed here:** the packaged
> `.node` binary is prebuilt for whatever platform/arch ran `npm install` (macOS/Apple Silicon, this
> project's primary target) — installing the packaged extension on a different OS/arch would fail to
> load it. `host-bridge.ts` already wraps the `require()` in a try/catch and no-ops on failure (the
> same macOS-only gate covers most of this), so the failure mode is "bridge silently unavailable,"
> never a crash — but multi-arch prebuilt-binary distribution (or fetching one at install time) is
> unaddressed.

### Risks

- **The IPC generalisation is a breaking protocol change.** Replacing
  `pot`/`potSnapshot`/`button`/`buttonSnapshot` with `controlValue`/`controlSnapshot` means the
  extension and the emulator must ship in lockstep; a stale emulator binary against a new
  extension is a silent-failure mode. *Mitigation:* the emulator is built from sources bundled in
  the `.vsix` (v11/M37), so version skew is bounded — but a protocol version handshake should be
  part of M43's DoD rather than assumed.

- **A peripheral's pin footprint is a function of its bus config, not a constant.** Discovered
  during mockup evaluation: OLED on SPI1 occupies D7–D10, on I2C1 occupies D11–D12, and switching
  bus can collide with another peripheral. Any registry that models a peripheral as a static pin
  set is wrong. *Mitigation:* modelled as `bus → pins` from the outset in M43.

- **Conflict prevention in the UI does not make conflicts impossible.** `controllers.yaml` and the
  generated C++ stay hand-editable by design, so a conflicting state can always be loaded from
  disk. The Wiring Editor therefore needs a *loaded-state* conflict rendering that is a distinct
  code path from the rejection flow. Tracked as its own captured-not-scheduled feature in
  [`01_input-ideas.md`](01_input-ideas.md).

- **v14 is the largest feature cycle since v2** — five milestones spanning both the extension and
  the emulator shim. *Mitigation:* only M43–M44 are detailed at intake; M45–M47 are registry
  placeholders whose acceptance criteria are written once the registry has been proven.

- **Board BSP support is deferred but not designed out.** If the M43 registry cannot express "a
  board is a bundle of components at fixed pins plus a faceplate graphic", adding Pod/Patch/Petal
  later becomes a rewrite rather than an extension. *Mitigation:* explicit DoD item in M43.

- **`g_state.ipc_queue`'s single-producer guarantee depends on calling convention, not
  architecture.** Discovered while designing M46's OLED framebuffer hand-off: `led.cpp`/
  `rgb_led.cpp` already push straight into the one shared `ipc_queue` from `Update()`, which is
  safe only because real effects conventionally call it from inside the audio callback (the same
  thread `audio_engine.cpp`'s RT loop already treats as the sole producer) — nothing stops an
  effect from calling `Led::Update()`/`RgbLed::Update()` from `main()`'s loop instead, which would
  silently violate the SPSC invariant. OLED's own real-world usage (the one corpus example,
  `daisy-seed-knowledge/examples/OLED/OLED.cpp`) calls `Update()` from `main()`'s `while(1)` loop,
  paced by a blocking `System::Delay()` — genuinely a different thread, not just a hypothetical
  one — which is why M46 gives it its own dedicated `SpscIpcQueue` instance rather than reusing
  the audio engine's. *Not fixed here*: auditing/redesigning every existing shim's producer
  threading is a larger, separate undertaking outside FR-DEV-14's scope. Relevant to M47 too
  (MIDI callbacks may run on yet another thread).
