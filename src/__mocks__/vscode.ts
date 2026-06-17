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
};

const workspace = {
  workspaceFolders: undefined as undefined | { uri: { fsPath: string } }[],
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
  })),
};

const Uri = {
  file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })),
  joinPath: vi.fn((base: { fsPath: string }, ...parts: string[]) => {
    const joined = [base.fsPath, ...parts].join('/');
    return { fsPath: joined, toString: () => joined };
  }),
};

const ViewColumn = { One: 1, Two: 2, Three: 3 } as const;

export { commands, window, workspace, Uri, ViewColumn };
