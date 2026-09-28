import * as path from 'path';
import * as vscode from 'vscode';
import { DAISY_DEBUG_TYPE } from '../commands/debug-deploy';
import { DS_IDE_DEBUG_TYPE } from '../debug/run-config-provider';
import type { EmulatorExit } from '../emulator/manager';
import {
  INITIAL_TRANSPORT_STATE, reduceTransport,
  type TransportEvent, type TransportMode, type TransportState,
} from './transport-state';

export const TRANSPORT_PHASE_CONTEXT = 'ds-ide.transportPhase';

// FR-TRN-4/5: owns the one TransportState every transport surface renders
// from. Surfaces subscribe to onDidChange; the phase is also published as the
// ds-ide.transportPhase context key that drives the Daisy view's title
// actions (Run / Debug vs Stop vs Cancel).
export class TransportController implements vscode.Disposable {
  private _state: TransportState = INITIAL_TRANSPORT_STATE;
  private readonly _onDidChange = new vscode.EventEmitter<TransportState>();
  readonly onDidChange: vscode.Event<TransportState> = this._onDidChange.event;
  private _work: vscode.CancellationTokenSource | undefined;
  /** The ds-ide (or standalone daisy-debug) session the transport is running in, for Stop. */
  session: vscode.DebugSession | undefined;

  constructor() {
    this.publishPhase();
  }

  get state(): TransportState {
    return this._state;
  }

  dispatch(event: TransportEvent): void {
    const next = reduceTransport(this._state, event);
    if (next === this._state) return;
    const phaseChanged = next.phase !== this._state.phase;
    this._state = next;
    if (phaseChanged) this.publishPhase();
    this._onDidChange.fire(next);
  }

  // Runs build/deploy work under a token the Daisy view's Cancel action can
  // cancel, in addition to the caller's own (notification) token.
  async trackWork<T>(
    token: vscode.CancellationToken | undefined,
    task: (token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T> {
    const work = new vscode.CancellationTokenSource();
    this._work = work;
    const sub = token?.onCancellationRequested(() => work.cancel());
    if (token?.isCancellationRequested) work.cancel();
    try {
      return await task(work.token);
    } finally {
      sub?.dispose();
      if (this._work === work) this._work = undefined;
      work.dispose();
    }
  }

  cancelWork(): void {
    this._work?.cancel();
  }

  private publishPhase(): void {
    void vscode.commands.executeCommand('setContext', TRANSPORT_PHASE_CONTEXT, this._state.phase);
  }

  dispose(): void {
    this._work?.cancel();
    this._onDidChange.dispose();
  }
}

export interface TransportEventSources {
  emulator: {
    on(event: 'exit', listener: (exit: EmulatorExit) => void): unknown;
    off(event: 'exit', listener: (exit: EmulatorExit) => void): unknown;
  };
  /** A saved file that the next build would pick up. */
  isProjectSource(uri: vscode.Uri): boolean;
}

// The transport mode a debug session stands for, or undefined if it isn't a
// transport session. A daisy-debug child of a ds-ide session is covered by
// its parent; only a standalone one (the granular ds-ide.debug command) counts.
function sessionMode(session: vscode.DebugSession): TransportMode | undefined {
  if (session.type === DS_IDE_DEBUG_TYPE) return session.configuration['noDebug'] ? 'run' : 'debug';
  if (session.type === DAISY_DEBUG_TYPE && !session.parentSession) return 'debug';
  return undefined;
}

const RESUMING_REQUESTS: ReadonlySet<string> = new Set(['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue']);

// Feeds the controller from everything that changes the transport state
// outside the deploy path itself (DeployCoordinator dispatches build/deploy
// events directly).
export function wireTransportEvents(
  controller: TransportController,
  sources: TransportEventSources,
): vscode.Disposable[] {
  const onExit = (exit: EmulatorExit): void => {
    controller.dispatch({ type: exit.crashed ? 'emulatorCrashed' : 'emulatorExited' });
  };
  sources.emulator.on('exit', onExit);

  return [
    vscode.debug.onDidStartDebugSession((session) => {
      const mode = sessionMode(session);
      if (!mode) return;
      controller.session = session;
      controller.dispatch({ type: 'sessionStarted', mode });
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (!sessionMode(session)) return;
      if (controller.session === session) controller.session = undefined;
      controller.dispatch({ type: 'sessionEnded' });
    }),
    vscode.debug.registerDebugAdapterTrackerFactory(DAISY_DEBUG_TYPE, {
      createDebugAdapterTracker: () => ({
        onDidSendMessage: (message: { type?: string; event?: string }) => {
          if (message.type !== 'event') return;
          if (message.event === 'stopped') controller.dispatch({ type: 'paused' });
          else if (message.event === 'continued') controller.dispatch({ type: 'resumed' });
        },
        // lldb-dap needn't send 'continued' after a continue/step request's
        // response, so resuming is also read off the request itself.
        onWillReceiveMessage: (message: { type?: string; command?: string }) => {
          if (message.type === 'request' && message.command && RESUMING_REQUESTS.has(message.command)) {
            controller.dispatch({ type: 'resumed' });
          }
        },
      }),
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (sources.isProjectSource(doc.uri)) controller.dispatch({ type: 'sourceSaved' });
    }),
    { dispose: () => { sources.emulator.off('exit', onExit); } },
  ];
}

const BUILD_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp']);

export function isBuildSource(fsPath: string): boolean {
  return BUILD_SOURCE_EXTENSIONS.has(path.extname(fsPath).toLowerCase());
}

/** Error-severity problems a build left in `diagnostics` (FR-TRN-6's "N problems"). */
export function countErrors(diagnostics: vscode.DiagnosticCollection): number {
  let n = 0;
  diagnostics.forEach((_uri, diags) => {
    n += diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
  });
  return n;
}
