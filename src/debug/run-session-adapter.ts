import * as vscode from 'vscode';
import type { EmulatorExit } from '../emulator/manager';
import type { TransportMode } from '../transport/transport-state';

// What the run session needs from the rest of the extension — kept narrow so
// the adapter is testable without an EmulatorManager.
export interface RunSessionHost {
  currentEmulatorPid(): number | undefined;
  stopEmulator(): void;
  onEmulatorExit(listener: (exit: EmulatorExit) => void): { dispose(): void };
  /** True once per freshly resolved config; false for a Restart relaunch (FR-TRN-2). */
  consumeLaunch(config: Record<string, unknown>): boolean;
  /** Full build + deploy with progress, used on Restart (FR-TRN-2). */
  rebuildAndDeploy(mode: TransportMode, token: vscode.CancellationToken): Promise<boolean>;
  /** Starts the daisy-debug child session against `pid` (F5 mode). */
  attachDebugger(pid: number): Promise<boolean>;
}

interface DapRequest {
  type: 'request';
  command: string;
  seq: number;
  arguments?: Record<string, unknown>;
}

function asRequest(message: vscode.DebugProtocolMessage): DapRequest | undefined {
  const m = message as Partial<DapRequest>;
  if (m.type !== 'request' || typeof m.command !== 'string' || typeof m.seq !== 'number') return undefined;
  return m as DapRequest;
}

// DebugProtocolMessage is an opaque VS Code type; valid DAP payloads are narrowed here once.
function makeDap(msg: { type: string; seq: number; [k: string]: unknown }): vscode.DebugProtocolMessage {
  return msg as vscode.DebugProtocolMessage;
}

// FR-TRN-1: the inline DAP adapter behind a live `ds-ide` session. It has no
// threads or stack of its own; it exists so VS Code shows its toolbar for as
// long as the emulator runs, and it ties the two lifetimes together:
//   - Stop (disconnect / terminate) → stops the emulator it was bound to;
//   - that emulator exiting for any reason → the session ends;
//   - disposal (e.g. window reload) → stops the emulator if still running.
// It is bound to one emulator by PID, so an old session can never stop the
// emulator a later launch started.
//
// FR-TRN-2: it declares no supportsRestartRequest, so VS Code's Restart is
// disconnect + a fresh adapter + the same launch request. A launch whose
// config was already used (host.consumeLaunch) is such a relaunch: the
// adapter rebuilds and redeploys before binding. In F5 mode it then attaches
// daisy-debug as its child, so the debug toolbar's Restart / Stop reach here.
export class RunSessionAdapter implements vscode.DebugAdapter {
  private readonly _emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this._emitter.event;
  private _seq = 0;
  private _boundPid: number | undefined;
  private _terminated = false;
  private _stopped = false;
  private readonly _cts = new vscode.CancellationTokenSource();
  private readonly _exitSub: { dispose(): void };

  constructor(private readonly host: RunSessionHost) {
    this._exitSub = host.onEmulatorExit((exit) => {
      if (this._boundPid === undefined || exit.pid !== this._boundPid) return;
      this._boundPid = undefined;
      this.sendTerminated();
    });
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const req = asRequest(message);
    if (!req) return;
    switch (req.command) {
      case 'initialize':
        this.respond(req, {});
        this.sendEvent('initialized');
        return;
      case 'launch':
        void this.launch(req);
        return;
      case 'threads':
        this.respond(req, { threads: [] });
        return;
      case 'disconnect':
      case 'terminate':
        this._stopped = true;
        this._cts.cancel();
        this.stopOwnEmulator();
        this.respond(req, {});
        this.sendTerminated();
        return;
      default:
        this.respond(req, {});
    }
  }

  private async launch(req: DapRequest): Promise<void> {
    const config = req.arguments ?? {};
    const mode: TransportMode = config['noDebug'] ? 'run' : 'debug';
    if (!this.host.consumeLaunch(config)) {
      const ok = await this.host.rebuildAndDeploy(mode, this._cts.token);
      if (!ok || this._stopped) {
        // Stopped mid-rebuild but the deploy won the race: that emulator
        // belongs to this session and must not outlive it.
        if (ok) this.host.stopEmulator();
        this.respond(req, {});
        this.sendTerminated();
        return;
      }
    }
    const pid = this.host.currentEmulatorPid();
    this._boundPid = pid;
    this.respond(req, {});
    if (pid === undefined) {
      this.sendTerminated();
      return;
    }
    if (mode === 'debug' && !(await this.host.attachDebugger(pid))) {
      this.stopOwnEmulator();
      this.sendTerminated();
    }
  }

  // Only the emulator this session was bound to, and only while it's still
  // the current one — a later launch may have replaced it.
  private stopOwnEmulator(): void {
    const pid = this._boundPid;
    this._boundPid = undefined;
    if (pid !== undefined && this.host.currentEmulatorPid() === pid) this.host.stopEmulator();
  }

  private respond(req: DapRequest, body: Record<string, unknown>): void {
    this._emitter.fire(makeDap({
      type: 'response', command: req.command, request_seq: req.seq, seq: ++this._seq, success: true, body,
    }));
  }

  private sendEvent(event: string): void {
    this._emitter.fire(makeDap({ type: 'event', event, seq: ++this._seq, body: {} }));
  }

  private sendTerminated(): void {
    if (this._terminated) return;
    this._terminated = true;
    this.sendEvent('terminated');
  }

  dispose(): void {
    this._stopped = true;
    this._cts.cancel();
    this._cts.dispose();
    this.stopOwnEmulator();
    this._exitSub.dispose();
    this._emitter.dispose();
  }
}
