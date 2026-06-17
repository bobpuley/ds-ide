import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { startAudio, stopAudio } from '../../../commands/transport';
import { EmulatorManager } from '../../../emulator/manager';

function makeManager() {
  return {
    sendTransport: vi.fn(),
  } as unknown as EmulatorManager;
}

describe('transport commands', () => {
  it('startAudio sends start transport', () => {
    const mgr = makeManager();
    startAudio(mgr);
    expect(mgr.sendTransport).toHaveBeenCalledWith('start');
  });

  it('stopAudio sends stop transport', () => {
    const mgr = makeManager();
    stopAudio(mgr);
    expect(mgr.sendTransport).toHaveBeenCalledWith('stop');
  });

  it('startAudio shows info message', () => {
    const mgr = makeManager();
    startAudio(mgr);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('started'),
    );
  });

  it('stopAudio shows info message', () => {
    const mgr = makeManager();
    stopAudio(mgr);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('stopped'),
    );
  });
});
