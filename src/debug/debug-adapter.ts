import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { LLDB_DAP_NOT_FOUND_MESSAGE } from '../hardware/toolchain';

const LLDB_DAP_CANDIDATES = [
  '/Library/Developer/CommandLineTools/usr/bin/lldb-dap',
  '/usr/bin/lldb-dap',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap',
];

// Debian/Ubuntu LLVM packages (apt.llvm.org and distro repos) install
// lldb-dap under a version-suffixed name alongside — or instead of — the
// unversioned symlink. Tried newest-first on PATH via `which` (FR-QA-EXT-9).
const LLDB_DAP_LINUX_PATH_NAMES = [
  'lldb-dap',
  'lldb-dap-20', 'lldb-dap-19', 'lldb-dap-18', 'lldb-dap-17',
  'lldb-dap-16', 'lldb-dap-15', 'lldb-dap-14',
];

type Exists = (p: string) => Promise<boolean>;
type Exec   = (cmd: string, args: string[]) => Promise<string>;

const defaultExists: Exists = async (p) => {
  try { await fs.promises.access(p); return true; } catch { return false; }
};

// execFile (not exec) — no shell is involved, so binary/arg strings can't be
// reinterpreted as shell metacharacters.
const defaultExec: Exec = (cmd, args) =>
  new Promise<string>((resolve, reject) =>
    cp.execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );

export async function findLldbDap(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
): Promise<string | undefined> {
  // Prefer xcrun so it respects the active Xcode/CLT selection.
  try {
    const result = (await exec('xcrun', ['--find', 'lldb-dap'])).trim();
    if (result && await exists(result)) return result;
  } catch { /* xcrun not available or lldb-dap not found */ }

  for (const name of LLDB_DAP_LINUX_PATH_NAMES) {
    try {
      const result = (await exec('which', [name])).trim();
      if (result && await exists(result)) return result;
    } catch { /* not on PATH under this name */ }
  }

  for (const p of LLDB_DAP_CANDIDATES) {
    if (await exists(p)) return p;
  }
  return undefined;
}

export class DaisyDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(
    private readonly _findLldbDap: () => Promise<string | undefined> = findLldbDap,
  ) {}

  async createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
  ): Promise<vscode.DebugAdapterDescriptor | undefined> {
    const lldbDap = await this._findLldbDap();
    if (!lldbDap) {
      void vscode.window.showErrorMessage(LLDB_DAP_NOT_FOUND_MESSAGE);
      return undefined;
    }
    return new vscode.DebugAdapterInlineImplementation(new FilteringLldbDapAdapter(lldbDap));
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

  constructor(lldbDapPath: string, spawn: SpawnDapChild = defaultSpawnDapChild) {
    this._child = spawn(lldbDapPath);
    this._child.stdout.on('data', (chunk: Buffer) => this._onData(chunk));
    this._child.on('error', (err) => {
      void vscode.window.showErrorMessage(`ds-ide: daisy-debug adapter error — ${err.message}`);
    });
  }

  handleMessage(message: vscode.DebugProtocolMessage): void {
    this._child.stdin.write(encodeDapMessage(message));
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
