import * as cp from 'child_process';
import * as vscode from 'vscode';
import { detectLldbDap, lldbDapNotFoundMessage } from '../hardware/toolchain';
import { defaultExists, defaultExec, type Exists, type Exec, type LocateOptions } from '../hardware/tool-locator';

// FR-WIN-DBG-1: per-platform lookup. macOS asks xcrun first, so it respects the
// active Xcode/CLT selection; every platform then goes through the shared tool
// locator (PATH, then the known locations — Command Line Tools / Xcode, the
// versioned Debian/Ubuntu names, or on Windows the clang/MinGW toolchain).
export async function findLldbDap(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Pick<LocateOptions, 'platform' | 'env' | 'listDir'> = {},
): Promise<string | undefined> {
  if ((env.platform ?? process.platform) !== 'win32') {
    try {
      const result = (await exec('xcrun', ['--find', 'lldb-dap'])).trim();
      if (result && await exists(result)) return result;
    } catch { /* xcrun not available or lldb-dap not found */ }
  }
  return detectLldbDap(exists, exec, env);
}

export class DaisyDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(
    private readonly _findLldbDap: () => Promise<string | undefined> = findLldbDap,
    private readonly _platform: NodeJS.Platform = process.platform,
    // FR-WIN-TCH-4: on Windows, offered when lldb-dap is missing; true = installed.
    private readonly _offerToolchain?: () => Promise<boolean>,
    // FR-DBG-1: where the proxy reports lldb-dap stream errors and exits.
    private readonly _log: (line: string) => void = (line) => console.warn(line),
  ) {}

  async createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
  ): Promise<vscode.DebugAdapterDescriptor | undefined> {
    let lldbDap = await this._findLldbDap();
    if (!lldbDap && this._platform === 'win32' && this._offerToolchain && await this._offerToolchain()) {
      lldbDap = await this._findLldbDap();
    }
    if (!lldbDap) {
      void vscode.window.showErrorMessage(lldbDapNotFoundMessage(this._platform));
      return undefined;
    }
    return new vscode.DebugAdapterInlineImplementation(new FilteringLldbDapAdapter(lldbDap, undefined, this._log));
  }
}

// lldb-dap reports the mandatory PID-attach/detach SIGSTOP as a generic
// 'exception' stopped event — DAP has no dedicated "signal" stop reason — a
// benign artifact of its own detach mechanics, not a real fault (FR-UX-7).
export function isSpuriousDetachSigstop(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const msg = message as Record<string, unknown>;
  if (msg['type'] !== 'event' || msg['event'] !== 'stopped') return false;
  const body = msg['body'];
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b['reason'] !== 'exception') return false;
  const text = `${b['description'] ?? ''} ${b['text'] ?? ''}`;
  return /SIGSTOP/.test(text);
}

function encodeDapMessage(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, json]);
}

// Narrow surface FilteringLldbDapAdapter needs from a spawned child process —
// lets tests supply a fake without a real subprocess.
export interface DapChildProcess {
  readonly stdout: NodeJS.ReadableStream;
  readonly stdin: NodeJS.WritableStream;
  kill(): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
}

export type SpawnDapChild = (command: string) => DapChildProcess;

const defaultSpawnDapChild: SpawnDapChild = (command) => cp.spawn(command, []);

// Proxies lldb-dap's stdio, relaying every DAP message unchanged except the
// one spurious detach-time SIGSTOP "exception" event (FR-UX-7). A plain
// DebugAdapterExecutable passthrough can't do this: vscode.DebugAdapterTracker
// only observes messages, it can't drop or rewrite them.
export class FilteringLldbDapAdapter implements vscode.DebugAdapter {
  private readonly _emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage: vscode.Event<vscode.DebugProtocolMessage> = this._emitter.event;
  private readonly _child: DapChildProcess;
  private _buffer = Buffer.alloc(0);
  // FR-DBG-1: set once lldb-dap is gone (exit or spawn error); from then on
  // nothing is written to it and exactly one `terminated` has been sent.
  private _dead = false;

  constructor(
    lldbDapPath: string,
    spawn: SpawnDapChild = defaultSpawnDapChild,
    private readonly _log: (line: string) => void = (line) => console.warn(line),
  ) {
    this._child = spawn(lldbDapPath);
    this._child.stdout.on('data', (chunk: Buffer) => this._onData(chunk));
    // An 'error' with no listener is thrown by Node (EPIPE after lldb-dap dies).
    this._child.stdin.on('error', (err: Error) => this._log(`ds-ide: lldb-dap stdin error — ${err.message}`));
    this._child.stdout.on('error', (err: Error) => this._log(`ds-ide: lldb-dap stdout error — ${err.message}`));
    this._child.on('error', (err) => {
      this._log(`ds-ide: lldb-dap process error — ${err.message}`);
      void vscode.window.showErrorMessage(`ds-ide: daisy-debug adapter error — ${err.message}`);
      this._backendGone();
    });
    this._child.on('exit', (code) => {
      this._log(`ds-ide: lldb-dap exited (code ${code ?? 'null'})`);
      this._backendGone();
    });
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    if (this._dead) return;
    const stdin = this._child.stdin as NodeJS.WritableStream & { writable?: boolean };
    if (stdin.writable === false) return;
    stdin.write(encodeDapMessage(message));
  }

  // Tells VS Code the session is over, so the debug toolbar does not stay
  // "running" against a dead backend. Idempotent.
  private _backendGone(): void {
    if (this._dead) return;
    this._dead = true;
    this._emitter.fire({ type: 'event', event: 'terminated', seq: 0, body: {} } as vscode.DebugProtocolMessage);
  }

  private _onData(chunk: Buffer): void {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    for (;;) {
      const headerEnd = this._buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this._buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Malformed/unrecognized header — drop it and resync on the next one.
        this._buffer = this._buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this._buffer.length < bodyStart + length) return;
      const body = this._buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this._buffer = this._buffer.subarray(bodyStart + length);
      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (!isSpuriousDetachSigstop(message)) {
        this._emitter.fire(message as vscode.DebugProtocolMessage);
      }
    }
  }

  dispose(): void {
    this._child.kill();
    this._emitter.dispose();
  }
}

export type AudioModeCallback = (mode: 'simulated' | 'realtime') => void;

// T11.3 — mute-on-breakpoint (R15 mitigation, 04 §7).
// Intercepts DAP events from lldb-dap and switches the emulator audio clock:
//   stopped  → simulated (avoids xruns while lldb holds the audio thread)
//   continued / exited / terminated → realtime (resumes OS callback)
export class MuteOnBreakpointTracker implements vscode.DebugAdapterTracker {
  constructor(private readonly onAudioMode: AudioModeCallback) {}

  onDidSendMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    const msg = message as Record<string, unknown>;
    if (msg['type'] !== 'event') return;
    const event = msg['event'];
    if (event === 'stopped') {
      this.onAudioMode('simulated');
    } else if (event === 'continued' || event === 'exited' || event === 'terminated') {
      this.onAudioMode('realtime');
    }
  }
}

export class DaisyDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {
  constructor(private readonly onAudioMode: AudioModeCallback) {}

  createDebugAdapterTracker(
    _session: vscode.DebugSession,
  ): vscode.ProviderResult<vscode.DebugAdapterTracker> {
    return new MuteOnBreakpointTracker(this.onAudioMode);
  }
}
