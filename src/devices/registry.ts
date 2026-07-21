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

import type { SharedCodegenStrategy } from './codegen/types';
import { potCodegen } from './codegen/pot';

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
  primitive: InteractionPrimitive;
  /** CSS color: wiring-editor pin stroke and controls-editor palette border. */
  accentColor: string;
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
   * Required for attachmentKind 'pins' (FR-DEV-8) — how many pins one
   * instance occupies (e.g. rgbled: 3, for r/g/b). Lets the Wiring Editor's
   * auto-adjacent-pin allocator (multi-pin-alloc.ts) stay generic rather than
   * hardcoding a device's pin count.
   */
  pinCount?: number;
}

// The enumerable literal-type source of truth. REGISTRY itself stays a
// loosely-typed Record (rather than keyof typeof REGISTRY) so it remains a
// plain, freely-indexable runtime object — the architecture is a compiled-in
// registry, not a plugin system, but tests exercising "adding a registry
// entry" (FR-DEV-2's own acceptance bullet) need to do that by assignment.
export const DEVICE_TYPES = ['pot', 'button', 'led', 'toggle', 'rgbled'] as const;

export type DeviceType = typeof DEVICE_TYPES[number];

export const REGISTRY: Record<string, DeviceDescriptor> = {
  pot: {
    id: 'pot',
    label: 'Pot',
    primitive: 'continuous',
    accentColor: '#4ec9b0',
    pinFill: '#1a4a4a',
    declaredClassName: null,
    attachmentKind: 'pin',
    initArgs: null,
    codegen: potCodegen,
  },
  button: {
    id: 'button',
    label: 'Button',
    primitive: 'momentary',
    accentColor: '#569cd6',
    pinFill: '#1a2a4a',
    declaredClassName: 'Switch',
    attachmentKind: 'pin',
    initArgs: 'hardware.AudioCallbackRate()',
  },
  led: {
    id: 'led',
    label: 'LED',
    primitive: 'indicator',
    accentColor: '#f04a4a',
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
    accentColor: '#c586c0',
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
    accentColor: '#ce9178',
    pinFill: '#4a2a1a',
    declaredClassName: 'RgbLed',
    attachmentKind: 'pins',
    initArgs: null,
    pinCount: 3,
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
