import { describe, it, expect } from 'vitest';
import {
  planCapture, wantsEmulatorCapture, MIN_REQUEST_INTERVAL_MS, REARM_AFTER_MS,
  type CapturePlanInput,
} from '../../../webview/scope/scope-capture-source';

const base: CapturePlanInput = {
  wants: true,
  params: { source: 'in', edge: 'rise', level: 0.1 },
  armed: null,
  nowMs: 10_000,
  lastArmMs: 0,
};

describe('wantsEmulatorCapture (FR-SCI-14d)', () => {
  it('needs an edge trigger', () => {
    expect(wantsEmulatorCapture({ trigMode: 'free', singleArmed: true, lowRes: true })).toBe(false);
  });
  it('is wanted for an armed single-shot at any time base', () => {
    expect(wantsEmulatorCapture({ trigMode: 'rise', singleArmed: true, lowRes: false })).toBe(true);
  });
  it('is wanted at a low-resolution time base without single-shot', () => {
    expect(wantsEmulatorCapture({ trigMode: 'fall', singleArmed: false, lowRes: true })).toBe(true);
  });
  it('is not wanted for a normal time base without single-shot', () => {
    expect(wantsEmulatorCapture({ trigMode: 'rise', singleArmed: false, lowRes: false })).toBe(false);
  });
});

describe('planCapture (FR-SCI-14d)', () => {
  it('arms when wanted and nothing is armed', () => {
    expect(planCapture(base)).toEqual({ action: 'arm', source: 'in', edge: 'rise', level: 0.1 });
  });

  it('does nothing while an identical request is pending', () => {
    expect(planCapture({ ...base, armed: base.params, lastArmMs: 9_900 })).toBeNull();
  });

  it('throttles a new request after a reply to about 5 per second', () => {
    expect(MIN_REQUEST_INTERVAL_MS).toBe(200);
    expect(planCapture({ ...base, lastArmMs: base.nowMs - 100 })).toBeNull();
    expect(planCapture({ ...base, lastArmMs: base.nowMs - 200 })).toEqual(
      { action: 'arm', source: 'in', edge: 'rise', level: 0.1 });
  });

  it('re-arms with new parameters, replacing the pending request', () => {
    const moved = { ...base.params, level: 0.3 };
    expect(planCapture({ ...base, params: moved, armed: base.params, lastArmMs: 9_000 }))
      .toEqual({ action: 'arm', source: 'in', edge: 'rise', level: 0.3 });
  });

  it('re-arms an unanswered request after the timeout (the emulator may have cleared it)', () => {
    expect(planCapture({ ...base, armed: base.params, lastArmMs: base.nowMs - REARM_AFTER_MS + 1 })).toBeNull();
    expect(planCapture({ ...base, armed: base.params, lastArmMs: base.nowMs - REARM_AFTER_MS }))
      .toEqual({ action: 'arm', source: 'in', edge: 'rise', level: 0.1 });
  });

  it('cancels a pending request once it is no longer wanted', () => {
    expect(planCapture({ ...base, wants: false, armed: base.params })).toEqual({ action: 'cancel' });
  });

  it('does nothing when not wanted and nothing is pending', () => {
    expect(planCapture({ ...base, wants: false })).toBeNull();
  });
});
