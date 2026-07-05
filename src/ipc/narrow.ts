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
    return { type: 'scope', in: inSamples, out: outSamples };
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
  replayDone: () => ({ type: 'replayDone' }),
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
