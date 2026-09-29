// Single source of truth for device types (FR-DEV-2). Every view that used
// to declare its own `pot | button | led` union — the annotation parser, the
// codegen writer, the Wiring Editor and the Controls Editor — enumerates
// this instead, so adding a device touches this module (plus its shim) and
// nothing else.
//
// Plain, dependency-free TS (no Node builtins, no `vscode` import) — safe to
// import from the extension host today, and from browser-bundled webview
// scripts once a later task needs it there too (same convention as
// src/webview/messages.ts's type-only exports).
//
// Scope note: this module generates *markup* (palette/popup buttons,
// per-device CSS) in wiring-panel.ts and controls-editor-panel.ts, and now
// (FR-DEV-4) drives controls-writer.ts's declaration/init codegen via
// declaredClassName/initArgs/codegen below. The browser-side interaction
// scripts (wiring-webview.ts, controls-webview.ts) still branch on
// device-kind literals internally — fully generalizing their *rendering*
// (knob/button/LED widgets) onto interaction primitives remains future work,
// once a shim-binding field is added here too.

import type { SharedCodegenStrategy, PeripheralCodegenStrategy } from './codegen/types';
import { potCodegen } from './codegen/pot';
import { sdcardCodegen } from './codegen/sdcard';
import { oledCodegen } from './codegen/oled';
import { midiTrsCodegen } from './codegen/midi-trs';
import { midiUsbCodegen } from './codegen/midi-usb';

// Fixed rendering vocabulary (FR-DEV-2) — a device picks one of these rather
// than shipping bespoke webview code.
export type InteractionPrimitive =
  | 'continuous'
  | 'momentary'
  | 'latching'
  | 'multi-position'
  | 'delta'
  | 'indicator'
  | 'raster';

