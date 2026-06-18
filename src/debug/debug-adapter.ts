import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';

const LLDB_DAP_CANDIDATES = [
  '/Library/Developer/CommandLineTools/usr/bin/lldb-dap',
  '/usr/bin/lldb-dap',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap',
];

export function findLldbDap(
  existsSync: (p: string) => boolean = fs.existsSync,
  execSync: (cmd: string) => Buffer = cp.execSync,
): string | undefined {
  // Prefer xcrun so it respects the active Xcode/CLT selection.
  try {
    const result = execSync('xcrun --find lldb-dap 2>/dev/null').toString().trim();
    if (result && existsSync(result)) return result;
  } catch { /* xcrun not available or lldb-dap not found */ }

  return LLDB_DAP_CANDIDATES.find((p) => existsSync(p));
}

export class DaisyDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(
    private readonly _findLldbDap: () => string | undefined = findLldbDap,
  ) {}

  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const lldbDap = this._findLldbDap();
    if (!lldbDap) {
      void vscode.window.showErrorMessage(
        'ds-ide: lldb-dap not found. Install Xcode Command Line Tools: xcode-select --install',
      );
      return undefined;
    }
    return new vscode.DebugAdapterExecutable(lldbDap, []);
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
