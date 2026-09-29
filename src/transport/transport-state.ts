// FR-TRN-5: the single model of "is the effect running" that every transport
// surface (status items, Daisy view, context keys) renders from. Status-bar
// text used to be written from seven separate places in extension.ts, so no
// component knew the actual state. Pure — no vscode import — so every
// transition is unit-testable.

export type TransportPhase =
  | 'stopped'
  | 'building'
  | 'deploying'
  | 'running'
  | 'debugging'
  | 'paused'
  | 'buildFailed'
  | 'crashed';

export type TransportMode = 'run' | 'debug';

export interface BoardInfo {
  name: string;
  /** USB vendor:product, e.g. `0483:df11`. */
  usbId: string;
}

export interface TransportState {
  readonly phase: TransportPhase;
  readonly mode: TransportMode | undefined;
  /** Problem count of the last failed build; undefined otherwise. */
  readonly problems: number | undefined;
  /** A saved source edit is newer than the build the session is running. */
  readonly stale: boolean;
  /** undefined = never detected; null = detection found no board. */
  readonly board: BoardInfo | null | undefined;
}

export type TransportEvent =
  | { type: 'buildStarted'; mode: TransportMode }
  | { type: 'deployStarted'; mode: TransportMode }
  | { type: 'deploySucceeded' }
  | { type: 'deployFailed'; problems: number }
  /** Cancelled, or the emulator failed to start — nothing to report as build problems. */
  | { type: 'deployAborted' }
  | { type: 'sessionStarted'; mode: TransportMode }
  | { type: 'sessionEnded' }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'emulatorExited' }
  | { type: 'emulatorCrashed' }
  | { type: 'sourceSaved' }
  | { type: 'boardDetected'; board: BoardInfo }
  | { type: 'boardNotDetected' };

export const INITIAL_TRANSPORT_STATE: TransportState = {
  phase: 'stopped',
  mode: undefined,
  problems: undefined,
  stale: false,
  board: undefined,
};

const LIVE_PHASES: ReadonlySet<TransportPhase> = new Set(['running', 'debugging', 'paused']);
const BUSY_PHASES: ReadonlySet<TransportPhase> = new Set(['building', 'deploying']);

function stopped(state: TransportState): TransportState {
  return { ...state, phase: 'stopped', mode: undefined, problems: undefined, stale: false };
}

export function reduceTransport(state: TransportState, event: TransportEvent): TransportState {
  switch (event.type) {
    case 'buildStarted':
      return { ...state, phase: 'building', mode: event.mode, problems: undefined, stale: false };
    case 'deployStarted':
      return { ...state, phase: 'deploying', mode: event.mode, problems: undefined };
    case 'deploySucceeded':
      return { ...state, phase: state.mode === 'debug' ? 'debugging' : 'running' };
    case 'deployFailed':
      return { ...state, phase: 'buildFailed', problems: event.problems, stale: false };
    case 'deployAborted':
      return stopped(state);
    case 'sessionStarted':
      return { ...state, phase: event.mode === 'debug' ? 'debugging' : 'running', mode: event.mode };
    case 'sessionEnded':
      // A Restart ends the old session while its rebuild is already under
      // way; the build's own outcome decides what comes next.
      if (BUSY_PHASES.has(state.phase)) return state;
      // A crash or build failure is the more useful thing to keep showing
      // than the plain "stopped" the session's end would otherwise imply.
      if (state.phase === 'crashed' || state.phase === 'buildFailed') return { ...state, stale: false };
      return stopped(state);
    case 'paused':
      return state.phase === 'debugging' ? { ...state, phase: 'paused' } : state;
    case 'resumed':
      return state.phase === 'paused' ? { ...state, phase: 'debugging' } : state;
    // Only a live emulator's exit means anything: the exit of one a redeploy
    // or Restart just replaced arrives while the new build is in flight.
    case 'emulatorExited':
      return LIVE_PHASES.has(state.phase) ? stopped(state) : state;
    case 'emulatorCrashed':
      return LIVE_PHASES.has(state.phase) ? { ...state, phase: 'crashed', stale: false } : state;
    case 'sourceSaved':
      return LIVE_PHASES.has(state.phase) ? { ...state, stale: true } : state;
    case 'boardDetected':
      return { ...state, board: event.board };
    case 'boardNotDetected':
      return { ...state, board: null };
  }
}

const PHASE_LABELS: Record<TransportPhase, string> = {
  stopped: 'stopped',
  building: 'building',
  deploying: 'deploying',
  running: 'running',
  debugging: 'debugging',
  paused: 'paused',
  buildFailed: 'build failed',
  crashed: 'crashed',
};

export function phaseLabel(phase: TransportPhase): string {
  return PHASE_LABELS[phase];
}

/** Build/deploy work is in flight — the transport offers Cancel rather than Stop. */
export function isTransportBusy(phase: TransportPhase): boolean {
  return BUSY_PHASES.has(phase);
}
