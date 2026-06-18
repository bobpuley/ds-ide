import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { ScopePanel, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS } from '../../../webview/scope-panel';
import { EmulatorManager } from '../../../emulator/manager';
import type { ControllerDef } from '../../../controllers/controller-config';

function makeManager() {
  const em = new EventEmitter();
  return Object.assign(em, {
    sendPot: vi.fn(),
    sendPotSnapshot: vi.fn(),
    sendTransport: vi.fn(),
    sendSine: vi.fn(),
    sendAudioMode: vi.fn(),
    sendAudioDevice: vi.fn(),
    sendButton: vi.fn(),
    sendButtonSnapshot: vi.fn(),
  }) as unknown as EmulatorManager;
}

const DEFS: ControllerDef[] = [
  { id: 'pitch', label: 'Pitch', adcChannel: 0, range: [0, 1], taper: 'linear', default: 0.5 },
  { id: 'volume', label: 'Volume', adcChannel: 1, range: [0, 1], taper: 'linear', default: 0.8 },
];

const BUTTONS = [
  { id: 'bypass', label: 'Bypass', gpioPin: 28, mode: 'toggle' as const, activeLevel: 'low' as const },
  { id: 'tap', label: 'Tap', gpioPin: 25, mode: 'momentary' as const, activeLevel: 'low' as const },
];
const LEDS = [{ id: 'status', label: 'Status', gpioPin: 23 }];

