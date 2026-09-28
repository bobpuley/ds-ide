// Minimal vscode API mock for unit tests.
import { vi } from 'vitest';
import * as path from 'path';

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
  showTextDocument: vi.fn(async () => ({ selection: undefined as unknown, revealRange: vi.fn() })),
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
  showQuickPick: vi.fn(),
  setStatusBarMessage: vi.fn(() => ({ dispose: vi.fn() })),
  activeTextEditor: undefined as undefined | { document: { uri: { fsPath: string } } },
  onDidChangeActiveTextEditor: vi.fn((_cb: (e: unknown) => void) => ({ dispose: vi.fn() })),
  withProgress: vi.fn((
    _options: unknown,
    task: (progress: { report: (v: unknown) => void }, token: CancellationToken) => unknown,
  ) => {
    const source = new CancellationTokenSource();
    return task({ report: vi.fn() }, source.token);
  }),
};

interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (cb: () => void) => { dispose: () => void };
}

class CancellationTokenSource {
  private listeners: Array<() => void> = [];
  readonly token: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: (cb: () => void) => {
      this.listeners.push(cb);
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== cb); } };
    },
  };

  cancel(): void {
    if (this.token.isCancellationRequested) return;
    this.token.isCancellationRequested = true;
    for (const cb of this.listeners) cb();
  }

  dispose(): void {
    this.listeners = [];
  }
}

const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 } as const;

type MockWorkspaceFolder = { uri: { fsPath: string }; name?: string };

function findContainingFolder(
  folders: MockWorkspaceFolder[] | undefined,
  uri: { fsPath: string },
): MockWorkspaceFolder | undefined {
  if (!folders) return undefined;
  return folders.find((f) => {
    const root = f.uri.fsPath;
    return uri.fsPath === root || uri.fsPath.startsWith(root + path.sep);
  });
}

const workspace = {
  workspaceFolders: undefined as undefined | MockWorkspaceFolder[],
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
    inspect: vi.fn(() => undefined),
    update: vi.fn(async () => undefined),
  })),
  openTextDocument: vi.fn(async () => ({
    getText: vi.fn(() => ''),
    lineCount: 1,
    lineAt: vi.fn((n: number) => ({ range: { end: new Position(n, 0) } })),
    save: vi.fn(async () => true),
  })),
  applyEdit: vi.fn(async () => true),
  onDidSaveTextDocument: vi.fn((_cb: (doc: { uri: { fsPath: string } }) => void) => ({ dispose: vi.fn() })),
  getWorkspaceFolder: vi.fn((uri: { fsPath: string }): MockWorkspaceFolder | undefined =>
    findContainingFolder(workspace.workspaceFolders, uri),
  ),
  fs: {
    writeFile: vi.fn(async () => undefined),
    createDirectory: vi.fn(async () => undefined),
    stat: vi.fn(async () => { throw Object.assign(new Error('ENOENT'), { code: 'FileNotFound' }); }),
    copy: vi.fn(async () => undefined),
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

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

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

class Selection extends Range {
  constructor(public anchorLine: number, public anchorCharacter: number, public activeLine: number, public activeCharacter: number) {
    super(anchorLine, anchorCharacter, activeLine, activeCharacter);
  }
}

const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 };

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
  DiagnosticSeverity, Position, Range, Selection, TextEditorRevealType, WorkspaceEdit, Diagnostic,
  StatusBarAlignment, ProgressLocation, languages, ConfigurationTarget,
  debug, DebugAdapterExecutable, DebugAdapterInlineImplementation, EventEmitter,
  CancellationTokenSource,
};
