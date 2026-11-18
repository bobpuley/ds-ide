import * as vscode from 'vscode';
import * as path from 'path';

// FR-AIG-6: keep the Controls and Wiring editors in step with the project's
// files when something other than the VS Code editor changes them. The
// onDidSaveTextDocument listener only fires for saves made inside VS Code, so
// a coding agent (or git, or a formatter run in a terminal) that rewrites the
// effect source or controllers.yaml on disk left both editors showing the old
// state until the user reloaded the window.

const SOURCE_DIRS = ['', 'src', 'source'];

/**
 * True for the files whose content the editors show: the project's
 * controllers.yaml and the .cpp files in the places the effect source is
 * searched for (root, src/, source/), or the configured effect source.
 * Vendored and generated code (DaisySP/, .ds-ide/) is deeper and never matches.
 */
export function isProjectFile(folder: string, file: string, effectSource?: string): boolean {
  const resolved = path.resolve(file);
  if (effectSource && resolved === path.resolve(effectSource)) return true;
  const root = path.resolve(folder);
  if (resolved === path.join(root, 'controllers.yaml')) return true;
  if (!resolved.endsWith('.cpp')) return false;
  const dir = path.dirname(resolved);
  return SOURCE_DIRS.some((d) => dir === path.join(root, d));
}

export interface ProjectWatcherDeps {
  getActiveFolder: () => string | undefined;
  /** Re-reads the project and updates the views (initViewsFromProject). */
  refresh: () => Promise<void>;
  getEffectSource?: () => string | undefined;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 300;

export function createProjectFileWatcher(deps: ProjectWatcherDeps): vscode.Disposable {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watcher = vscode.workspace.createFileSystemWatcher('**/{*.cpp,controllers.yaml}');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let disposed = false;

  const run = async (): Promise<void> => {
    timer = undefined;
    if (disposed) return;
    if (running) { again = true; return; }
    running = true;
    try {
      await deps.refresh();
    } catch (err) {
      console.error('ds-ide: refreshing the editors after a project file changed failed:', err);
    } finally {
      running = false;
    }
    if (again && !disposed) {
      again = false;
      schedule();
    }
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void run(); }, debounceMs);
  };

  const onEvent = (uri: vscode.Uri): void => {
    const folder = deps.getActiveFolder();
    if (!folder || disposed) return;
    if (!isProjectFile(folder, uri.fsPath, deps.getEffectSource?.())) return;
    schedule();
  };

  const subscriptions = [
    watcher.onDidChange(onEvent),
    watcher.onDidCreate(onEvent),
    watcher.onDidDelete(onEvent),
  ];

  return {
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      subscriptions.forEach((s) => s.dispose());
      watcher.dispose();
    },
  };
}