describe('ScopePanel', () => {
  let manager: EmulatorManager;
  let potChangeSpy: ReturnType<typeof vi.fn>;
  let sineChangeSpy: ReturnType<typeof vi.fn>;
  let audioSourceChangeSpy: ReturnType<typeof vi.fn>;
  let pickWavSpy: ReturnType<typeof vi.fn>;
  let buttonChangeSpy: ReturnType<typeof vi.fn>;
  let panel: ScopePanel;
  let webviewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = makeManager();
    potChangeSpy = vi.fn();
    sineChangeSpy = vi.fn();
    audioSourceChangeSpy = vi.fn();
    pickWavSpy = vi.fn();
    buttonChangeSpy = vi.fn();
    panel = new ScopePanel(manager, potChangeSpy, sineChangeSpy, audioSourceChangeSpy, pickWavSpy, buttonChangeSpy);
    webviewMock = vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>;
  });

  it('show() creates a webview panel', () => {
    panel.show();
    expect(webviewMock).toHaveBeenCalledWith(
      'daisy-scope',
      'Daisy Scope',
      vscode.ViewColumn.Two,
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it('show() sets webview HTML', () => {
    panel.show(DEFS, { 0: 0.5 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('Daisy Scope');
  });

  it('show() embeds pot slider HTML for each def', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('data-channel="0"');
    expect(created.webview.html).toContain('data-channel="1"');
    expect(created.webview.html).toContain('Pitch');
    expect(created.webview.html).toContain('Volume');
  });

  it('show() uses initialValues to set slider values', () => {
    panel.show(DEFS, { 0: 0.25, 1: 0.75 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('value="0.25"');
    expect(created.webview.html).toContain('value="0.75"');
  });

  it('show() falls back to def.default when no initial value provided', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    // DEFS[0].default = 0.5, DEFS[1].default = 0.8
    expect(created.webview.html).toContain('value="0.5"');
    expect(created.webview.html).toContain('value="0.8"');
  });

  it('show() does not render controller HTML when defs is empty', () => {
    panel.show([], {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('id="controllers"');
  });

  it('registers onDidReceiveMessage on the webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    expect(created.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('forwards pot message from webview to manager.sendPot()', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    // Extract the handler registered with onDidReceiveMessage
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'pot', channel: 0, value: 0.7 });
    expect(manager.sendPot).toHaveBeenCalledWith(0, 0.7);
  });

  it('calls onPotChange callback when pot message received', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'pot', channel: 1, value: 0.4 });
    expect(potChangeSpy).toHaveBeenCalledWith(1, 0.4);
  });

  it('ignores non-pot messages from webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (
      msg: unknown,
    ) => void;
    handler({ command: 'unknown' });
    expect(manager.sendPot).not.toHaveBeenCalled();
    expect(potChangeSpy).not.toHaveBeenCalled();
  });

  it('forwards scope messages from manager to webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'scope',
      in: [0.1, 0.2],
      out: [0.3, 0.4],
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'scope' }),
    );
  });

  it('dispose() cleans up the panel', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    panel.dispose();
    expect(created.dispose).toHaveBeenCalled();
  });

  it('reveal() is called when show() is called on an already-open panel', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { reveal: ReturnType<typeof vi.fn> };
    panel.show(DEFS, {});
    // Only one panel should be created
    expect(webviewMock).toHaveBeenCalledTimes(1);
    expect(created.reveal).toHaveBeenCalled();
  });

  it('includes fidelity caveat notice in webview HTML (T4.5)', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('fidelity-caveat');
    expect(created.webview.html).toContain('Approx. Seed');
  });

  it('webview HTML uses sticky event accumulation (T4.3)', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('activeEvents');
  });

  // T6.1 — Sine controls
  it('webview HTML contains sine frequency and amplitude controls', () => {
    panel.show(DEFS, {}, { freq: 440, amplitude: 0.5 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('id="sine-freq"');
    expect(created.webview.html).toContain('id="sine-amp"');
    expect(created.webview.html).toContain('value="440"');
  });

  it('webview HTML embeds initial sine amplitude', () => {
    panel.show(DEFS, {}, { freq: 880, amplitude: 0.75 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('value="880"');
    expect(created.webview.html).toContain('value="0.75"');
  });

  it('uses SINE_DEFAULTS when no sineParams provided', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain(`value="${SINE_DEFAULTS.freq}"`);
  });

  it('forwards sine message from webview to manager.sendSine()', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sine', freq: 880, amplitude: 0.3 });
    expect(manager.sendSine).toHaveBeenCalledWith(880, 0.3);
  });

  it('calls onSineChange callback when sine message received', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sine', freq: 220, amplitude: 0.8 });
    expect(sineChangeSpy).toHaveBeenCalledWith(220, 0.8);
  });

  // T6.2 — xrun display (v2: shown as 0 in audio-source bar, updated dynamically)
  it('webview HTML includes xrun display element', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('xrun-display');
    expect(created.webview.html).toContain('xruns: 0');
  });

  // T6.3 — getting-started state
  it('webview HTML shows getting-started instructions before first status', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('getting-started');
    expect(created.webview.html).toContain('Build for Emulator');
  });

  // T8.6 / T8.7 — audio source selector
  it('webview HTML includes audio source selector with sine/live/wav options', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('audio-source-bar');
    expect(webview.html).toContain('value="sine"');
    expect(webview.html).toContain('value="live"');
    expect(webview.html).toContain('value="wav"');
  });

  it('webview HTML defaults to sine input source', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS);
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="sine" checked');
  });

  it('webview HTML shows live input as checked when audioSource.input is live', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, { input: 'live', sampleRate: 48000, bufferSize: 256 });
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="live" checked');
  });

  it('webview HTML includes buffer size selector with 256 selected by default', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="buffer-size"');
    expect(webview.html).toContain('<option value="256" selected>256</option>');
  });

  it('webview HTML includes latency display element', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="latency-display"');
    expect(webview.html).toContain('latency: —');
  });

  it('calls onAudioSourceChange when audioSource message received from webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live', sampleRate: 48000, bufferSize: 128 });
    expect(audioSourceChangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'live', sampleRate: 48000, bufferSize: 128 }),
    );
  });

  it('ignores audioSource message with missing fields', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live' }); // missing sampleRate and bufferSize
    expect(audioSourceChangeSpy).not.toHaveBeenCalled();
  });

  // T8.7 — xrun and latency message forwarding
  it('forwards xrun message from manager to webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'xrun', count: 3 });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'xrun', count: 3 }),
    );
  });

  it('forwards latency message from manager to webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'latency', measuredMs: 10.5 });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'latency', measuredMs: 10.5 }),
    );
  });

  // T9.4 — WAV file input UI
  it('webview HTML enables the WAV radio (no longer disabled)', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="wav"');
    expect(webview.html).not.toContain('value="wav" checked disabled');
    expect(webview.html).not.toContain('(M9)');
  });

  it('webview HTML includes WAV file controls (choose button + loop toggle)', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="wav-choose"');
    expect(webview.html).toContain('id="wav-loop"');
    expect(webview.html).toContain('id="wav-name"');
  });

  it('webview HTML reflects the chosen WAV file name and loop state', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, {
      input: 'wav', sampleRate: 48000, bufferSize: 256, wavLoop: true, wavPath: '/tmp/audio/drums.wav',
    });
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="wav" checked');
    expect(webview.html).toContain('drums.wav');
    expect(webview.html).toContain('id="wav-loop" checked');
  });

  it('forwards pickWav command from webview to onPickWav', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'pickWav' });
    expect(pickWavSpy).toHaveBeenCalledOnce();
  });

  it('includes wavLoop in the audioSource change payload', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'wav', sampleRate: 48000, bufferSize: 256, wavLoop: false });
    expect(audioSourceChangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'wav', wavLoop: false }),
    );
  });

  it('notifyWavSelected posts the chosen file name to the webview', () => {
    panel.show(DEFS, {});
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    panel.notifyWavSelected('drums.wav', '/tmp/audio/drums.wav');
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wavSelected', name: 'drums.wav' }),
    );
  });

  // T10.4 — button rendering + forwarding
  it('renders a button element per declared button', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS);
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="buttons"');
    expect(webview.html).toContain('data-pin="28"');
    expect(webview.html).toContain('data-mode="toggle"');
    expect(webview.html).toContain('data-pin="25"');
    expect(webview.html).toContain('data-mode="momentary"');
    expect(webview.html).toContain('Bypass');
    expect(webview.html).toContain('Tap');
  });

  it('does not render the buttons section when there are no buttons', () => {
    panel.show(DEFS, {});
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).not.toContain('id="buttons"');
  });

  it('reflects initial button state as pressed', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS, { 28: true });
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    // the pin-28 (bypass) button carries the on class + aria-pressed
    expect(webview.html).toMatch(/data-pin="28"[\s\S]*?aria-pressed="true"/);
  });

  it('forwards a button press to manager.sendButton and onButtonChange', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS);
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'button', gpioPin: 28, pressed: true });
    expect(manager.sendButton).toHaveBeenCalledWith(28, true);
    expect(buttonChangeSpy).toHaveBeenCalledWith(28, true);
  });

  it('ignores malformed button messages', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS);
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'button', gpioPin: 28 }); // missing pressed
    expect(manager.sendButton).not.toHaveBeenCalled();
  });

  // T10.5 — LED rendering + forwarding
  it('renders an LED indicator per declared LED', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS);
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="leds"');
    expect(webview.html).toContain('vled-dot');
    expect(webview.html).toContain('Status');
  });

  it('forwards a led message from manager to the webview', () => {
    panel.show(DEFS, {}, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS, BUTTONS, LEDS);
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'led', gpioPin: 23, lit: true });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });
});
