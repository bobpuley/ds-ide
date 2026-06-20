import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEffectProject } from '../../../commands/create-effect-project';
import * as vscode from 'vscode';

// vscode is resolved via the alias in vitest.config.ts to src/__mocks__/vscode.ts.
// All exports there are vi.fn() — no vi.mock('vscode') call needed.

const showInputBox   = vscode.window.showInputBox as ReturnType<typeof vi.fn>;
const showOpenDialog = vscode.window.showOpenDialog as ReturnType<typeof vi.fn>;
const showErrorMsg   = vscode.window.showErrorMessage as ReturnType<typeof vi.fn>;
const execCmd        = vscode.commands.executeCommand as ReturnType<typeof vi.fn>;
const fsWriteFile    = vscode.workspace.fs.writeFile as ReturnType<typeof vi.fn>;
const fsCreateDir    = vscode.workspace.fs.createDirectory as ReturnType<typeof vi.fn>;
const fsStat         = vscode.workspace.fs.stat as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default joinPath behaviour (clearAllMocks doesn't touch implementations,
  // but some tests call mockReturnValue which queues a one-shot value — reset those).
  (vscode.Uri.joinPath as ReturnType<typeof vi.fn>).mockReset();
  (vscode.Uri.joinPath as ReturnType<typeof vi.fn>).mockImplementation(
    (base: { fsPath: string }, ...parts: string[]) => {
      const joined = [base.fsPath, ...parts].join('/');
      return { fsPath: joined, toString: () => joined };
    },
  );
  // Default fs behaviour: stat throws (folder absent), write/createDir succeed.
  fsStat.mockReset();
  fsStat.mockRejectedValue(Object.assign(new Error('FileNotFound'), { code: 'FileNotFound' }));
  fsWriteFile.mockReset();
  fsWriteFile.mockResolvedValue(undefined);
  fsCreateDir.mockReset();
  fsCreateDir.mockResolvedValue(undefined);
  execCmd.mockReset();
  execCmd.mockResolvedValue(undefined);
});

const DEST_URI = { fsPath: '/dest', toString: () => '/dest' };

function setupHappyPath() {
  showInputBox.mockResolvedValue('myEffect');
  showOpenDialog.mockResolvedValue([DEST_URI]);
}

describe('createEffectProject', () => {
  it('scaffolds four files and opens folder on happy path', async () => {
    setupHappyPath();
    await createEffectProject();

    expect(fsCreateDir).toHaveBeenCalledTimes(1);
    expect(fsWriteFile).toHaveBeenCalledTimes(4);

    const paths = (fsWriteFile.mock.calls as [{ fsPath: string }, unknown][]).map(c => c[0].fsPath);
    expect(paths.some(p => p.endsWith('.cpp'))).toBe(true);
    expect(paths.some(p => p.endsWith('CMakeLists.txt'))).toBe(true);
    expect(paths.some(p => p.endsWith('controllers.yaml'))).toBe(true);
    expect(paths.some(p => p.endsWith('README.md'))).toBe(true);

    expect(execCmd).toHaveBeenCalledWith(
      'vscode.openFolder',
      expect.anything(),
      { forceNewWindow: false },
    );
  });

  it('cpp file contains controls block and AudioCallback', async () => {
    setupHappyPath();
    await createEffectProject();

    const calls = fsWriteFile.mock.calls as [{ fsPath: string }, Uint8Array][];
    const cppCall = calls.find(c => c[0].fsPath.endsWith('.cpp'));
    expect(cppCall).toBeDefined();
    const content = Buffer.from(cppCall![1]).toString('utf8');
    expect(content).toContain('// ds-ide:controls:begin');
    expect(content).toContain('// ds-ide:controls:end');
    expect(content).toContain('AudioCallback');
  });

  it('cmake file contains project name', async () => {
    setupHappyPath();
    await createEffectProject();

    const calls = fsWriteFile.mock.calls as [{ fsPath: string }, Uint8Array][];
    const cmakeCall = calls.find(c => c[0].fsPath.endsWith('CMakeLists.txt'));
    expect(cmakeCall).toBeDefined();
    const content = Buffer.from(cmakeCall![1]).toString('utf8');
    expect(content).toContain('project(myEffect)');
  });

  it('controllers.yaml contains empty controls list', async () => {
    setupHappyPath();
    await createEffectProject();

    const calls = fsWriteFile.mock.calls as [{ fsPath: string }, Uint8Array][];
    const yamlCall = calls.find(c => c[0].fsPath.endsWith('controllers.yaml'));
    expect(yamlCall).toBeDefined();
    const content = Buffer.from(yamlCall![1]).toString('utf8');
    expect(content).toContain('controls: []');
  });

  it('aborts silently when user cancels name input', async () => {
    showInputBox.mockResolvedValue(undefined);
    await createEffectProject();
    expect(fsWriteFile).not.toHaveBeenCalled();
    expect(execCmd).not.toHaveBeenCalled();
  });

  it('aborts silently when user cancels folder picker', async () => {
    showInputBox.mockResolvedValue('myEffect');
    showOpenDialog.mockResolvedValue(undefined);
    await createEffectProject();
    expect(fsWriteFile).not.toHaveBeenCalled();
  });

  it('shows error when target folder already exists', async () => {
    showInputBox.mockResolvedValue('myEffect');
    showOpenDialog.mockResolvedValue([DEST_URI]);
    fsStat.mockResolvedValue({ type: 2 });

    await createEffectProject();

    expect(showErrorMsg).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    expect(fsWriteFile).not.toHaveBeenCalled();
  });

  it('shows error when file write fails', async () => {
    showInputBox.mockResolvedValue('myEffect');
    showOpenDialog.mockResolvedValue([DEST_URI]);
    fsWriteFile.mockRejectedValue(new Error('disk full'));

    await createEffectProject();

    expect(showErrorMsg).toHaveBeenCalledWith(expect.stringContaining('failed to scaffold'));
    expect(execCmd).not.toHaveBeenCalled();
  });

  describe('validateInput (inspected via showInputBox call options)', () => {
    async function getValidate(): Promise<(v: string) => string | undefined> {
      showInputBox.mockResolvedValue(undefined);
      await createEffectProject();
      const opts = showInputBox.mock.calls[0][0] as { validateInput: (v: string) => string | undefined };
      return opts.validateInput;
    }

    it('rejects empty string', async () => {
      expect(await getValidate()).toSatisfy((fn: (v: string) => unknown) => !!fn(''));
    });

    it('rejects name starting with digit', async () => {
      expect(await getValidate()).toSatisfy((fn: (v: string) => unknown) => !!fn('1bad'));
    });

    it('rejects name with spaces', async () => {
      expect(await getValidate()).toSatisfy((fn: (v: string) => unknown) => !!fn('my effect'));
    });

    it('accepts valid C++ identifier', async () => {
      expect(await getValidate()).toSatisfy((fn: (v: string) => unknown) => fn('my_Effect1') === undefined);
    });
  });
});