export interface DeviceDescriptor {
  /** Registry key; also the annotation `kind=` value and the wire-facing name. */
  id: string;
  /** Display name shown in the Wiring/Controls Editor UI. */
  label: string;
  /**
   * Omitted by a bus/connector-attached peripheral (FR-DEV-10) — a primitive
   * only means something for a live control the Controls Editor renders;
   * a peripheral is configured from the Wiring Editor's Peripherals section
   * instead (FR-DEV-11) and never appears in the Controls Editor at all.
   */
  primitive?: InteractionPrimitive;
  /**
   * Identity colour per theme kind (FR-THM-3): `dark` for Dark+ / High Contrast
   * Dark, `light` for Light+ / High Contrast Light. Views never read these
   * literals — theme-css.ts turns them into `--ds-accent-<id>` variables and
   * views use `accentVar(id)`.
   */
  accent: { dark: string; light: string };
  /** CSS fill color for the wiring-editor pin dot. */
  pinFill: string;
  /**
   * controls-writer.ts's per-instance libDaisy class name (e.g. `Switch`,
   * `Led`) — null for pot, which shares one generated AdcChannelConfig array
   * instead of a named instance per control (FR-CODEGEN-1).
   */
  declaredClassName: string | null;
  /**
   * Which attachment.ts `Attachment` kind this device type uses (FR-DEV-3) —
   * a capability declared once per type; the resolved pin(s)/bus/connector
   * for a specific instance live on that instance, not here. All three
   * existing devices are single-pin; multi-pin, bus and connector devices
   * arrive in later milestones (M44-M47).
   */
  attachmentKind: 'pin' | 'pins' | 'bus' | 'connector';
  /**
   * Second argument to this device's per-instance `Init(daisy::seed::D<pin>,
   * <initArgs>)` call (FR-DEV-4) — null for a device with no per-instance
   * Init call (pot, whose init is entirely emitted by `codegen` below).
   */
  initArgs: string | null;
  /**
   * Present only for a device whose declaration/init codegen must be
   * regenerated in full from every current same-kind instance whenever any
   * of them changes (today: only pot — FR-CODEGEN-1). A device without this
   * is handled entirely by declaredClassName + initArgs.
   */
  codegen?: SharedCodegenStrategy;
  /**
   * Present only for a bus-attached peripheral with no per-instance id/pin
   * at all (today: only sdcard — FR-DEV-10). Distinct from `codegen` above:
   * that shape regenerates from an N-instance list (pot), this one emits at
   * most once, gated on "is this peripheral enabled" rather than a count.
   */
  peripheralCodegen?: PeripheralCodegenStrategy;
  /**
   * Present only for attachmentKind 'bus' (FR-DEV-10/11) — the bus name this
   * device type resolves its footprint against via attachment.ts's
   * resolveBusFootprint. A single, fixed bus for now (sdcard has exactly one
   * real SDMMC bus on Daisy Seed); a peripheral with more than one candidate
   * bus (OLED, MIDI TRS — M46/M47) extends this once it actually needs a
   * user-facing choice.
   */
  bus?: string;
  /**
   * Present only for a bus-attached peripheral with more than one candidate
   * bus (FR-DEV-14; today: only oled — SPI1 or I2C1). Distinct from `bus`
   * above: `bus` is a single fixed assignment, this is the full set a user
   * can choose among. The currently-selected bus is read back from source
   * text via the peripheral's `peripheralCodegen.busOfDeclLine` (see
   * peripheral-state.ts), defaulting to `busChoices[0]` before it's ever
   * been enabled.
   */
  busChoices?: string[];
  /**
   * Required for attachmentKind 'pins' (FR-DEV-8) — how many pins one
   * instance occupies (e.g. rgbled: 3, for r/g/b). Lets the Wiring Editor's
   * auto-adjacent-pin allocator (multi-pin-alloc.ts) stay generic rather than
   * hardcoding a device's pin count.
   */
  pinCount?: number;
  /**
   * True for a peripheral with a live webview panel to open (FR-DEV-15's
   * OLED viewer; FR-DEV-18 extends this to the MIDI panel) — the Peripherals
   * section's "View" button and the auto-open-on-deploy trigger both
   * enumerate this instead of a hardcoded id, once a second consumer existed
   * to make a shared flag worth it (wiring-webview.ts's own FR-DEV-15
   * comment named this exact moment as the trigger to generalize).
   */
  hasLiveView?: boolean;
  /**
   * FR-UDM-1: the pin capability a pin-attached device needs, checked
   * against the pin table by wiring/pin-eligibility.ts's isPinEligible —
   * undefined means any assignable pin. Bus devices keep expressing their
   * footprint through `bus` / `busChoices` instead. Today only pot sets it.
   */
  pinRequires?: PinRequirement;
  /**
   * FR-UDM-3: display names for a 'pins' device's pins, in Init() argument
   * order (the same order an instance's `pins` array is stored in) — e.g.
   * rgbled R/G/B, encoder A/B/SW. Length equals `pinCount`. Used to label a
   * placed device's pins (`R=D15 G=D16 B=D17`) rather than special-casing ids.
   */
  pinSlots?: string[];
}

export type PinRequirement = 'adc' | 'i2c' | 'uart' | 'spi' | 'sdmmc';

// The enumerable literal-type source of truth. REGISTRY itself stays a
// loosely-typed Record (rather than keyof typeof REGISTRY) so it remains a
// plain, freely-indexable runtime object — the architecture is a compiled-in
// registry, not a plugin system, but tests exercising "adding a registry
// entry" (FR-DEV-2's own acceptance bullet) need to do that by assignment.
export const DEVICE_TYPES = ['pot', 'button', 'led', 'toggle', 'rgbled', 'encoder', 'sdcard', 'oled', 'midiTrs', 'midiUsb'] as const;

export type DeviceType = typeof DEVICE_TYPES[number];

/** CSS reference to a device's per-theme accent variable (see theme-css.ts). */
export function accentVar(id: string): string {
  return `var(--ds-accent-${id})`;
}

