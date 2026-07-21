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

> ⚠️ **ASSUMPTION:** The SSD1306 framebuffer (128×64×1bpp ≈ 1 KB/frame) can be shipped over the
> existing IPC transport at useful frame rates without perturbing the real-time audio thread.
> Rests on the framebuffer being captured on the *caller's* thread at `Update()` and handed off
> via the existing lock-free SPSC ring, never allocating or blocking on the RT path.

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
