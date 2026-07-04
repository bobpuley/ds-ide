// Minimal vscode API mock for unit tests.
import { vi } from 'vitest';

const commands = {
  registerCommand: vi.fn((_id: string, _handler: (...args: unknown[]) => unknown) => ({
    dispose: vi.fn(),
  })),
  executeCommand: vi.fn(),
};

const window = {
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
  createWebviewPanel: vi.fn(() => ({
    webview: {
      html: '',
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      postMessage: vi.fn(),
      asWebviewUri: vi.fn((uri: unknown) => uri),
      cspSource: 'vscode-resource:',
    },
    onDidDispose: vi.fn((cb: () => void) => { void cb; return { dispose: vi.fn() }; }),
    reveal: vi.fn(),
    dispose: vi.fn(),
  })),
  createStatusBarItem: vi.fn((_alignment?: number, _priority?: number) => ({
    text: '',
    tooltip: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showInputBox: vi.fn(),
};

const workspace = {
  workspaceFolders: undefined as undefined | { uri: { fsPath: string } }[],
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
  })),
  openTextDocument: vi.fn(async () => ({
    getText: vi.fn(() => ''),
    lineCount: 1,
    lineAt: vi.fn((n: number) => ({ range: { end: new Position(n, 0) } })),
    save: vi.fn(async () => true),
  })),
  applyEdit: vi.fn(async () => true),
  onDidSaveTextDocument: vi.fn((_cb: (doc: { uri: { fsPath: string } }) => void) => ({ dispose: vi.fn() })),
  fs: {
    writeFile: vi.fn(async () => undefined),
    createDirectory: vi.fn(async () => undefined),
    stat: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' }); }),
  },
};

const Uri = {
  file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })),
  joinPath: vi.fn((base: { fsPath: string }, ...parts: string[]) => {
    const joined = [base.fsPath, ...parts].join('/');
    return { fsPath: joined, toString: () => joined };
  }),
};

const ViewColumn = { One: 1, Two: 2, Three: 3, Beside: -2 } as const;

const StatusBarAlignment = { Left: 1, Right: 2 } as const;

const languages = {
  createDiagnosticCollection: vi.fn((_name?: string) => ({
    set: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
};

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

const debug = {
  registerDebugAdapterDescriptorFactory: vi.fn(() => ({ dispose: vi.fn() })),
  registerDebugAdapterTrackerFactory: vi.fn(() => ({ dispose: vi.fn() })),
  registerDebugConfigurationProvider: vi.fn(() => ({ dispose: vi.fn() })),
  onDidStartDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
  onDidTerminateDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
  startDebugging: vi.fn(() => Promise.resolve(true)),
};

class DebugAdapterExecutable {
  constructor(
    public readonly command: string,
    public readonly args: string[] = [],
    public readonly options?: Record<string, unknown>,
  ) {}
}

class DebugAdapterInlineImplementation {
  constructor(public readonly implementation: unknown) {}
}

class EventEmitter<T = unknown> {
  private _handlers: ((e: T) => unknown)[] = [];
  event = (listener: (e: T) => unknown): { dispose: () => void } => {
    this._handlers.push(listener);
    return { dispose: () => { this._handlers = this._handlers.filter(h => h !== listener); } };
  };
  fire(event: T): void {
    this._handlers.forEach(h => h(event));
  }
  dispose(): void {
    this._handlers = [];
  }
}

class Position {
  constructor(public line: number, public character: number) {}
}

class Range {
  constructor(
    public startLine: number | Position,
    public startCharacter: number | Position,
    public endLine?: number,
    public endCharacter?: number,
  ) {}
}

class WorkspaceEdit {
  replace = vi.fn();
  insert  = vi.fn();
  delete  = vi.fn();
}

class Diagnostic {
  source?: string;
  constructor(
    public range: Range,
    public message: string,
    public severity: number,
  ) {}
}

export {
  commands, window, workspace, Uri, ViewColumn,
  DiagnosticSeverity, Position, Range, WorkspaceEdit, Diagnostic,
  StatusBarAlignment, languages,
  debug, DebugAdapterExecutable, DebugAdapterInlineImplementation, EventEmitter,
};
