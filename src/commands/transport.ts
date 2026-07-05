import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';

export function startAudio(manager: EmulatorManager): void {
  if (!manager.isConnected) {
    void vscode.window.showWarningMessage('ds-ide: no emulator running — deploy first');
    return;
  }
  manager.sendTransport('start');
  void vscode.window.showInformationMessage('ds-ide: audio started');
}

export function stopAudio(manager: EmulatorManager): void {
  if (!manager.isConnected) {
    void vscode.window.showWarningMessage('ds-ide: no emulator running — deploy first');
    return;
  }
  manager.sendTransport('stop');
  void vscode.window.showInformationMessage('ds-ide: audio stopped');
}
