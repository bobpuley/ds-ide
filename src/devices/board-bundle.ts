// Board-bundle headroom (FR-DEV-5) — verifies the registry and attachment
// model can express a board as a named bundle of device instances at fixed
// pins plus a faceplate graphic, so adding a real board (Pod/Patch/Petal)
// later is an extension rather than a rewrite.
//
// Not implemented or exposed in any UI in v14 — this module is dormant.
// Nothing else in the extension imports it; it exists to be proven by its
// own test (board-bundle.test.ts).
import { REGISTRY, DeviceType } from './registry';
import type { AttachedDevice } from './attachment';

export interface BoardBundleInstance {
  /** Instance id, unique within the bundle (not globally — see toAttachedDevices). */
  id: string;
  kind: DeviceType;
  /** Fixed pin — a board's instances are not user-repositionable. */
  pin: number;
}

export interface BoardBundle {
  id: string;
  label: string;
  /** Path/reference to the board's faceplate graphic asset. */
  faceplateGraphic: string;
  instances: BoardBundleInstance[];
}

// Resolves a board bundle's fixed-pin instances into the same AttachedDevice
// shape a user-wired control uses, so both flow through attachment.ts's
// existing findConflicts() unchanged — a board's internal pin conflicts and
// a board-vs-user-wiring conflict are both just conflicts.
export function toAttachedDevices(bundle: BoardBundle): AttachedDevice[] {
  return bundle.instances.map(instance => ({
    id: `${bundle.id}:${instance.id}`,
    owner: `${instance.id} (${REGISTRY[instance.kind]!.label})`,
    attachment: { kind: 'pin', pin: instance.pin },
  }));
}
