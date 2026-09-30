export function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

export function getBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function getNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
}

function getNumberArray(obj: Record<string, unknown>, key: string): number[] | undefined {
  const v = obj[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : undefined;
}

export type IpcMessage = Record<string, unknown>;

// FR-SCI-14c: host -> emulator capture request.
export type ScopeCaptureRequest =
  | { action: 'arm'; source: 'in' | 'l'; edge: 'rise' | 'fall'; level: number }
  | { action: 'cancel' };

// Validates an untrusted webview request; undefined when malformed.
export function narrowScopeCaptureRequest(raw: Record<string, unknown>): ScopeCaptureRequest | undefined {
  const action = getString(raw, 'action');
  if (action === 'cancel') return { action };
  if (action !== 'arm') return undefined;
  const source = getString(raw, 'source');
  const edge = getString(raw, 'edge');
  const level = getNumber(raw, 'level');
  if ((source !== 'in' && source !== 'l') || (edge !== 'rise' && edge !== 'fall')) return undefined;
  if (level === undefined || !Number.isFinite(level)) return undefined;
  return { action, source, edge, level };
}

// One narrowing function per emulator-emitted message type (FR-IPC-2): each
// rebuilds the message from only its known, type-checked fields, so nothing
// beyond the whitelisted shape can reach a downstream webview.
type Narrower = (obj: Record<string, unknown>) => IpcMessage | undefined;

const NARROWERS: Record<string, Narrower> = {
  status: (obj) => {
    const running = getBoolean(obj, 'running');
    if (running === undefined) return undefined;
    const msg: IpcMessage = { type: 'status', running };
    const sampleRate = getNumber(obj, 'sampleRate');
    if (sampleRate !== undefined) msg['sampleRate'] = sampleRate;
    const blockSize = getNumber(obj, 'blockSize');
    if (blockSize !== undefined) msg['blockSize'] = blockSize;
    return msg;
  },
  scope: (obj) => {
    const inSamples = getNumberArray(obj, 'in');
    const outSamples = getNumberArray(obj, 'out');
    if (!inSamples || !outSamples) return undefined;
    const msg: IpcMessage = { type: 'scope', in: inSamples, out: outSamples };
    // FR-SCI-2: both optional — an older emulator omits them, and a malformed
    // value is dropped rather than rejecting the whole snapshot.
    const outR = getNumberArray(obj, 'out_r');
    if (outR) msg['out_r'] = outR;
    const step = getNumber(obj, 'step');
    if (step !== undefined && Number.isInteger(step) && step >= 1) msg['step'] = step;
    return msg;
  },
  // FR-SCI-14c: one full-rate triggered window. The three channels must be the same
  // length and `trigger` an integer index inside them; anything else is dropped.
  scope_capture: (obj) => {
    const inSamples = getNumberArray(obj, 'in');
    const outSamples = getNumberArray(obj, 'out');
    const outR = getNumberArray(obj, 'out_r');
    const rate = getNumber(obj, 'rate');
    const trigger = getNumber(obj, 'trigger');
    if (!inSamples || !outSamples || !outR || rate === undefined || trigger === undefined) return undefined;
    if (!(rate > 0) || !Number.isInteger(trigger)) return undefined;
    if (outSamples.length !== inSamples.length || outR.length !== inSamples.length) return undefined;
    if (trigger < 0 || trigger >= inSamples.length) return undefined;
    return { type: 'scope_capture', in: inSamples, out: outSamples, out_r: outR, rate, trigger };
  },
  spectrum: (obj) => {
    const inFft = getNumberArray(obj, 'in_fft');
    const outFft = getNumberArray(obj, 'out_fft');
    const binHz = getNumber(obj, 'binHz');
    if (!inFft || !outFft || binHz === undefined) return undefined;
    return { type: 'spectrum', in_fft: inFft, out_fft: outFft, binHz };
  },
  event: (obj) => {
    const kind = getString(obj, 'kind');
    if (kind === undefined) return undefined;
    return { type: 'event', kind };
  },
  xrun: (obj) => {
    const count = getNumber(obj, 'count');
    if (count === undefined) return undefined;
    return { type: 'xrun', count };
  },
  latency: (obj) => {
    const estimatedMs = getNumber(obj, 'estimatedMs');
    if (estimatedMs === undefined) return undefined;
    return { type: 'latency', estimatedMs };
  },
  led: (obj) => {
    const gpioPin = getNumber(obj, 'gpioPin');
    const lit = getBoolean(obj, 'lit');
    if (gpioPin === undefined || lit === undefined) return undefined;
    return { type: 'led', gpioPin, lit };
  },
  // FR-DEV-8: keyed by the RgbLed instance's primary (red-channel) pin — the
  // same "one message per physical pin" convention as `led`, since the
  // instance's other two pins are recovered extension-side from the parsed
  // code annotation, not from this message.
  rgbLed: (obj) => {
    const gpioPin = getNumber(obj, 'gpioPin');
    const r = getNumber(obj, 'r');
    const g = getNumber(obj, 'g');
    const b = getNumber(obj, 'b');
    if (gpioPin === undefined || r === undefined || g === undefined || b === undefined) return undefined;
    return { type: 'rgbLed', gpioPin, r, g, b };
  },
  // FR-DEV-15: the SSD1306 framebuffer, base64 encoded (emulator/shim/src/
  // oled_display.cpp) — an opaque payload rather than a numeric array like
  // scope/spectrum, per the architecture doc's one exception to "adding a
  // device adds no message kinds."
  oledFrame: (obj) => {
    const data = getString(obj, 'data');
    if (data === undefined) return undefined;
    return { type: 'oledFrame', data };
  },
  // FR-DEV-18: one message per MIDI event, either direction. `status` is the
  // raw MIDI status byte; `midiType` is the shim's decoded message-kind enum.
  midiRx: (obj) => {
    const status = getNumber(obj, 'status');
    const data1 = getNumber(obj, 'data1');
    const data2 = getNumber(obj, 'data2');
    const channel = getNumber(obj, 'channel');
    const midiType = getNumber(obj, 'midiType');
    if (status === undefined || data1 === undefined || data2 === undefined
      || channel === undefined || midiType === undefined) return undefined;
    return { type: 'midiRx', status, data1, data2, channel, midiType };
  },
  midiTx: (obj) => {
    const status = getNumber(obj, 'status');
    const data1 = getNumber(obj, 'data1');
    const data2 = getNumber(obj, 'data2');
    const channel = getNumber(obj, 'channel');
    const midiType = getNumber(obj, 'midiType');
    if (status === undefined || data1 === undefined || data2 === undefined
      || channel === undefined || midiType === undefined) return undefined;
    return { type: 'midiTx', status, data1, data2, channel, midiType };
  },
  replayDone: () => ({ type: 'replayDone' }),
  protocolVersion: (obj) => {
    const version = getNumber(obj, 'version');
    if (version === undefined) return undefined;
    return { type: 'protocolVersion', version };
  },
};

// Validates a just-JSON-parsed IPC line against the known message vocabulary,
// rebuilding it from only whitelisted, type-checked fields. Returns undefined
// for anything malformed or of an unrecognized type, so the caller can log
// and drop it rather than forwarding untrusted shape downstream (FR-IPC-2).
export function parseIpcMessage(raw: unknown): IpcMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  if (typeof type !== 'string') return undefined;
  return NARROWERS[type]?.(obj);
}
