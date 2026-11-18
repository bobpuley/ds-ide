import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { HostMidiBridge } from '../../../midi/host-bridge';
import type { MidiInputFactory } from '../../../midi/host-bridge';
import { MidiPanel } from '../../../webview/midi-panel';
import type { EmulatorManager } from '../../../emulator/manager';

// FR-PRE-5: a VS Code update that changes Electron's ABI leaves the native
// `midi` addon unloadable. Only the hardware-controller bridge may be lost;
// the on-screen keyboard talks to the emulator directly and must keep working.
describe('MIDI native addon unable to load (FR-PRE-5)', () => {
  it('the on-screen keyboard still sends notes to the emulator', () => {
    const failing: MidiInputFactory = () => {
      throw new Error("The module 'midi.node' was compiled against a different Node.js version (NODE_MODULE_VERSION 148)");
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manager = Object.assign(new EventEmitter(), { sendMidiEvent: vi.fn() });

    // Activation constructs and starts the bridge; that must not throw.
    const bridge = new HostMidiBridge(manager, failing, 'darwin');
    expect(() => bridge.start()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MIDI host bridge unavailable'), expect.anything());
    expect(() => bridge.stop()).not.toThrow();

    // The panel does not touch the bridge.
    const panel = new MidiPanel(vscode.Uri.file('/ext'), manager as unknown as EmulatorManager);
    panel.show();
    const created = vi.mocked(vscode.window.createWebviewPanel).mock.results.at(-1)!.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const onMessage = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (m: unknown) => void;
    onMessage({ command: 'noteOn', note: 60, velocity: 100 });
    expect(manager.sendMidiEvent).toHaveBeenCalledWith(0x90, 60, 100);
    warn.mockRestore();
  });
});
