import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { createProjectFileWatcher, isProjectFile } from '../../../workspace/project-watcher';

type Handler = (uri: { fsPath: string }) => void;

const createWatcher = vscode.workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>;

describe('isProjectFile (FR-AIG-6)', () => {
  const root = '/proj';

  it('accepts the controllers.yaml at the project root', () => {
    expect(isProjectFile(root, '/proj/controllers.yaml')).toBe(true);
  });

  it('accepts a .cpp in the root, src/ or source/ — where the effect source is searched for', () => {
    expect(isProjectFile(root, '/proj/effect.cpp')).toBe(true);
    expect(isProjectFile(root, '/proj/src/effect.cpp')).toBe(true);
    expect(isProjectFile(root, '/proj/source/effect.cpp')).toBe(true);
  });

  it('rejects vendored and generated code, other files and other folders', () => {
    expect(isProjectFile(root, '/proj/DaisySP/Source/osc.cpp')).toBe(false);
    expect(isProjectFile(root, '/proj/.ds-ide/build/x.cpp')).toBe(false);
    expect(isProjectFile(root, '/proj/src/deep/x.cpp')).toBe(false);
    expect(isProjectFile(root, '/proj/README.md')).toBe(false);
    expect(isProjectFile(root, '/proj/sub/controllers.yaml')).toBe(false);
    expect(isProjectFile(root, '/proj2/effect.cpp')).toBe(false);
  });

  it('accepts the configured effect source wherever it is', () => {
    expect(isProjectFile(root, '/proj/custom/dir/fx.cpp', '/proj/custom/dir/fx.cpp')).toBe(true);
  });
});

describe('createProjectFileWatcher (FR-AIG-6)', () => {
  let onChange: Handler, onCreate: Handler, onDelete: Handler;
  const watcherDispose = vi.fn();
  let folder: string | undefined;
  let refresh: ReturnType<typeof vi.fn<[], Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    folder = '/proj';
    refresh = vi.fn<[], Promise<void>>(async () => undefined);
    watcherDispose.mockClear();
    createWatcher.mockReset();
    createWatcher.mockImplementation(() => ({
      onDidChange: (cb: Handler) => { onChange = cb; return { dispose: vi.fn() }; },
      onDidCreate: (cb: Handler) => { onCreate = cb; return { dispose: vi.fn() }; },
      onDidDelete: (cb: Handler) => { onDelete = cb; return { dispose: vi.fn() }; },
      dispose: watcherDispose,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => createProjectFileWatcher({ getActiveFolder: () => folder, refresh, debounceMs: 100 });

  it('watches .cpp files and controllers.yaml', () => {
    make();
    expect(createWatcher).toHaveBeenCalledTimes(1);
    const glob = createWatcher.mock.calls[0]![0] as string;
    expect(glob).toContain('*.cpp');
    expect(glob).toContain('controllers.yaml');
  });

  it('refreshes the views after a change to the effect source made outside the editor', async () => {
    make();
    onChange({ fsPath: '/proj/effect.cpp' });
    expect(refresh).not.toHaveBeenCalled(); // debounced
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes after controllers.yaml is created, changed or deleted', async () => {
    make();
    onCreate({ fsPath: '/proj/controllers.yaml' });
    await vi.advanceTimersByTimeAsync(100);
    onChange({ fsPath: '/proj/controllers.yaml' });
    await vi.advanceTimersByTimeAsync(100);
    onDelete({ fsPath: '/proj/controllers.yaml' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('refreshes after the effect source is created, so a project that becomes a Daisy project is picked up', async () => {
    make();
    onCreate({ fsPath: '/proj/src/new_effect.cpp' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of events into one refresh', async () => {
    make();
    for (let i = 0; i < 5; i++) onChange({ fsPath: '/proj/effect.cpp' });
    onChange({ fsPath: '/proj/controllers.yaml' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores files that are not part of the active project', async () => {
    make();
    onChange({ fsPath: '/proj/DaisySP/Source/osc.cpp' });
    onChange({ fsPath: '/other/effect.cpp' });
    onChange({ fsPath: '/proj/notes.txt' });
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active folder', async () => {
    folder = undefined;
    make();
    onChange({ fsPath: '/proj/effect.cpp' });
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('runs one more refresh when a change arrives while a refresh is running', async () => {
    let release!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    make();
    onChange({ fsPath: '/proj/effect.cpp' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1);
    onChange({ fsPath: '/proj/effect.cpp' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(1); // still waiting for the first
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('survives a failing refresh and keeps watching', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refresh.mockRejectedValueOnce(new Error('boom'));
    make();
    onChange({ fsPath: '/proj/effect.cpp' });
    await vi.advanceTimersByTimeAsync(100);
    onChange({ fsPath: '/proj/effect.cpp' });
    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('dispose stops the watcher and cancels a pending refresh', async () => {
    const d = make();
    onChange({ fsPath: '/proj/effect.cpp' });
    d.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(watcherDispose).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
