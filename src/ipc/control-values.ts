// Wire-level id scheme for controlValue/controlSnapshot (FR-DEV-1). Device
// identity now lives in this id field instead of the message kind (formerly
// pot/potSnapshot/button/buttonSnapshot). The pot<N>/btn<N> scheme here is a
// stand-in for the full device registry landing later in this milestone —
// the wire shape won't need to change again when that lands, only what
// populates these ids.

// FR-DEV-7: 'tgl' added for the toggle switch (Switch3) — same gpio-pin
// range as 'btn', since both are single-pin digital devices; the id scheme
// distinguishes the *kind*, not the range.
// FR-DEV-9: 'enc' added for the encoder's accumulated position, keyed by its
// primary (A-channel) pin — same gpio-pin range again.
const CONTROL_ID_MAX: Record<string, number> = { pot: 12, btn: 64, tgl: 64, enc: 64 };

export function potControlId(channel: number): string {
  return `pot${channel}`;
}

export function buttonControlId(gpioPin: number): string {
  return `btn${gpioPin}`;
}

export function toggleControlId(gpioPin: number): string {
  return `tgl${gpioPin}`;
}

export function encoderControlId(gpioPin: number): string {
  return `enc${gpioPin}`;
}

export function isValidControlId(id: string): boolean {
  const match = /^([a-z]+)(\d+)$/.exec(id);
  if (!match) return false;
  const prefix = match[1] as string;
  const digits = match[2] as string;
  const max = CONTROL_ID_MAX[prefix];
  if (max === undefined) return false;
  const n = Number(digits);
  return n >= 0 && n < max;
}

// Validates a single controlValue payload before it is ever sent, rejecting
// an unrecognized/out-of-range id or a non-finite value — the outbound
// counterpart to narrow.ts's v12/M39 inbound whitelist-rebuild discipline,
// applied here since controlValue/controlSnapshot flow extension → emulator.
export function narrowControlValue(id: string, value: number): { id: string; value: number } | undefined {
  if (!isValidControlId(id)) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return { id, value };
}

// Validates every entry of a controlSnapshot's values map. Rejects the whole
// snapshot if any single entry is invalid — a malformed snapshot means a bug
// in the caller (these are built from our own stores), not a formatting
// nuance worth silently tolerating.
export function narrowControlSnapshot(values: Record<string, number>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(values)) {
    const entry = narrowControlValue(id, value);
    if (!entry) return undefined;
    out[entry.id] = entry.value;
  }
  return out;
}
