import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { renderStateItem, renderFlashItem, TransportStatusItems } from '../../../transport/status-items';
import { TransportController } from '../../../transport/transport-controller';
import { INITIAL_TRANSPORT_STATE, type TransportState } from '../../../transport/transport-state';

const at = (over: Partial<TransportState>): TransportState => ({ ...INITIAL_TRANSPORT_STATE, ...over });
const CAVEAT = 'fidelity caveat';

describe('renderStateItem() (FR-TRN-5)', () => {
  it.each([
    ['stopped', '$(debug-stop) Daisy: stopped'],
    ['building', '$(loading~spin) Daisy: building'],
    ['deploying', '$(loading~spin) Daisy: deploying'],
    ['running', '$(play) Daisy: running'],
    ['debugging', '$(bug) Daisy: debugging'],
    ['paused', '$(debug-pause) Daisy: paused'],
    ['buildFailed', '$(error) Daisy: build failed'],
    ['crashed', '$(warning) Daisy: crashed'],
  ] as const)('%s reads "%s"', (phase, text) => {
    expect(renderStateItem(at({ phase }), CAVEAT).text).toBe(text);
  });

  it('build failed: error background, click opens Problems', () => {
    const r = renderStateItem(at({ phase: 'buildFailed', problems: 2 }), CAVEAT);
    expect(r.backgroundColor).toBe('statusBarItem.errorBackground');
    expect(r.command).toBe('workbench.actions.view.problems');
  });

  it('crashed: warning background, click opens the Emulator output', () => {
    const r = renderStateItem(at({ phase: 'crashed' }), CAVEAT);
    expect(r.backgroundColor).toBe('statusBarItem.warningBackground');
    expect(r.command).toBe('ds-ide.showEmulatorOutput');
  });

  it('otherwise: no background, click reveals the Daisy view', () => {
    for (const phase of ['stopped', 'building', 'running', 'debugging', 'paused'] as const) {
      const r = renderStateItem(at({ phase }), CAVEAT);
      expect(r.backgroundColor).toBeUndefined();
      expect(r.command).toBe('ds-ide.revealDaisyView');
    }
  });

  it('says restart to apply while the source is stale', () => {
    expect(renderStateItem(at({ phase: 'running', stale: true }), CAVEAT).text).toBe('$(play) Daisy: running · restart to apply');
  });

  it('keeps the fidelity-caveat tooltip', () => {
    expect(renderStateItem(INITIAL_TRANSPORT_STATE, CAVEAT).tooltip).toBe(CAVEAT);
  });
});

describe('renderFlashItem() (FR-TRN-5)', () => {
  it('reads Flash and runs Build & Flash', () => {
    const r = renderFlashItem(INITIAL_TRANSPORT_STATE);
    expect(r.text).toBe('$(zap) Flash');
    expect(r.command).toBe('ds-ide.buildAndFlash');
  });

  it('shows no board when detection found none', () => {
    expect(renderFlashItem(at({ board: null })).text).toBe('$(zap) Flash: no board');
  });

  it('names the board in the tooltip when detected', () => {
    expect(renderFlashItem(at({ board: { name: 'Daisy Seed', usbId: '0483:df11' } })).tooltip).toContain('Daisy Seed');
  });
});

describe('TransportStatusItems', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function items() {
    const results = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value);
    const calls = (vscode.window.createStatusBarItem as ReturnType<typeof vi.fn>).mock.calls;
    return { state: results[0], flash: results[1], calls };
  }

  it('creates two items, each with its own id and name so users can hide them individually', () => {
    new TransportStatusItems(new TransportController(), CAVEAT);
    const { state, flash, calls } = items();
    expect(calls[0]![0]).toBe('ds-ide.transportState');
    expect(calls[1]![0]).toBe('ds-ide.flash');
    expect(state.name).toBe('Daisy State');
    expect(flash.name).toBe('Daisy Flash');
  });

  it('assigns the state item a command (it never had one) and re-renders on every change', () => {
    const controller = new TransportController();
    new TransportStatusItems(controller, CAVEAT);
    const { state } = items();
    expect(state.command).toBe('ds-ide.revealDaisyView');
    controller.dispatch({ type: 'buildStarted', mode: 'run' });
    controller.dispatch({ type: 'deployFailed', problems: 1 });
    expect(state.text).toBe('$(error) Daisy: build failed');
    expect(state.command).toBe('workbench.actions.view.problems');
    expect(state.backgroundColor).toBeInstanceOf(vscode.ThemeColor);
    expect(state.backgroundColor.id).toBe('statusBarItem.errorBackground');
  });

  it('is hidden until the workspace is known to be a Daisy project, and hidden again outside one', () => {
    const s = new TransportStatusItems(new TransportController(), CAVEAT);
    const { state, flash } = items();
    expect(state.show).not.toHaveBeenCalled();
    s.setVisible(true);
    expect(state.show).toHaveBeenCalled();
    expect(flash.show).toHaveBeenCalled();
    s.setVisible(false);
    expect(state.hide).toHaveBeenCalled();
    expect(flash.hide).toHaveBeenCalled();
  });

  it('dispose disposes both items', () => {
    const s = new TransportStatusItems(new TransportController(), CAVEAT);
    const { state, flash } = items();
    s.dispose();
    expect(state.dispose).toHaveBeenCalled();
    expect(flash.dispose).toHaveBeenCalled();
  });
});