// Invariant: every DEVICE_TYPES member has an entry here (enforced by
// registry.test.ts's "every DeviceType has a REGISTRY entry" check) — so
// `REGISTRY[kind]!` is safe for any `kind: DeviceType` across the codebase
// (FR-EXT-29); only a lookup keyed by an unvalidated *string* needs `?.`.
export const REGISTRY: Record<string, DeviceDescriptor> = {
  pot: {
    id: 'pot',
    label: 'Pot',
    primitive: 'continuous',
    accent: { dark: '#4ec9b0', light: '#007a66' },
    pinFill: '#1a4a4a',
    declaredClassName: null,
    attachmentKind: 'pin',
    initArgs: null,
    codegen: potCodegen,
    pinRequires: 'adc',
  },
  button: {
    id: 'button',
    label: 'Button',
    primitive: 'momentary',
    accent: { dark: '#569cd6', light: '#1f6fb5' },
    pinFill: '#1a2a4a',
    declaredClassName: 'Switch',
    attachmentKind: 'pin',
    initArgs: 'hardware.AudioCallbackRate()',
  },
  led: {
    id: 'led',
    label: 'LED',
    primitive: 'indicator',
    accent: { dark: '#f04a4a', light: '#d32f2f' },
    pinFill: '#4a1a1a',
    declaredClassName: 'Led',
    attachmentKind: 'pin',
    initArgs: 'false',
  },
  // FR-DEV-7: first exerciser of the 'multi-position' primitive and the
  // first pin-attached, non-shared-codegen device whose Init() takes no
  // second argument (initArgs: null) — see controls-writer.ts's initLine().
  toggle: {
    id: 'toggle',
    label: 'Toggle',
    primitive: 'multi-position',
    accent: { dark: '#c586c0', light: '#9c3f96' },
    pinFill: '#3a1a4a',
    declaredClassName: 'Switch3',
    attachmentKind: 'pin',
    initArgs: null,
  },
  // FR-DEV-8: first registry entry owning multiple pins under one instance —
  // Init() takes 3 pins directly (see controls-writer.ts's initLine()), so
  // initArgs is unused (null) rather than describing a shape it doesn't have.
  rgbled: {
    id: 'rgbled',
    label: 'RGB LED',
    primitive: 'indicator',
    accent: { dark: '#ce9178', light: '#a8552e' },
    pinFill: '#4a2a1a',
    declaredClassName: 'RgbLed',
    attachmentKind: 'pins',
    initArgs: null,
    pinCount: 3,
    pinSlots: ['R', 'G', 'B'],
  },
  // FR-DEV-9: A/B quadrature pins plus a click pin (reusing the button
  // pin-state array for click — see emulator/shim/src/encoder.cpp), all
  // auto-allocated together like rgbled. Value semantics differ from every
  // other device: `value` on the wire is an accumulated position, not a
  // level — the shim derives per-callback deltas (Increment()) by diffing
  // against the previous read, confirming the M43 assumption in
  // 02_assumptions-and-risks.md that this fits controlValue{id,value}
  // without a new message kind.
  encoder: {
    id: 'encoder',
    label: 'Encoder',
    primitive: 'delta',
    accent: { dark: '#dcdcaa', light: '#7d7a00' },
    pinFill: '#4a4a1a',
    declaredClassName: 'Encoder',
    attachmentKind: 'pins',
    initArgs: null,
    pinCount: 3,
    pinSlots: ['A', 'B', 'SW'],
  },
  // FR-DEV-10: the first bus-attached, non-instanced peripheral — enabled or
  // disabled from the Wiring Editor's Peripherals section (FR-DEV-11), never
  // placed by clicking a pin, so it carries no `primitive` and no
  // per-instance `declaredClassName`. Its footprint resolves from the
  // SDMMC1 bus via attachment.ts's resolveBusFootprint, not a static pin list.
  sdcard: {
    id: 'sdcard',
    label: 'SD Card',
    accent: { dark: '#f4c430', light: '#8a6d00' },
    pinFill: '#4a3a1a',
    declaredClassName: null,
    attachmentKind: 'bus',
    bus: 'SDMMC1',
    initArgs: null,
    peripheralCodegen: sdcardCodegen,
  },
  // FR-DEV-14: the first peripheral with more than one candidate bus — its
  // declared C++ type is itself bus-specific (real libDaisy's OledDisplay is
  // templated on a transport driver), unlike sdcard's bus-invariant
  // declaration. Pixel primitives only (Fill/DrawPixel/Update); no
  // WriteString/font support — confirmed scope, 02_assumptions-and-risks.md.
  oled: {
    id: 'oled',
    label: 'OLED',
    accent: { dark: '#4fc1ff', light: '#0072b1' },
    pinFill: '#1a3a4a',
    declaredClassName: null,
    attachmentKind: 'bus',
    busChoices: ['SPI1', 'I2C1'],
    initArgs: null,
    peripheralCodegen: oledCodegen,
    hasLiveView: true,
  },
  // FR-DEV-16: the first peripheral whose runtime data is an *inbound* event
  // stream (a played note) rather than outbound telemetry. Fixed to USART1
  // (D13-D14) — the canonical UART assignment the pin table already reserves
  // for MIDI TRS — no busChoices; v14 scopes "or an alternative UART" down to
  // the one UART the board actually wires this way
  // (02_assumptions-and-risks.md).
  midiTrs: {
    id: 'midiTrs',
    label: 'MIDI TRS',
    accent: { dark: '#c586c0', light: '#9c3f96' },
    pinFill: '#3a1a3a',
    declaredClassName: null,
    attachmentKind: 'bus',
    bus: 'USART1',
    initArgs: null,
    peripheralCodegen: midiTrsCodegen,
    hasLiveView: true,
  },
  // FR-DEV-17: the first peripheral whose declared C++ type is mode-invariant
  // (one real MidiUsbHandler class) while its *runtime configuration* picks
  // between two genuinely different footprints — INTERNAL (the micro USB
  // connector, modeled as a zero-pin pseudo-bus rather than a true
  // attachment.kind:'connector'; see 02_assumptions-and-risks.md/Milestone_M47
  // for the deliberate scope note) and USB_HS_D (D29/D30, a real bus).
  // busChoices values double as resolveBusFootprint inputs, reusing FR-DEV-14's
  // whole multi-bus machinery unchanged — see codegen/midi-usb.ts.
  midiUsb: {
    id: 'midiUsb',
    label: 'MIDI USB',
    accent: { dark: '#569cd6', light: '#1f6fb5' },
    pinFill: '#1a2a4a',
    declaredClassName: null,
    attachmentKind: 'bus',
    busChoices: ['INTERNAL', 'USB_HS_D'],
    initArgs: null,
    peripheralCodegen: midiUsbCodegen,
    hasLiveView: true,
  },
};

export function isDeviceType(value: string): value is DeviceType {
  return (DEVICE_TYPES as readonly string[]).includes(value);
}

// Enumerates the registry's *current* keys at runtime — as distinct from
// DEVICE_TYPES (the compile-time literal union for the devices this
// milestone ships). Every consumer that must reflect a runtime-added entry
// (annotation regex, generated CSS/markup — see FR-DEV-2's "adding a
// registry entry surfaces it everywhere" test) enumerates through this,
// not DEVICE_TYPES, since TS types are erased and can't be affected by a
// runtime mutation of REGISTRY.
export function registryIds(): string[] {
  return Object.keys(REGISTRY);
}

// Registry ids for pin-attached devices only (attachmentKind 'pin' | 'pins')
// — what the Wiring Editor's per-pin popup and the Controls Editor's palette
// enumerate (FR-DEV-10). A bus/connector-attached peripheral (e.g. sdcard) is
// configured from the Peripherals section instead (FR-DEV-11) and must never
// appear as something a user "clicks a pin" or "drags onto the canvas" to
// place.
export function wiredControlIds(): string[] {
  return registryIds().filter(id => {
    const kind = REGISTRY[id]!.attachmentKind;
    return kind === 'pin' || kind === 'pins';
  });
}
