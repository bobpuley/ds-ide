import * as vscode from 'vscode';
import { phaseLabel, type TransportPhase, type TransportState } from './transport-state';
import type { TransportController } from './transport-controller';

export interface StatusItemModel {
  text: string;
  tooltip: string;
  command: string;
  /** Theme colour id for the item background, or undefined for the default. */
  backgroundColor: string | undefined;
}

const STATE_ICONS: Record<TransportPhase, string> = {
  stopped: 'debug-stop',
  building: 'loading~spin',
  deploying: 'loading~spin',
  running: 'play',
  debugging: 'bug',
  paused: 'debug-pause',
  buildFailed: 'error',
  crashed: 'warning',
};

// FR-TRN-5: `Daisy: <state>`; a build failure / crash is coloured and
// clicking goes where the fix is (Problems / Emulator output); otherwise
// clicking reveals the Daisy view.
export function renderStateItem(state: TransportState, caveat: string): StatusItemModel {
  const stale = state.stale ? ' · restart to apply' : '';
  const model: StatusItemModel = {
    text: `$(${STATE_ICONS[state.phase]}) Daisy: ${phaseLabel(state.phase)}${stale}`,
    tooltip: caveat,
    command: 'ds-ide.revealDaisyView',
    backgroundColor: undefined,
  };
  if (state.phase === 'buildFailed') {
    model.backgroundColor = 'statusBarItem.errorBackground';
    model.command = 'workbench.actions.view.problems';
  } else if (state.phase === 'crashed') {
    model.backgroundColor = 'statusBarItem.warningBackground';
    model.command = 'ds-ide.showEmulatorOutput';
  }
  return model;
}

export function renderFlashItem(state: TransportState): StatusItemModel {
  const board = state.board;
  return {
    text: board === null ? '$(zap) Flash: no board' : '$(zap) Flash',
    tooltip: board ? `Build & Flash to ${board.name} (DFU ${board.usbId})` : 'Build & Flash to Daisy Seed',
    command: 'ds-ide.buildAndFlash',
    backgroundColor: undefined,
  };
}

function apply(item: vscode.StatusBarItem, model: StatusItemModel): void {
  item.text = model.text;
  item.tooltip = model.tooltip;
  item.command = model.command;
  item.backgroundColor = model.backgroundColor ? new vscode.ThemeColor(model.backgroundColor) : undefined;
}

// The only writer of the status bar: renders both items from the transport
// state. Each item has its own id / name so users can hide them one by one.
export class TransportStatusItems implements vscode.Disposable {
  private readonly stateItem: vscode.StatusBarItem;
  private readonly flashItem: vscode.StatusBarItem;
  private readonly sub: vscode.Disposable;

  constructor(private readonly controller: TransportController, private readonly caveat: string) {
    this.stateItem = vscode.window.createStatusBarItem('ds-ide.transportState', vscode.StatusBarAlignment.Right, 100);
    this.stateItem.name = 'Daisy State';
    this.flashItem = vscode.window.createStatusBarItem('ds-ide.flash', vscode.StatusBarAlignment.Right, 99);
    this.flashItem.name = 'Daisy Flash';
    this.render();
    this.sub = controller.onDidChange(() => this.render());
  }

  /** Both items are shown only in Daisy projects. */
  setVisible(isDaisyProject: boolean): void {
    for (const item of [this.stateItem, this.flashItem]) {
      if (isDaisyProject) item.show();
      else item.hide();
    }
  }

  private render(): void {
    apply(this.stateItem, renderStateItem(this.controller.state, this.caveat));
    apply(this.flashItem, renderFlashItem(this.controller.state));
  }

  dispose(): void {
    this.sub.dispose();
    this.stateItem.dispose();
    this.flashItem.dispose();
  }
}
