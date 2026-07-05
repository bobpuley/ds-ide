import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { startAudio, stopAudio } from '../../../commands/transport';
import { EmulatorManager } from '../../../emulator/manager';

function makeManager(isConnected = true) {
  return {
    sendTransport: vi.fn(),
    isConnected,
  } as unknown as EmulatorManager;
}

describe('transport commands', () => {
  beforeEach(() => { vi.clearAllMocks(); });

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

  it('startAudio warns and does not send transport when no emulator is connected', () => {
    const mgr = makeManager(false);
    startAudio(mgr);
    expect(mgr.sendTransport).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no emulator running'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('stopAudio warns and does not send transport when no emulator is connected', () => {
    const mgr = makeManager(false);
    stopAudio(mgr);
    expect(mgr.sendTransport).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no emulator running'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
