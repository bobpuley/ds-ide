import * as vscode from 'vscode';
import { phaseLabel, type TransportPhase, type TransportState } from '../transport/transport-state';
import type { TransportController } from '../transport/transport-controller';

export const DAISY_VIEW_ID = 'ds-ide.daisyView';

// FR-TRN-4: build / deploy / hardware work also shows native progress on the
// Daisy view, alongside the cancellable notification the task itself opens.
export function withViewProgress<T>(task: () => Thenable<T>): Thenable<T> {
  return vscode.window.withProgress({ location: { viewId: DAISY_VIEW_ID } }, task);
}

export type DaisyRowId = 'emulator' | 'stale' | 'board';

export interface DaisyRow {
  id: DaisyRowId;
  label: string;
  description: string;
  /** Codicon id + optional theme colour id — never a hardcoded colour. */
  icon: { id: string; color: string | undefined };
  tooltip?: string;
  command?: { command: string; title: string };
  contextValue?: string;
}

const PHASE_ICONS: Record<TransportPhase, { id: string; color: string | undefined }> = {
  stopped: { id: 'debug-stop', color: undefined },
  building: { id: 'loading~spin', color: undefined },
  deploying: { id: 'loading~spin', color: undefined },
  running: { id: 'play-circle', color: 'debugIcon.startForeground' },
  debugging: { id: 'debug-alt', color: 'debugIcon.startForeground' },
  paused: { id: 'debug-pause', color: 'debugIcon.pauseForeground' },
  buildFailed: { id: 'error', color: 'problemsErrorIcon.foreground' },
  crashed: { id: 'warning', color: 'problemsWarningIcon.foreground' },
};

const LIVE: ReadonlySet<TransportPhase> = new Set(['running', 'debugging', 'paused']);

export function formatAudioDetail(sampleRate: number, bufferSize: number): string {
  return `${sampleRate / 1000} kHz · block ${bufferSize}`;
}

function emulatorDescription(state: TransportState, detail: string | undefined): string {
  const label = phaseLabel(state.phase);
  if (state.phase === 'buildFailed' && state.problems !== undefined) {
    return `${label} · ${state.problems} problem${state.problems === 1 ? '' : 's'}`;
  }
  if (LIVE.has(state.phase) && detail) return `${label} · ${detail}`;
  return label;
}

function emulatorCommand(phase: TransportPhase): DaisyRow['command'] {
  if (phase === 'buildFailed') return { command: 'workbench.actions.view.problems', title: 'Show Problems' };
  if (phase === 'crashed') return { command: 'ds-ide.showEmulatorOutput', title: 'Show Emulator Output' };
  return undefined;
}

function boardDescription(board: TransportState['board']): string {
  if (board === undefined) return 'not checked';
  if (board === null) return 'none detected';
  return `${board.name} · DFU ${board.usbId}`;
}

// Pure: the rows the Daisy view shows for a state. `detail` is the audio
// settings line (e.g. "48 kHz · block 48") appended while the emulator is live.
export function buildDaisyRows(state: TransportState, detail?: string): DaisyRow[] {
  const rows: DaisyRow[] = [{
    id: 'emulator',
    label: 'Emulator',
    description: emulatorDescription(state, detail),
    icon: PHASE_ICONS[state.phase],
    command: emulatorCommand(state.phase),
    contextValue: `daisy.emulator.${state.phase}`,
  }];
  if (state.stale) {
    rows.push({
      id: 'stale',
      label: 'Source changed',
      description: 'restart to apply',
      tooltip: 'A saved edit is newer than the running build.',
      icon: { id: 'history', color: 'problemsWarningIcon.foreground' },
      command: { command: 'ds-ide.restartEffect', title: 'Restart to apply' },
      contextValue: 'daisy.stale',
    });
  }
  rows.push({
    id: 'board',
    label: 'Board',
    description: boardDescription(state.board),
    icon: { id: 'circuit-board', color: undefined },
    contextValue: 'daisy.board',
  });
  return rows;
}

// FR-TRN-4: native TreeView in the Run and Debug container — follows the
// active theme because it uses only ThemeIcon / ThemeColor, no webview.
export class DaisyViewProvider implements vscode.TreeDataProvider<DaisyRow>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;
  private readonly _sub: vscode.Disposable;

  constructor(
    private readonly controller: TransportController,
    private readonly getAudioDetail: () => string | undefined,
  ) {
    this._sub = controller.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // FR-RCH-2: outside a Daisy project the view has no rows, which is what
  // makes VS Code show its viewsWelcome content.
  private isDaisyProject = false;

  setDaisyProject(isDaisyProject: boolean): void {
    if (this.isDaisyProject === isDaisyProject) return;
    this.isDaisyProject = isDaisyProject;
    this.refresh();
  }

  getChildren(element?: DaisyRow): DaisyRow[] {
    if (element || !this.isDaisyProject) return [];
    return buildDaisyRows(this.controller.state, this.getAudioDetail());
  }

  getTreeItem(row: DaisyRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.id = row.id;
    item.description = row.description;
    item.tooltip = row.tooltip;
    item.iconPath = new vscode.ThemeIcon(row.icon.id, row.icon.color ? new vscode.ThemeColor(row.icon.color) : undefined);
    item.command = row.command;
    item.contextValue = row.contextValue;
    return item;
  }

  dispose(): void {
    this._sub.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
