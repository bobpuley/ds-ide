// Minimal vscode API mock for unit tests.
// Only surface the parts exercised by the extension scaffold.
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
};

const workspace = {
  workspaceFolders: undefined as undefined | { uri: { fsPath: string } }[],
};

export { commands, window, workspace };
