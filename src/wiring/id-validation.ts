// Pure id allocation/validation for the Wiring Editor popup — no DOM access,
// so it can be unit-tested directly instead of only through a browser (FR-IPC-6).
import { WiredPin, DeviceType } from './wiring-panel';

export function defaultId(kind: DeviceType, wiredPins: WiredPin[]): string {
  const used = new Set(wiredPins.filter((wp) => wp.deviceType === kind).map((wp) => wp.id));
  for (let n = 1; ; n++) {
    const candidate = kind + n;
    if (!used.has(candidate)) return candidate;
  }
}

export function validateId(val: string, wiredPins: WiredPin[]): string | null {
  const trimmed = val.trim();
  if (!trimmed) return 'id cannot be empty';
  const existing = wiredPins.find((wp) => wp.id === trimmed);
  if (existing) return `id already used by pin ${existing.pinNumber}`;
  return null;
}
