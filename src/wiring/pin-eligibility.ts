// FR-UDM-1: pin suitability derived from a device's declared `pinRequires`
// plus the generated pin table — the one place that decides "can this device
// sit on this pin", so no view special-cases a device id for it. Pure and
// dependency-free (no `vscode`, no Node builtins): imported by both the host
// and the browser-bundled Wiring Editor webview.

import type { PinDef } from '../devices/pin-table.gen';
import { REGISTRY } from '../devices/registry';
import type { PinRequirement } from '../devices/registry';

function pinSatisfies(pinDef: PinDef, req: PinRequirement): boolean {
  switch (req) {
    case 'adc':   return pinDef.adc;
    case 'i2c':   return (pinDef.i2c?.length ?? 0) > 0;
    case 'uart':  return (pinDef.uart?.length ?? 0) > 0;
    case 'spi':   return (pinDef.spi?.length ?? 0) > 0;
    case 'sdmmc': return pinDef.sdmmc !== null;
  }
}

/**
 * True when `deviceId` (a pin-attached registry device) may be placed on
 * `pinDef`. Power/special pins, bus/connector-attached peripherals (placed
 * through their bus, not a pin) and unknown ids are never eligible.
 */
export function isPinEligible(pinDef: PinDef, deviceId: string): boolean {
  if (pinDef.pin === null) return false;
  const d = REGISTRY[deviceId];
  if (!d || (d.attachmentKind !== 'pin' && d.attachmentKind !== 'pins')) return false;
  return d.pinRequires === undefined || pinSatisfies(pinDef, d.pinRequires);
}
