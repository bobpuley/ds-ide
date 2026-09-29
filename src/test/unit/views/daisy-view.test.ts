import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  buildDaisyRows, formatAudioDetail, DaisyViewProvider, DAISY_VIEW_ID, withViewProgress,
} from '../../../views/daisy-view';
import { INITIAL_TRANSPORT_STATE, type TransportState, type TransportPhase } from '../../../transport/transport-state';
import { TransportController } from '../../../transport/transport-controller';

const at = (over: Partial<TransportState>): TransportState => ({ ...INITIAL_TRANSPORT_STATE, ...over });
const row = (state: TransportState, id: string, detail?: string) => buildDaisyRows(state, detail).find((r) => r.id === id);

describe('buildDaisyRows() (FR-TRN-4)', () => {
  it('always has an Emulator and a Board row; no Source changed row when not stale', () => {
    expect(buildDaisyRows(INITIAL_TRANSPORT_STATE).map((r) => r.id)).toEqual(['emulator', 'board']);
  });

  it.each<[TransportPhase, string, string | undefined]>([
    ['stopped', 'debug-stop', undefined],
    ['building', 'loading~spin', undefined],
    ['deploying', 'loading~spin', undefined],
    ['running', 'play-circle', 'debugIcon.startForeground'],
    ['debugging', 'debug-alt', 'debugIcon.startForeground'],
    ['paused', 'debug-pause', 'debugIcon.pauseForeground'],
    ['buildFailed', 'error', 'problemsErrorIcon.foreground'],
    ['crashed', 'warning', 'problemsWarningIcon.foreground'],
  ])('Emulator row for %s uses the themed icon %s', (phase, icon, color) => {
    const r = row(at({ phase }), 'emulator')!;
    expect(r.icon).toEqual({ id: icon, color });
  });

  it('shows the state as the description, with the audio detail while live', () => {
    expect(row(at({ phase: 'stopped' }), 'emulator', '48 kHz · block 48')!.description).toBe('stopped');
    expect(row(at({ phase: 'running' }), 'emulator', '48 kHz · block 48')!.description).toBe('running · 48 kHz · block 48');
    expect(row(at({ phase: 'paused' }), 'emulator', '48 kHz · block 48')!.description).toBe('paused · 48 kHz · block 48');
  });

  it('shows the problem count after a failed build and opens Problems on click', () => {
    const r = row(at({ phase: 'buildFailed', problems: 3 }), 'emulator')!;
    expect(r.description).toBe('build failed · 3 problems');
    expect(r.command?.command).toBe('workbench.actions.view.problems');
    expect(row(at({ phase: 'buildFailed', problems: 1 }), 'emulator')!.description).toBe('build failed · 1 problem');
  });

  it('opens the Emulator output on click after a crash', () => {
    expect(row(at({ phase: 'crashed' }), 'emulator')!.command?.command).toBe('ds-ide.showEmulatorOutput');
  });

  it('adds a Source changed row with a Restart to apply action while stale', () => {
    const rows = buildDaisyRows(at({ phase: 'running', stale: true }));
    expect(rows.map((r) => r.id)).toEqual(['emulator', 'stale', 'board']);
    const stale = rows[1]!;
    expect(stale.label).toBe('Source changed');
    expect(stale.description).toBe('restart to apply');
    expect(stale.contextValue).toBe('daisy.stale');
    expect(stale.command?.command).toBe('ds-ide.restartEffect');
  });

  it('Board row: not checked / none detected / the detected board', () => {
    expect(row(INITIAL_TRANSPORT_STATE, 'board')!.description).toBe('not checked');
    expect(row(at({ board: null }), 'board')!.description).toBe('none detected');
    expect(row(at({ board: { name: 'Daisy Seed', usbId: '0483:df11' } }), 'board')!.description)
      .toBe('Daisy Seed · DFU 0483:df11');
  });
});

describe('formatAudioDetail()', () => {
  it('formats sample rate in kHz and the block size', () => {
    expect(formatAudioDetail(48000, 48)).toBe('48 kHz · block 48');
    expect(formatAudioDetail(44100, 256)).toBe('44.1 kHz · block 256');
  });
});

describe('DaisyViewProvider', () => {
  it('renders rows as TreeItems with ThemeIcon + ThemeColor only', () => {
    const provider = new DaisyViewProvider(new TransportController(), () => undefined);
    const rows = provider.getChildren();
    const running = { ...rows[0]!, icon: { id: 'play-circle', color: 'debugIcon.startForeground' } };
    const item = provider.getTreeItem(running);
    expect(item).toBeInstanceOf(vscode.TreeItem);
    expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    expect((item.iconPath as vscode.ThemeIcon).color).toBeInstanceOf(vscode.ThemeColor);
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('has no children below a row', () => {
    const provider = new DaisyViewProvider(new TransportController(), () => undefined);
    expect(provider.getChildren(provider.getChildren()[0])).toEqual([]);
  });

  it('refreshes the tree whenever the transport state changes', () => {
    const controller = new TransportController();
    const provider = new DaisyViewProvider(controller, () => undefined);
    const changed = vi.fn();
    provider.onDidChangeTreeData(changed);
    controller.dispatch({ type: 'buildStarted', mode: 'run' });
    expect(changed).toHaveBeenCalled();
    expect(provider.getChildren()[0]!.description).toBe('building');
  });
});

describe('withViewProgress()', () => {
  it('reports progress on the Daisy view', async () => {
    const result = await withViewProgress(async () => 7);
    expect(result).toBe(7);
    expect(vscode.window.withProgress).toHaveBeenCalledWith({ location: { viewId: DAISY_VIEW_ID } }, expect.any(Function));
  });
});
