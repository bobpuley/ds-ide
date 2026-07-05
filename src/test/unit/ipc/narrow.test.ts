import { describe, it, expect } from 'vitest';
import { parseIpcMessage } from '../../../ipc/narrow';

describe('parseIpcMessage (FR-IPC-2)', () => {
  it('accepts a well-formed status message', () => {
    expect(parseIpcMessage({ type: 'status', running: true, sampleRate: 48000, blockSize: 256 }))
      .toEqual({ type: 'status', running: true, sampleRate: 48000, blockSize: 256 });
  });

  it('accepts a status message without optional fields', () => {
    expect(parseIpcMessage({ type: 'status', running: false }))
      .toEqual({ type: 'status', running: false });
  });

  it('rejects a status message with a non-boolean running field', () => {
    expect(parseIpcMessage({ type: 'status', running: 'yes' })).toBeUndefined();
  });

  it('drops non-numeric optional fields on a status message instead of forwarding them', () => {
    expect(parseIpcMessage({ type: 'status', running: true, sampleRate: '<img onerror=alert(1)>' }))
      .toEqual({ type: 'status', running: true });
  });

  it('accepts a well-formed scope message', () => {
    expect(parseIpcMessage({ type: 'scope', in: [0.1, 0.2], out: [0.3, 0.4] }))
      .toEqual({ type: 'scope', in: [0.1, 0.2], out: [0.3, 0.4] });
  });

  it('rejects a scope message with non-numeric sample arrays', () => {
    expect(parseIpcMessage({ type: 'scope', in: ['x'], out: [0.4] })).toBeUndefined();
  });

  it('accepts a well-formed spectrum message', () => {
    expect(parseIpcMessage({ type: 'spectrum', in_fft: [1], out_fft: [2], binHz: 46.9 }))
      .toEqual({ type: 'spectrum', in_fft: [1], out_fft: [2], binHz: 46.9 });
  });

  it('accepts a well-formed event message', () => {
    expect(parseIpcMessage({ type: 'event', kind: 'nan' })).toEqual({ type: 'event', kind: 'nan' });
  });

  it('rejects an event message with a non-string kind', () => {
    expect(parseIpcMessage({ type: 'event', kind: 42 })).toBeUndefined();
  });

  it('accepts a well-formed xrun message', () => {
    expect(parseIpcMessage({ type: 'xrun', count: 3 })).toEqual({ type: 'xrun', count: 3 });
  });

  it('accepts a well-formed latency message', () => {
    expect(parseIpcMessage({ type: 'latency', estimatedMs: 12.5 })).toEqual({ type: 'latency', estimatedMs: 12.5 });
  });

  it('accepts a well-formed led message', () => {
    expect(parseIpcMessage({ type: 'led', gpioPin: 28, lit: true })).toEqual({ type: 'led', gpioPin: 28, lit: true });
  });

  it('accepts a replayDone message with no extra fields required', () => {
    expect(parseIpcMessage({ type: 'replayDone' })).toEqual({ type: 'replayDone' });
  });

  it('rejects a message with an unknown type', () => {
    expect(parseIpcMessage({ type: 'nonsenseType', foo: 'bar' })).toBeUndefined();
  });

  it('rejects a message with no type field', () => {
    expect(parseIpcMessage({ running: true })).toBeUndefined();
  });

  it('rejects non-object input', () => {
    expect(parseIpcMessage('status')).toBeUndefined();
    expect(parseIpcMessage(null)).toBeUndefined();
    expect(parseIpcMessage(42)).toBeUndefined();
    expect(parseIpcMessage(undefined)).toBeUndefined();
  });

  it('does not forward extraneous fields beyond the known shape for a type', () => {
    const result = parseIpcMessage({ type: 'status', running: true, __proto__: { polluted: true }, extra: 'nope' });
    expect(result).toEqual({ type: 'status', running: true });
  });
});
