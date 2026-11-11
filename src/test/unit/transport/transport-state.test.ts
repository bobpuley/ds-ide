import { describe, it, expect } from 'vitest';
import {
  INITIAL_TRANSPORT_STATE,
  reduceTransport,
  phaseLabel,
  isTransportBusy,
  type TransportEvent,
  type TransportState,
} from '../../../transport/transport-state';

function run(events: TransportEvent[], from: TransportState = INITIAL_TRANSPORT_STATE): TransportState {
  return events.reduce(reduceTransport, from);
}

const BOARD = { name: 'Daisy Seed', usbId: '0483:df11' };

describe('reduceTransport()', () => {
  it('starts stopped, not stale, with no mode and an undetected board', () => {
    expect(INITIAL_TRANSPORT_STATE).toEqual({
      phase: 'stopped', mode: undefined, problems: undefined, stale: false, board: undefined,
    });
  });

  it('build started → building, recording the mode', () => {
    const s = run([{ type: 'buildStarted', mode: 'run' }]);
    expect(s.phase).toBe('building');
    expect(s.mode).toBe('run');
  });

  it('deploy started → deploying', () => {
    const s = run([{ type: 'buildStarted', mode: 'run' }, { type: 'deployStarted', mode: 'run' }]);
    expect(s.phase).toBe('deploying');
  });

  it('deploy succeeded in run mode → running', () => {
    const s = run([{ type: 'deployStarted', mode: 'run' }, { type: 'deploySucceeded' }]);
    expect(s.phase).toBe('running');
  });

  it('deploy failed with problems → buildFailed with the problem count', () => {
    const s = run([{ type: 'buildStarted', mode: 'run' }, { type: 'deployFailed', problems: 3 }]);
    expect(s.phase).toBe('buildFailed');
    expect(s.problems).toBe(3);
  });

  it('a new build clears a previous problem count', () => {
    const s = run([
      { type: 'buildStarted', mode: 'run' }, { type: 'deployFailed', problems: 3 },
      { type: 'buildStarted', mode: 'run' },
    ]);
    expect(s.phase).toBe('building');
    expect(s.problems).toBeUndefined();
  });

  it('a build that failed for a specific reason keeps it, with no problem count (FR-REL-2)', () => {
    const s = run([
      { type: 'buildStarted', mode: 'run' },
      { type: 'deployFailed', problems: undefined, reason: 'CMake not found.' },
    ]);
    expect(s.phase).toBe('buildFailed');
    expect(s.problems).toBeUndefined();
    expect(s.failureReason).toBe('CMake not found.');
  });

  it('a new build clears a previous failure reason (FR-REL-2)', () => {
    const s = run([
      { type: 'buildStarted', mode: 'run' },
      { type: 'deployFailed', problems: undefined, reason: 'CMake not found.' },
      { type: 'buildStarted', mode: 'run' },
    ]);
    expect(s.failureReason).toBeUndefined();
  });

  it('a plain failed build has no failure reason (FR-REL-2)', () => {
    const s = run([{ type: 'buildStarted', mode: 'run' }, { type: 'deployFailed', problems: 2 }]);
    expect(s.failureReason).toBeUndefined();
  });

  it('deploy aborted (cancelled, or the emulator failed to start) → stopped', () => {
    const s = run([{ type: 'buildStarted', mode: 'run' }, { type: 'deployAborted' }]);
    expect(s.phase).toBe('stopped');
  });

  it('deploy succeeded in debug mode → debugging (a debug Restart redeploys inside the session)', () => {
    const s = run([{ type: 'buildStarted', mode: 'debug' }, { type: 'deploySucceeded' }]);
    expect(s.phase).toBe('debugging');
  });

  it("a Restart's rebuild is not undone by the old session ending or the old emulator exiting", () => {
    const s = run([
      { type: 'sessionStarted', mode: 'run' },
      { type: 'buildStarted', mode: 'run' },
      { type: 'emulatorExited' },
      { type: 'emulatorCrashed' },
      { type: 'sessionEnded' },
    ]);
    expect(s.phase).toBe('building');
    expect(s.mode).toBe('run');
  });

  it('an emulator exit while stopped or after a build failure changes nothing', () => {
    expect(run([{ type: 'emulatorCrashed' }]).phase).toBe('stopped');
    const failed = run([{ type: 'buildStarted', mode: 'run' }, { type: 'deployFailed', problems: 1 }, { type: 'emulatorExited' }]);
    expect(failed.phase).toBe('buildFailed');
  });

  it('debug session started → debugging, mode debug', () => {
    const s = run([
      { type: 'buildStarted', mode: 'run' }, { type: 'deploySucceeded' },
      { type: 'sessionStarted', mode: 'debug' },
    ]);
    expect(s.phase).toBe('debugging');
    expect(s.mode).toBe('debug');
  });

  it('run session started → running, mode run', () => {
    const s = run([{ type: 'sessionStarted', mode: 'run' }]);
    expect(s.phase).toBe('running');
    expect(s.mode).toBe('run');
  });

  it('paused / resumed toggles between paused and debugging', () => {
    const debugging = run([{ type: 'sessionStarted', mode: 'debug' }]);
    const paused = reduceTransport(debugging, { type: 'paused' });
    expect(paused.phase).toBe('paused');
    expect(reduceTransport(paused, { type: 'resumed' }).phase).toBe('debugging');
  });

  it('paused is ignored when nothing is debugging', () => {
    expect(run([{ type: 'paused' }]).phase).toBe('stopped');
    expect(run([{ type: 'resumed' }]).phase).toBe('stopped');
  });

  it('session ended → stopped, clears mode and stale', () => {
    const s = run([
      { type: 'sessionStarted', mode: 'run' }, { type: 'sourceSaved' }, { type: 'sessionEnded' },
    ]);
    expect(s).toMatchObject({ phase: 'stopped', mode: undefined, stale: false });
  });

  it('session ended does not hide a crash', () => {
    const s = run([
      { type: 'sessionStarted', mode: 'run' }, { type: 'emulatorCrashed' }, { type: 'sessionEnded' },
    ]);
    expect(s.phase).toBe('crashed');
  });

  it('session ended does not hide a build failure', () => {
    const s = run([
      { type: 'sessionStarted', mode: 'run' },
      { type: 'buildStarted', mode: 'run' }, { type: 'deployFailed', problems: 2 },
      { type: 'sessionEnded' },
    ]);
    expect(s.phase).toBe('buildFailed');
    expect(s.problems).toBe(2);
  });

  it('emulator exited → stopped', () => {
    const s = run([{ type: 'sessionStarted', mode: 'run' }, { type: 'emulatorExited' }]);
    expect(s.phase).toBe('stopped');
  });

  it('emulator crashed → crashed, not stale', () => {
    const s = run([{ type: 'sessionStarted', mode: 'run' }, { type: 'sourceSaved' }, { type: 'emulatorCrashed' }]);
    expect(s.phase).toBe('crashed');
    expect(s.stale).toBe(false);
  });

  it('a save while stopped does not mark the state stale', () => {
    expect(run([{ type: 'sourceSaved' }]).stale).toBe(false);
  });

  it('a save while building does not mark the state stale (the build may not have read it yet, but it is about to be replaced)', () => {
    expect(run([{ type: 'buildStarted', mode: 'run' }, { type: 'sourceSaved' }]).stale).toBe(false);
  });

  it('a save while running marks the state stale', () => {
    expect(run([{ type: 'sessionStarted', mode: 'run' }, { type: 'sourceSaved' }]).stale).toBe(true);
  });

  it('a save while debugging or paused marks the state stale', () => {
    expect(run([{ type: 'sessionStarted', mode: 'debug' }, { type: 'sourceSaved' }]).stale).toBe(true);
    expect(run([{ type: 'sessionStarted', mode: 'debug' }, { type: 'paused' }, { type: 'sourceSaved' }]).stale).toBe(true);
  });

  it('a new build clears stale', () => {
    const s = run([
      { type: 'sessionStarted', mode: 'run' }, { type: 'sourceSaved' }, { type: 'buildStarted', mode: 'run' },
    ]);
    expect(s.stale).toBe(false);
  });

  it('board detected / not detected updates only the board', () => {
    const running = run([{ type: 'sessionStarted', mode: 'run' }]);
    const detected = reduceTransport(running, { type: 'boardDetected', board: BOARD });
    expect(detected.board).toEqual(BOARD);
    expect(detected.phase).toBe('running');
    const none = reduceTransport(detected, { type: 'boardNotDetected' });
    expect(none.board).toBeNull();
    expect(none.phase).toBe('running');
  });

  it('never mutates the input state', () => {
    const before = run([{ type: 'sessionStarted', mode: 'run' }]);
    const snapshot = { ...before };
    reduceTransport(before, { type: 'sourceSaved' });
    expect(before).toEqual(snapshot);
  });
});

describe('phaseLabel()', () => {
  it.each([
    ['stopped', 'stopped'], ['building', 'building'], ['deploying', 'deploying'],
    ['running', 'running'], ['debugging', 'debugging'], ['paused', 'paused'],
    ['buildFailed', 'build failed'], ['crashed', 'crashed'],
  ] as const)('%s → %s', (phase, label) => {
    expect(phaseLabel(phase)).toBe(label);
  });
});

describe('isTransportBusy()', () => {
  it('is true only while building or deploying', () => {
    expect(isTransportBusy('building')).toBe(true);
    expect(isTransportBusy('deploying')).toBe(true);
    for (const p of ['stopped', 'running', 'debugging', 'paused', 'buildFailed', 'crashed'] as const) {
      expect(isTransportBusy(p)).toBe(false);
    }
  });
});
