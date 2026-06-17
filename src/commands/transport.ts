import * as vscode from 'vscode';
import { EmulatorManager } from '../emulator/manager';

export function startAudio(manager: EmulatorManager): void {
  manager.sendTransport('start');
  void vscode.window.showInformationMessage('ds-ide: audio started');
}

export function stopAudio(manager: EmulatorManager): void {
  manager.sendTransport('stop');
  void vscode.window.showInformationMessage('ds-ide: audio stopped');
}
