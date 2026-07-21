# 04 — Architecture (v14)

> **v13 complete** — full v13 architecture in
> [`docs/v13/04_architecture.md`](v13/04_architecture.md).

---

## v14 — Device registry architecture

Source: intake 2026-07-21.

### Layer split

Device definition is split by how declarative each part can actually be:

| Part | Declarative? | Where it lives |
|---|---|---|
| Technical specification (attachment, pin constraints, ADC vs digital, bus→pins) | yes | registry descriptor, data |
| Graphical representation (SVG + interaction primitive) | yes | registry descriptor, data |
| Behaviour (libDaisy semantics) | **no** | C++ shim class, compiled in |
| Codegen (declaration + `Init()` emission) | **no** | strategy object per device, compiled in |

Behaviour and codegen resist declaration: the pot's shared contiguous `AdcChannelConfig` array
with positional indices (FR-CODEGEN-1, `controls-writer.ts:58-71`) cannot be expressed by a
template, an encoder needs two pins with delta semantics, and an OLED attaches to a bus rather
than a pin. A format able to express all of it would be a programming language.

**Consequence: a compiled-in registry, not a plugin system.** Single source of truth, no
third-party loading, no runtime discovery.

### Interaction primitives

Rendering is data-driven against a fixed vocabulary, so a new device picks a primitive rather than
shipping bespoke webview code: `continuous` · `momentary` · `latching` · `multi-position` ·
`delta` · `indicator` · `raster`.

### Attachment model

```
attachment := { kind: 'pin',       pin: D }
            | { kind: 'pins',      pins: [D…] }
            | { kind: 'bus',       buses: { <BusName>: { signal: { D: 'SPI1_SCK', … } } } }
            | { kind: 'connector', id: 'microusb' }
```

A bus peripheral's pin footprint is **derived from its selected bus**, never stored as a constant —
switching an OLED from SPI1 (D7–D10) to I2C1 (D11–D12) re-maps it, and may collide with another
peripheral. Conflict checking is therefore a function over the resolved footprint of every enabled
device, recomputed on every change.

### Pin/signal data — generated, not hand-maintained

`daisy-seed-knowledge/doc/Daisy_Seed_Rev4_Pinout.csv` becomes the **single source of truth**. A
build step emits the TypeScript pin table (`row`, `side`, `pin`, `label`, `aLabel`, `adc`, plus
per-pin bus signal names) from the CSV's existing I2C/UART/SPI/SDMMC columns.

Rationale: the hand-maintained `PIN_DEFS` has drifted twice already (v7 pinout accuracy fix, v9
D28 ADC mapping correction), and v14 roughly triples the table by adding signal names — where a
wrong entry no longer just mislabels a pin, it silently corrupts conflict checking. The generated
file is build output and must not be edited by hand.

### IPC protocol

`pot` / `potSnapshot` / `button` / `buttonSnapshot` collapse into:

```
controlValue    { id: string, value: number }
controlSnapshot { values: { [id]: number } }
```

Device identity moves from the *message kind* to the `id` field, so adding a device adds no
message kinds. Framebuffer transport for the OLED (M46) is a separate message carrying an opaque
pixel payload, captured on the caller's thread at `Update()` and handed off through the existing
lock-free SPSC ring — never allocating or blocking on the real-time audio path.

Because this is a breaking wire change, connect-time exchanges a protocol version and mismatches
surface an explicit actionable error (FR-DEV-6). Bounded in practice by the emulator being built
from sources bundled in the `.vsix` (v11/M37).

### Wired controls vs bus peripherals

Two device categories with different UI treatment, one registry:

- **Wired controls** — pin-attached, user-named, faceplate presence, a runtime value the user
  manipulates. Rendered with an inline id label on the pin.
- **Bus peripherals** — bus- or connector-attached, *configured* rather than wired, no runtime
  value. Rendered as one collapsed bracket label; detail via tooltip and popover.

The labelling rule generalises: **inline text for what the user named, collapsed brackets for what
the system assigned.** The same rule governs board faceplates when BSP support lands.

### Board-bundle headroom

The registry must be able to express a board as a named bundle of device instances at fixed pins
plus a faceplate graphic (FR-DEV-5). Not implemented or exposed in v14 — but if M43's model cannot
express it, adding Pod/Patch/Petal later is a rewrite rather than an extension.

**Verified in M43.** `src/devices/board-bundle.ts` expresses a bundle as `{ id, label,
faceplateGraphic, instances: [{ id, kind, pin }] }` and resolves each instance into the same
`AttachedDevice` shape a user-wired control uses (`src/devices/attachment.ts`) — a board's internal
pin conflicts and a board-vs-user-wiring conflict both flow through the same `findConflicts()`
unchanged. No new abstraction was needed beyond composing the registry (device kinds) and the
attachment model (pin resolution/conflict checking) already built for FR-DEV-2/3/4. The module is
dormant: nothing else imports it, and it isn't exposed in any UI — it exists to be proven by its own
test (`board-bundle.test.ts`).

### Proposed structure

```
src/devices/
  registry.ts          device descriptors; the single source of truth
  attachment.ts        attachment kinds, bus→pins resolution, conflict computation
  pin-table.gen.ts     GENERATED from Daisy_Seed_Rev4_Pinout.csv — do not edit
  codegen/             one strategy per device (pot's array logic moves here intact)
  render/              SVG + interaction-primitive descriptors
scripts/
  gen-pin-table.ts     CSV → pin-table.gen.ts
emulator/shim/src/     one C++ class per device, registered at compile time
```
