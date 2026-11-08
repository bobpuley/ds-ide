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

  it('forwards optional out_r and step on a scope message (FR-SCI-2)', () => {
    expect(parseIpcMessage({ type: 'scope', in: [0.1], out: [0.3], out_r: [0.5], step: 4 }))
      .toEqual({ type: 'scope', in: [0.1], out: [0.3], out_r: [0.5], step: 4 });
  });

  it('drops a malformed out_r or step without rejecting the scope message (FR-SCI-2)', () => {
    expect(parseIpcMessage({ type: 'scope', in: [0.1], out: [0.3], out_r: ['x'], step: 'fast' }))
      .toEqual({ type: 'scope', in: [0.1], out: [0.3] });
    expect(parseIpcMessage({ type: 'scope', in: [0.1], out: [0.3], step: 0 }))
      .toEqual({ type: 'scope', in: [0.1], out: [0.3] });
    expect(parseIpcMessage({ type: 'scope', in: [0.1], out: [0.3], step: 2.5 }))
      .toEqual({ type: 'scope', in: [0.1], out: [0.3] });
  });

  it('narrows a scope_capture message (FR-SCI-14c)', () => {
    const msg = { type: 'scope_capture', in: [0, 1], out: [0, 2], out_r: [0, 3], rate: 48000, trigger: 1 };
    expect(parseIpcMessage({ ...msg, extra: 'dropped' })).toEqual(msg);
  });

  it('rejects a malformed scope_capture message (FR-SCI-14c)', () => {
    const ok = { type: 'scope_capture', in: [0, 1], out: [0, 2], out_r: [0, 3], rate: 48000, trigger: 1 };
    expect(parseIpcMessage({ ...ok, in: ['x'] })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, out: undefined })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, out_r: undefined })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, rate: 0 })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, rate: 'fast' })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, trigger: 2 })).toBeUndefined();   // outside the window
    expect(parseIpcMessage({ ...ok, trigger: 0.5 })).toBeUndefined();
    expect(parseIpcMessage({ ...ok, out: [1] })).toBeUndefined();     // channel length mismatch
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

  it('keeps whitelisted numeric details on an event message (FR-WIN-AUD-6)', () => {
    expect(parseIpcMessage({
      type: 'event', kind: 'buffer_size_mismatch', requestedFrames: 64, actualFrames: 480,
    })).toEqual({ type: 'event', kind: 'buffer_size_mismatch', requestedFrames: 64, actualFrames: 480 });
    expect(parseIpcMessage({
      type: 'event', kind: 'sample_rate_mismatch', engineSampleRate: 48000, deviceSampleRate: 44100,
    })).toEqual({ type: 'event', kind: 'sample_rate_mismatch', engineSampleRate: 48000, deviceSampleRate: 44100 });
  });

  it('drops non-numeric, non-finite and unknown event details (FR-WIN-AUD-6)', () => {
    expect(parseIpcMessage({
      type: 'event', kind: 'buffer_size_mismatch', requestedFrames: '64', actualFrames: Infinity, evil: 1,
    })).toEqual({ type: 'event', kind: 'buffer_size_mismatch' });
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

  it('accepts a well-formed rgbLed message (FR-DEV-8)', () => {
    expect(parseIpcMessage({ type: 'rgbLed', gpioPin: 5, r: 0.5, g: 0.1, b: 1 }))
      .toEqual({ type: 'rgbLed', gpioPin: 5, r: 0.5, g: 0.1, b: 1 });
  });

  it('rejects an rgbLed message missing a channel', () => {
    expect(parseIpcMessage({ type: 'rgbLed', gpioPin: 5, r: 0.5, g: 0.1 })).toBeUndefined();
  });

  it('accepts a well-formed oledFrame message (FR-DEV-15)', () => {
    expect(parseIpcMessage({ type: 'oledFrame', data: 'QUJD' }))
      .toEqual({ type: 'oledFrame', data: 'QUJD' });
  });

  it('rejects an oledFrame message missing its data field', () => {
    expect(parseIpcMessage({ type: 'oledFrame' })).toBeUndefined();
  });

  it('accepts a replayDone message with no extra fields required', () => {
    expect(parseIpcMessage({ type: 'replayDone' })).toEqual({ type: 'replayDone' });
  });

  it('accepts a well-formed protocolVersion message (FR-DEV-6)', () => {
    expect(parseIpcMessage({ type: 'protocolVersion', version: 1 })).toEqual({ type: 'protocolVersion', version: 1 });
  });

  it('rejects a protocolVersion message with a non-numeric version', () => {
    expect(parseIpcMessage({ type: 'protocolVersion', version: '1' })).toBeUndefined();
  });

  it('accepts a well-formed midiRx message (FR-DEV-18)', () => {
    expect(parseIpcMessage({ type: 'midiRx', status: 0xb0, data1: 1, data2: 127, channel: 0, midiType: 11 }))
      .toEqual({ type: 'midiRx', status: 0xb0, data1: 1, data2: 127, channel: 0, midiType: 11 });
  });

  it('rejects a midiRx message missing a required field', () => {
    expect(parseIpcMessage({ type: 'midiRx', status: 0xb0, data1: 1, data2: 127, channel: 0 })).toBeUndefined();
  });

  it('rejects a midiRx message with a non-numeric field', () => {
    expect(parseIpcMessage({ type: 'midiRx', status: 0xb0, data1: 1, data2: 127, channel: 0, midiType: 'cc' }))
      .toBeUndefined();
  });

  it('accepts a well-formed midiTx message (FR-DEV-18)', () => {
    expect(parseIpcMessage({ type: 'midiTx', status: 0x90, data1: 60, data2: 100, channel: 3, midiType: 9 }))
      .toEqual({ type: 'midiTx', status: 0x90, data1: 60, data2: 100, channel: 3, midiType: 9 });
  });

  it('rejects a midiTx message missing a required field', () => {
    expect(parseIpcMessage({ type: 'midiTx', status: 0x90, data1: 60, data2: 100, midiType: 9 })).toBeUndefined();
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
