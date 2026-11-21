import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { ScopePanel, SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS } from '../../../webview/scope-panel';
import { themeCss } from '../../../webview/theme/theme-css';
import { EmulatorManager } from '../../../emulator/manager';

function makeManager() {
  const em = new EventEmitter();
  return Object.assign(em, {
    sendPotSnapshot: vi.fn(),
    sendTransport: vi.fn(),
    sendSine: vi.fn(),
    sendGenerator: vi.fn(),
    sendAudioMode: vi.fn(),
    sendAudioDevice: vi.fn(),
    sendButtonSnapshot: vi.fn(),
    sendOutputVolume: vi.fn(),
    sendScopeCapture: vi.fn(),
    isConnected: true,
  }) as unknown as EmulatorManager;
}

describe('ScopePanel', () => {
  let manager: EmulatorManager;
  let sineChangeSpy: ReturnType<typeof vi.fn>;
  let audioSourceChangeSpy: ReturnType<typeof vi.fn>;
  let pickWavSpy: ReturnType<typeof vi.fn>;
  let panel: ScopePanel;
  let webviewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = makeManager();
    sineChangeSpy = vi.fn();
    audioSourceChangeSpy = vi.fn();
    pickWavSpy = vi.fn();
    panel = new ScopePanel(
      { fsPath: '/ext' } as unknown as vscode.Uri,
      manager, sineChangeSpy as never, audioSourceChangeSpy as never, pickWavSpy as never,
    );
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

  it('show() sets localResourceRoots on the webview panel (FR-ES-1)', () => {
    panel.show();
    expect(webviewMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ localResourceRoots: [expect.anything()] }),
    );
  });

  it('webview HTML includes CSP meta tag with nonce (FR-ES-1)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(created.webview.html).toContain("nonce-");
  });

  it('webview HTML script tag has nonce attribute matching CSP (FR-ES-1)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const html = created.webview.html;
    const nonceMatch = html.match(/nonce-([^'";]+)/);
    expect(nonceMatch).toBeTruthy();
    const nonce = nonceMatch![1];
    expect(html).toContain(`<script nonce="${nonce}" src=`);
  });

  it('show() sets webview HTML', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('Daisy Scope');
  });

  it('registers onDidReceiveMessage on the webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    expect(created.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it('ignores unknown messages from webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    expect(() => handler({ command: 'unknown' })).not.toThrow();
  });

  it('forwards sine message from webview to manager.sendSine()', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sine', freq: 880, amplitude: 0.3 });
    expect(manager.sendSine).toHaveBeenCalledWith(880, 0.3);
  });

  it('calls onSineChange callback when sine message received', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'sine', freq: 220, amplitude: 0.8 });
    expect(sineChangeSpy).toHaveBeenCalledWith(220, 0.8);
  });

  it('forwards scope messages from manager to webview', () => {
    panel.show();
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

  it('forwards out_r and step on scope messages to the webview (FR-SCI-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'scope', in: [0.1], out: [0.3], out_r: [0.5], step: 4,
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      { command: 'scope', in: [0.1], out: [0.3], out_r: [0.5], step: 4 },
    );
  });

  it('forwards status messages from manager to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'status', running: true, sampleRate: 48000, blockSize: 256,
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', running: true, sampleRate: 48000, blockSize: 256 }),
    );
  });

  it('does not forward unwhitelisted fields on a status message to the webview (FR-IPC-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'status', running: true, evil: '<img src=x onerror=alert(1)>',
    });
    const call = created.webview.postMessage.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)['command'] === 'status',
    );
    expect(call![0]).not.toHaveProperty('evil');
  });

  it('forwards a buffer_size_mismatch event with a formatted detail (FR-WIN-AUD-6)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', {
      type: 'event', kind: 'buffer_size_mismatch', requestedFrames: 64, actualFrames: 480,
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith({
      command: 'event', kind: 'buffer_size_mismatch', detail: 'requested 64 · actual 480 frames',
    });
  });

  it('forwards an event without details as kind only (FR-WIN-AUD-6)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'event', kind: 'realtime_unavailable' });
    expect(created.webview.postMessage).toHaveBeenCalledWith({ command: 'event', kind: 'realtime_unavailable' });
  });

  it('dispose() cleans up the panel', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    panel.dispose();
    expect(created.dispose).toHaveBeenCalled();
  });

  it('dispose() removes the manager message listener to prevent leak (FR-EQ-7)', () => {
    // 12 create+dispose cycles on the same manager must not accumulate listeners
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(process, 'emit').mockImplementation(((...args: unknown[]) => {
      if (args[0] === 'warning') {
        const w = args[1] as { name?: string };
        if (w?.name === 'MaxListenersExceededWarning') warnings.push(String(w));
      }
      return true;
    }) as unknown as typeof process.emit);

    const localManager = makeManager();
    for (let i = 0; i < 12; i++) {
      const p = new ScopePanel({ fsPath: '/ext' } as unknown as vscode.Uri, localManager);
      p.dispose();
    }

    warnSpy.mockRestore();
    expect(warnings).toHaveLength(0);
    // After all dispose() calls the manager should have no 'message' listeners left
    expect(localManager.listenerCount('message')).toBe(0);
  });

  it('reveal() is called when show() is called on an already-open panel', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { reveal: ReturnType<typeof vi.fn> };
    panel.show();
    expect(webviewMock).toHaveBeenCalledTimes(1);
    expect(created.reveal).toHaveBeenCalled();
  });

  it('does not regenerate webview.html on reveal — that would discard scope/spectrum history (FR-QA-EXT-7)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { html: string; postMessage: ReturnType<typeof vi.fn> };
    };
    const htmlAfterFirstShow = created.webview.html;

    panel.show();

    expect(created.webview.html).toBe(htmlAfterFirstShow);
  });

  it('posts current status via postMessage on reveal instead of relying on a fresh page load (FR-QA-EXT-7)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'status', running: true });
    created.webview.postMessage.mockClear();

    panel.show();

    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'status', running: true }),
    );
  });

  it('themes its chrome with the shared editor-surface layer and no colour literals (FR-THM-1)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const html = created.webview.html;
    expect(html).toContain('--ds-surface: var(--vscode-editor-background)');
    expect(html).toContain('background: var(--ds-surface)');
    // The shared theme block legitimately holds the accent palette; strip it
    // and require the panel's own CSS/markup to be literal-free.
    const own = html.replace(themeCss({ surface: 'editor' }), '');
    expect(own).not.toMatch(/(?<![&\w])#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it('includes fidelity caveat notice in webview HTML (T4.5)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('fidelity-caveat');
    expect(created.webview.html).toContain('Approx. Seed');
  });

  it('webview HTML does NOT contain duplicate xrun-display elements in emulator bar (T19-6)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('id="xrun-group"');
    expect(created.webview.html).not.toContain('xrun-display');
  });

  it('webview HTML shows getting-started instructions before first status', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('getting-started');
    expect(created.webview.html).toContain('Build for Emulator');
  });

  // T6.1 — Sine controls
  it('webview HTML contains sine frequency and amplitude controls', () => {
    panel.show({ freq: 440, amplitude: 0.5 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('id="sine-freq"');
    expect(created.webview.html).toContain('id="sine-amp"');
    expect(created.webview.html).toContain('value="440"');
  });

  it('webview HTML embeds initial sine amplitude', () => {
    panel.show({ freq: 880, amplitude: 0.75 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain('value="880"');
    expect(created.webview.html).toContain('value="0.75"');
  });

  it('uses SINE_DEFAULTS when no sineParams provided', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).toContain(`value="${SINE_DEFAULTS.freq}"`);
  });

  it('coerces corrupted numeric freq to default instead of injecting raw string (AC-80)', () => {
    panel.show({ freq: 'injected" onmouseover="alert(1)' as unknown as number, amplitude: 0.5 });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('injected');
    expect(created.webview.html).toContain(`value="${SINE_DEFAULTS.freq}"`);
  });

  it('coerces corrupted numeric amplitude to default instead of injecting raw string (AC-80)', () => {
    panel.show({ freq: 440, amplitude: 'bad" data-x="1' as unknown as number });
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('bad"');
    expect(created.webview.html).toContain(`value="${SINE_DEFAULTS.amplitude}"`);
  });

  // T6.2 / T19-6 — xruns counter in header only (AC-31)
  it('webview HTML does NOT contain xrun-group element (xrun in header status only)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(created.webview.html).not.toContain('id="xrun-group"');
  });

  // T8.6 / T8.7 — audio source selector
  it('webview HTML includes audio source selector with sine/live/wav options', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('audio-source-select');
    expect(webview.html).toContain('value="sine"');
    expect(webview.html).toContain('value="live"');
    expect(webview.html).toContain('value="wav"');
  });

  it('webview HTML defaults to sine input source', () => {
    panel.show(SINE_DEFAULTS, AUDIO_SOURCE_DEFAULTS);
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="sine" selected');
  });

  it('webview HTML shows live input as checked when audioSource.input is live', () => {
    panel.show(SINE_DEFAULTS, { input: 'live', sampleRate: 48000, bufferSize: 256, wavLoop: false });
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="live" selected');
  });

  it('webview HTML includes buffer size selector with 256 selected by default', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="buffer-size"');
    expect(webview.html).toContain('<option value="256" selected>256</option>');
  });

  it('webview HTML includes latency display element', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="latency-display"');
    expect(webview.html).toContain('latency: —');
  });

  it('calls onAudioSourceChange when audioSource message received from webview', () => {
    panel.show();
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
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live' }); // missing sampleRate and bufferSize
    expect(audioSourceChangeSpy).not.toHaveBeenCalled();
  });

  it('drops audioSource with invalid sampleRate (FR-ES-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live', sampleRate: 99999, bufferSize: 256 });
    expect(audioSourceChangeSpy).not.toHaveBeenCalled();
  });

  it('drops audioSource with bufferSize not a power of two in [64,512] (FR-ES-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live', sampleRate: 48000, bufferSize: 100 });
    expect(audioSourceChangeSpy).not.toHaveBeenCalled();
  });

  it('drops audioSource with bufferSize 1024 (power-of-two but > 512) (FR-ES-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live', sampleRate: 48000, bufferSize: 1024 });
    expect(audioSourceChangeSpy).not.toHaveBeenCalled();
  });

  it('accepts audioSource with all valid values (FR-ES-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'audioSource', input: 'live', sampleRate: 44100, bufferSize: 64 });
    expect(audioSourceChangeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ input: 'live', sampleRate: 44100, bufferSize: 64 }),
    );
  });

  // T8.7 — xrun and latency message forwarding
  it('forwards xrun message from manager to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'xrun', count: 3 });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'xrun', count: 3 }),
    );
  });

  it('forwards latency message from manager to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'latency', estimatedMs: 10.5 });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'latency', estimatedMs: 10.5 }),
    );
  });

  // T9.4 — WAV file input UI
  it('webview HTML enables the WAV radio (no longer disabled)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="wav"');
    expect(webview.html).not.toContain('value="wav" checked disabled');
    expect(webview.html).not.toContain('(M9)');
  });

  it('webview HTML includes WAV file controls (choose button + loop toggle)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="wav-choose"');
    expect(webview.html).toContain('id="wav-loop"');
    expect(webview.html).toContain('id="wav-name"');
  });

  it('webview HTML reflects the chosen WAV file name and loop state', () => {
    panel.show(SINE_DEFAULTS, {
      input: 'wav', sampleRate: 48000, bufferSize: 256, wavLoop: true, wavPath: '/tmp/audio/drums.wav',
    });
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('value="wav" selected');
    expect(webview.html).toContain('drums.wav');
    expect(webview.html).toContain('id="wav-loop" checked');
  });

  it('forwards pickWav command from webview to onPickWav', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'pickWav' });
    expect(pickWavSpy).toHaveBeenCalledOnce();
  });

  it('includes wavLoop in the audioSource change payload', () => {
    panel.show();
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
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    panel.notifyWavSelected('drums.wav', '/tmp/audio/drums.wav');
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'wavSelected', name: 'drums.wav' }),
    );
  });

  it('forwards a led message from manager to the webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'led', gpioPin: 23, lit: true });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'led', gpioPin: 23, lit: true }),
    );
  });

  // T13.3 — Spectrum view
  it('webview HTML includes a spectrum canvas element', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="spectrum"');
  });

  it('forwards spectrum message from manager to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    const in_fft  = [0.1, 0.5, 0.2];
    const out_fft = [0.1, 0.4, 0.15];
    (manager as unknown as EventEmitter).emit('message', {
      type: 'spectrum', in_fft, out_fft, binHz: 46.875,
    });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'spectrum', in_fft, out_fft, binHz: 46.875 }),
    );
  });

  // T16-2 — Scope panel visible border
  it('webview HTML body CSS includes a visible border on all sides (T16-2)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/body\s*\{[^}]*\bborder\b[^}]*1px solid var\(--ds-border\)/);
  });

  it('does not forward spectrum message if panel is not open', () => {
    expect(() =>
      (manager as unknown as EventEmitter).emit('message', {
        type: 'spectrum', in_fft: [0.1], out_fft: [0.1], binHz: 46.875,
      }),
    ).not.toThrow();
  });

  // T14.4 — Recording bar
  it('webview HTML includes recording bar elements', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="emulator-bar"');
    expect(webview.html).toContain('id="rec-start-btn"');
    expect(webview.html).toContain('id="rec-stop-btn"');
    expect(webview.html).toContain('id="replay-start-btn"');
  });

  it('forwards recordStart command from webview to onRecordStart', () => {
    const onRecordStart = vi.fn();
    const p = new ScopePanel({ fsPath: '/ext' } as unknown as vscode.Uri, manager, undefined, undefined, undefined, onRecordStart);
    p.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'recordStart' });
    expect(onRecordStart).toHaveBeenCalledOnce();
  });

  it('forwards recordStop command from webview to onRecordStop', () => {
    const onRecordStop = vi.fn();
    const p = new ScopePanel({ fsPath: '/ext' } as unknown as vscode.Uri, manager, undefined, undefined, undefined, undefined, onRecordStop);
    p.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'recordStop' });
    expect(onRecordStop).toHaveBeenCalledOnce();
  });

  it('forwards replayStart command from webview to onReplayStart', () => {
    const onReplayStart = vi.fn();
    const p = new ScopePanel({ fsPath: '/ext' } as unknown as vscode.Uri, manager, undefined, undefined, undefined, undefined, undefined, onReplayStart);
    p.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'replayStart' });
    expect(onReplayStart).toHaveBeenCalledOnce();
  });

  it('forwards replayDone from manager to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    (manager as unknown as EventEmitter).emit('message', { type: 'replayDone' });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'replayDone' }),
    );
  });

  it('notifyRecordingState posts recordingState to webview', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    panel.notifyRecordingState(true, false, 'my-session.dsrec');
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'recordingState', recording: true, replaying: false, fileName: 'my-session.dsrec' }),
    );
  });

  // T15.1 — Input source dropdown
  it('webview HTML has a select element for audio source (T15.1)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="audio-source-select"');
    expect(webview.html).toContain('value="sine"');
    expect(webview.html).toContain('value="live"');
    expect(webview.html).toContain('value="wav"');
  });

  // FR-SCI-4 — time-base selector
  it('webview HTML has a time-base selector defaulting to 2 ms/div (FR-SCI-4)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="timebase"');
    for (const ms of ['0.5', '1', '2', '5', '10']) {
      expect(webview.html).toContain(`<option value="${ms}"`);
    }
    expect(webview.html).toMatch(/<option value="2" selected>/);
    expect(webview.html).toContain('id="rate-note"');
  });

  // FR-SCI-5 — gain and amplitude scale
  it('webview HTML has gain and amplitude-scale chips showing ×1 and Linear (FR-SCI-5, FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/id="chip-gain"[^>]*>[^]*?<span class="chip-value">×1<\/span>/);
    expect(webview.html).toMatch(/id="chip-scale"[^>]*>[^]*?<span class="chip-value">Linear<\/span>/);
  });

  // FR-SCI-15 — chips replace the segmented groups
  it('renders exactly five chips and no segmented groups (FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    for (const id of ['gain', 'scale', 'trigger', 'faxis', 'lmode']) {
      expect(webview.html, id).toContain(`id="chip-${id}"`);
    }
    expect(webview.html.match(/class="chip"/g)).toHaveLength(5);
    for (const id of ['gain-seg', 'unit-seg', 'trig-seg', 'trigsrc-seg', 'fscale-seg', 'lmode-seg']) {
      expect(webview.html, id).not.toContain(id);
    }
    expect(webview.html).not.toContain('seg-btn');
  });

  it('puts Gain, Scale and Trigger chips in the toolbar and the axis and level chips in the spectrum bar (FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const html = webview.html;
    const toolbar = html.slice(html.indexOf('id="scope-controls"'), html.indexOf('id="scope-main"'));
    const spectrum = html.slice(html.indexOf('id="spectrum-controls"'), html.indexOf('id="spectrum"'));
    for (const id of ['gain', 'scale', 'trigger']) expect(toolbar).toContain(`id="chip-${id}"`);
    for (const id of ['faxis', 'lmode']) expect(spectrum).toContain(`id="chip-${id}"`);
    // unchanged controls
    for (const id of ['timebase', 'freeze-btn', 'single-btn', 'snapshot-btn', 'export-btn']) expect(toolbar).toContain(`id="${id}"`);
  });

  it('chips start at the defaults: Free trigger, Log Hz, Absolute dBFS (FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/id="chip-trigger"[^>]*>[^]*?<span class="chip-value">Free<\/span>/);
    expect(webview.html).toMatch(/id="chip-faxis"[^>]*>[^]*?<span class="chip-value">Log Hz<\/span>/);
    expect(webview.html).toMatch(/id="chip-lmode"[^>]*>[^]*?<span class="chip-value">Absolute dBFS<\/span>/);
  });

  // FR-SCI-6 — stereo traces with a toggling legend
  it('webview HTML has a legend that toggles In, Out L and Out R (FR-SCI-6)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    for (const id of ['in', 'l', 'r']) expect(webview.html).toContain(`data-trace="${id}"`);
    expect(webview.html).toContain('stroke-dasharray="7 4"');
    expect(webview.html).toContain('var(--ds-trace-out-r)');
  });

  // FR-SCI-7 — freeze and cursor read-out
  it('webview HTML has a freeze button, a FROZEN badge and a cursor read-out (FR-SCI-7)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="freeze-btn"');
    // FROZEN is drawn on the plot, in the gain label's corner — not as an HTML badge.
    expect(webview.html).not.toContain('frozen-badge');
    expect(webview.html).not.toContain('>FROZEN<');
    expect(webview.html).toContain('id="cursor-readout"');
  });

  // Toolbar stability: hovering the plot must never change the toolbar's height.
  it('the cursor read-out overlays the plot instead of sitting in the toolbar (toolbar height stays fixed)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const html = webview.html;
    const toolbarStart = html.indexOf('id="scope-controls"');
    const toolbarEnd = html.indexOf('id="scope-main"');
    expect(html.slice(toolbarStart, toolbarEnd)).not.toContain('id="cursor-readout"');
    expect(html.indexOf('id="cursor-readout"')).toBeGreaterThan(html.indexOf('id="plots"'));
    expect(html).toMatch(/#cursor-readout \{[^}]*position: absolute/);
    expect(html).toMatch(/#cursor-readout \{[^}]*pointer-events: none/);
  });

  it('unselected toolbar buttons have a border as visible as the selected one, so all look the same size', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const css = webview.html;
    for (const sel of ['\\.chip', '\\.ctl-btn']) {
      const rule = new RegExp(`${sel} \\{([^}]*)\\}`).exec(css)![1]!;
      expect(rule).toMatch(/border: 1px solid var\(--ds-control-border\)/);
    }
    expect(css).toMatch(/--ds-control-border: color-mix\(in srgb, var\(--ds-text\) \d+%, transparent\)/);
  });

  it('text buttons and icon-only buttons have the same height: same line box and vertical padding', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const css = webview.html;
    const rule = (sel: string): string => new RegExp(`${sel} \\{([^}]*)\\}`).exec(css)![1]!;
    const vpad = (r: string): string => /padding: (\d+)px/.exec(r)![1]!;
    expect(css).toMatch(/--ctl-line: 14px/);
    expect(rule('\\.chip')).toMatch(/line-height: var\(--ctl-line\)/);
    expect(rule('\\.ctl-btn')).toMatch(/line-height: var\(--ctl-line\)/);
    expect(rule('\\.ctl-icon svg')).toMatch(/height: var\(--ctl-line\)/);
    expect(vpad(rule('\\.chip'))).toBe(vpad(rule('\\.ctl-btn')));
    expect(rule('\\.ctl-icon')).toMatch(/padding: \d+px (\d+px)?/);
    expect(/padding: (\d+)px/.exec(rule('\\.ctl-icon'))![1]).toBe(vpad(rule('\\.ctl-btn')));
  });

  it('toolbar buttons share one font size and never wrap their label', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/\.chip \{[^}]*font-size: 11px/);
    expect(webview.html).toMatch(/\.ctl-btn \{[^}]*font-size: 11px/);
    expect(webview.html).toMatch(/\.ctl-btn \{[^}]*white-space: nowrap/);
    expect(webview.html).toMatch(/\.chip \{[^}]*white-space: nowrap/);
    expect(webview.html).toMatch(/#rate-note \{[^}]*white-space: nowrap/);
  });

  // FR-SCI-8 — meters column
  it('webview HTML has a meter per channel, a headroom value and a Reset peaks button (FR-SCI-8)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    for (const id of ['in', 'l', 'r']) {
      expect(webview.html).toContain(`data-meter="${id}"`);
      expect(webview.html).toContain(`data-clip="${id}"`);
    }
    expect(webview.html).toContain('id="meter-headroom"');
    expect(webview.html).toContain('id="meters-reset"');
  });

  // FR-SCI-9 — trigger controls
  it('webview HTML has a Trigger chip defaulting to Free (FR-SCI-9, FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/id="chip-trigger"[^>]*data-chip="trigger"/);
    expect(webview.html).toMatch(/id="chip-trigger"[^>]*>[^]*?<span class="chip-value">Free<\/span>/);
  });

  // FR-SCI-16 — choice popover
  it('has one popover menu, hidden at first, with an opaque theme-dropdown background (FR-SCI-16)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/<div id="chip-popover" role="menu"[^>]*hidden/);
    const rule = /#chip-popover \{([^}]*)\}/.exec(webview.html)?.[1] ?? '';
    expect(rule).toMatch(/background: var\(--ds-dropdown-bg\)/);
    expect(rule).toMatch(/color: var\(--ds-dropdown-fg\)/);
    expect(rule).toMatch(/position: fixed/);
    expect(rule).not.toMatch(/opacity/);
  });

  it('every chip is a menu button that starts collapsed (FR-SCI-16)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    const chips = webview.html.match(/<button[^>]*class="chip"[^>]*>/g) ?? [];
    expect(chips).toHaveLength(5);
    for (const c of chips) {
      expect(c).toContain('aria-haspopup="menu"');
      expect(c).toContain('aria-expanded="false"');
    }
  });

  it('popover entries show a check for the active one and dim disabled ones (FR-SCI-16)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/\.chip-item\[aria-checked="true"\]/);
    expect(webview.html).toMatch(/\.chip-item:disabled \{[^}]*opacity/);
  });

  // FR-SCI-17 — non-default marker
  it('a non-default chip is drawn in the warning colour with a ● before its value; a default one is not (FR-SCI-17)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/\.chip\.changed \{[^}]*color: var\(--ds-warning-fg\)/);
    expect(webview.html).toMatch(/\.chip\.changed \.chip-value::before \{[^}]*content: "●/);
    // all five start at their default: none is marked
    expect(webview.html).not.toMatch(/class="chip changed"/);
    expect(webview.html).not.toContain('changed from default');
  });

  // FR-SCI-10 — best-effort single-shot
  it('webview HTML has a 1x Single button whose tooltip explains the full-rate capture and the best-effort free-run case (FR-SCI-10, FR-SCI-14d)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="single-btn"');
    expect(webview.html).toMatch(/id="single-btn"[^>]*title="[^"]*full rate[^"]*best effort/i);
  });

  // FR-SCI-11 — spectrum scaling
  it('webview HTML has frequency-axis and level-mode chips, Log Hz + Absolute by default (FR-SCI-11, FR-SCI-15)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/id="chip-faxis"[^>]*>[^]*?<span class="chip-value">Log Hz<\/span>/);
    expect(webview.html).toMatch(/id="chip-lmode"[^>]*>[^]*?<span class="chip-value">Absolute dBFS<\/span>/);
  });

  it('Freeze and 1× Single start disabled — nothing streams until audio runs', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toMatch(/id="freeze-btn"[^>]*disabled/);
    expect(webview.html).toMatch(/id="single-btn"[^>]*disabled/);
  });

  // FR-SCI-12 — snapshot and export
  it('webview HTML has snapshot and export buttons (FR-SCI-12)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="snapshot-btn"');
    expect(webview.html).toContain('id="export-btn"');
    // not controls like the rest: they are the last two buttons of the bar
    const at = (id: string): number => webview.html.indexOf(`id="${id}"`);
    for (const id of ['freeze-btn', 'single-btn', 'chip-gain', 'chip-scale', 'chip-trigger']) {
      expect(at('snapshot-btn')).toBeGreaterThan(at(id));
    }
    expect(at('export-btn')).toBeGreaterThan(at('snapshot-btn'));
    // grouped: no other control between them
    expect(webview.html).toMatch(/<span class="btn-group"[^>]*>\s*<button[^>]*id="snapshot-btn"[\s\S]*?<\/button>\s*<button[^>]*id="export-btn"/);
    // icon-only buttons: an SVG icon, an accessible name, and no label text
    expect(webview.html).toMatch(/id="snapshot-btn"[^>]*aria-label="Save snapshot[^"]*"[^>]*><svg/);
    expect(webview.html).toMatch(/id="export-btn"[^>]*aria-label="Export[^"]*"[^>]*><svg/);
  });

  it('saves a CSV sent by the webview through a save dialog (FR-SCI-12)', async () => {
    const showSave = vi.mocked(vscode.window.showSaveDialog);
    showSave.mockResolvedValue(undefined);
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'exportCsv', csv: 'time_ms,In\n' });
    await Promise.resolve();
    expect(showSave).toHaveBeenCalledWith(expect.objectContaining({ filters: { 'CSV file': ['csv'] } }));
  });

  it('ignores an export message whose payload is not a string (FR-SCI-12)', async () => {
    const showSave = vi.mocked(vscode.window.showSaveDialog);
    showSave.mockClear();
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'exportCsv', csv: 42 });
    handler({ command: 'saveSnapshot', pngBase64: { evil: true } });
    await Promise.resolve();
    expect(showSave).not.toHaveBeenCalled();
  });

  // FR-SCI-13 — event history
  it('webview HTML has an events strip with a history toggle and a log (FR-SCI-13)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="events"');
    expect(webview.html).toContain('id="events-toggle"');
    expect(webview.html).toContain('id="event-log"');
  });

  // FR-SCOPE-1 — Audio Settings always visible (no collapsible)
  it('webview HTML includes emulator-section with no Controls Editor tab (FR-SCOPE-1)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="emulator-section"');
    expect(webview.html).not.toContain('Controls Editor');
  });

  it('emulator-section has no coll-header, coll-arrow or coll-body elements (FR-SCOPE-1)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).not.toContain('coll-header');
    expect(webview.html).not.toContain('coll-arrow');
    expect(webview.html).not.toContain('coll-body');
    // (the toolbar chips legitimately use aria-expanded, FR-SCI-16)
    const section = webview.html.slice(webview.html.indexOf('id="emulator-section"'));
    expect(section).not.toContain('aria-expanded');
  });

  it('audio-source-select is directly inside emulator-section — always visible (FR-SCOPE-1)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="audio-source-select"');
    expect(webview.html).not.toContain('class="coll-body collapsed"');
  });

  // FR-SCOPE-1 / T19-6 — emulator bar always-visible; latency present; xrun-display removed
  it('latency-display is still present in emulator bar (FR-SCOPE-1)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="latency-display"');
  });

  it('xrun-group is absent from emulator bar (T19-6, AC-31)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).not.toContain('id="xrun-group"');
  });

  // T15.4 — Master output volume slider
  it('webview HTML includes output-vol slider in vol-group (T15.4)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="vol-group"');
    expect(webview.html).toContain('id="output-vol"');
  });

  it('forwards outputVolume webview message to manager.sendOutputVolume (T15.4)', () => {
    const onOutputVolume = vi.fn();
    const p = new ScopePanel({ fsPath: '/ext' } as unknown as vscode.Uri, manager, undefined, undefined, undefined, undefined, undefined, undefined, onOutputVolume);
    p.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'outputVolume', volume: 0.6 });
    expect(manager.sendOutputVolume).toHaveBeenCalledWith(0.6);
    expect(onOutputVolume).toHaveBeenCalledWith(0.6);
  });

  it('forwards a valid scopeCapture arm request to manager.sendScopeCapture (FR-SCI-14c)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'scopeCapture', action: 'arm', source: 'l', edge: 'fall', level: 0.25 });
    expect(manager.sendScopeCapture).toHaveBeenCalledWith({ action: 'arm', source: 'l', edge: 'fall', level: 0.25 });
    handler({ command: 'scopeCapture', action: 'cancel' });
    expect(manager.sendScopeCapture).toHaveBeenCalledWith({ action: 'cancel' });
  });

  it('ignores a malformed scopeCapture request (FR-SCI-14c)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'scopeCapture', action: 'arm', source: 'r', edge: 'rise', level: 0 });
    handler({ command: 'scopeCapture', action: 'arm', source: 'in', edge: 'up', level: 0 });
    handler({ command: 'scopeCapture', action: 'arm', source: 'in', edge: 'rise', level: Number.NaN });
    handler({ command: 'scopeCapture', action: 'arm', source: 'in', edge: 'rise', level: 'x' });
    handler({ command: 'scopeCapture', action: 'explode' });
    expect(manager.sendScopeCapture).not.toHaveBeenCalled();
  });

  it('posts a scope_capture IPC message to the webview as scopeCapture (FR-SCI-14c)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { postMessage: ReturnType<typeof vi.fn> };
    };
    manager.emit('message', { type: 'scope_capture', in: [0, 1], out: [0, 2], out_r: [0, 3], rate: 48000, trigger: 1 });
    expect(created.webview.postMessage).toHaveBeenCalledWith(
      { command: 'scopeCapture', in: [0, 1], out: [0, 2], out_r: [0, 3], rate: 48000, trigger: 1 },
    );
  });

  // T19-3 — Simplified recording button labels (AC-28)
  it('rec-start-btn label is glyph-only — no text suffix after the glyph (T19-3)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('>&#9679;</button>');
    expect(webview.html).not.toContain('&#9679; Record');
  });

  // T19-2 — Start/Stop Audio toolbar buttons (AC-27)
  it('webview HTML includes Start Audio and Stop Audio buttons in header (T19-2)', () => {
    panel.show();
    const { webview } = webviewMock.mock.results[0]?.value as { webview: { html: string } };
    expect(webview.html).toContain('id="btn-audio-start"');
    expect(webview.html).toContain('id="btn-audio-stop"');
  });

  it('startAudio message calls startAudio transport (T19-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'startAudio' });
    expect(manager.sendTransport).toHaveBeenCalledWith('start');
  });

  it('stopAudio message calls stopAudio transport (T19-2)', () => {
    panel.show();
    const created = webviewMock.mock.results[0]?.value as {
      webview: { onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    const handler = created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void;
    handler({ command: 'stopAudio' });
    expect(manager.sendTransport).toHaveBeenCalledWith('stop');
  });
});

describe('ScopePanel input generators (FR-GEN-1, FR-GEN-4, FR-GEN-5)', () => {
  const GEN_IDS = ['sine', 'noise', 'sweep', 'impulse', 'step', 'silence', 'twotone'] as const;
  let manager: EmulatorManager;
  let sourceSpy: ReturnType<typeof vi.fn>;
  let generatorSpy: ReturnType<typeof vi.fn>;
  let panel: ScopePanel;

  const open = (generatorParams?: Record<string, unknown>) => {
    (panel.show as (...a: unknown[]) => void)(undefined, undefined, generatorParams);
    const created = (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value as {
      webview: { html: string; onDidReceiveMessage: ReturnType<typeof vi.fn> };
    };
    return {
      html: created.webview.html,
      send: created.webview.onDidReceiveMessage.mock.calls[0]![0] as (msg: unknown) => void,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    manager = makeManager();
    sourceSpy = vi.fn();
    generatorSpy = vi.fn();
    panel = new ScopePanel(
      { fsPath: '/ext' } as unknown as vscode.Uri, manager,
      undefined, sourceSpy as never, undefined, undefined, undefined, undefined, undefined, undefined, generatorSpy as never,
    );
  });

  it('the Input select has a Generators group and an External group, with Sine selected (FR-GEN-1)', () => {
    const { html } = open();
    const select = /<select id="audio-source-select">([^]*?)<\/select>/.exec(html)![1]!;
    const groups = [...select.matchAll(/<optgroup label="([^"]+)">([^]*?)<\/optgroup>/g)];
    expect(groups.map(g => g[1])).toEqual(['Generators', 'External']);
    const values = (g: RegExpMatchArray): string[] => [...g[2]!.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]!);
    expect(values(groups[0]!)).toEqual([...GEN_IDS]);
    expect(values(groups[1]!)).toEqual(['live', 'wav']);
    expect(select).toMatch(/<option value="sine" selected>Sine<\/option>/);
    expect(select).toContain('>Live (mic)<');
    expect(select).toContain('>WAV<');
  });

  it('renders a parameter group for every generator, only the selected one visible (FR-GEN-2)', () => {
    const { html } = open();
    for (const id of GEN_IDS) {
      const gid = id === 'sine' ? 'sine-group' : `gen-${id}`;
      expect(html, id).toMatch(new RegExp(`id="${gid}" class="emu-group ${id === 'sine' ? '' : 'emu-hidden'}"`));
    }
  });

  it('gives each generator only its own fields and a hint where it has one (FR-GEN-2)', () => {
    const { html } = open();
    const group = (id: string): string =>
      new RegExp(`<span id="gen-${id}"[^]*?(?=<span id="(?:gen-|wav-group|buffer-group))`).exec(html)?.[0] ?? '';
    expect(group('sweep')).toMatch(/data-key="from"[^]*data-key="to"[^]*data-key="time"[^]*data-key="amp"/);
    expect(group('noise')).toMatch(/data-key="color"[^]*data-key="amp"/);
    expect(group('impulse')).toMatch(/data-key="amp"[^]*data-key="period"/);
    expect(group('silence')).not.toContain('data-key=');
    for (const id of ['silence', 'impulse', 'step', 'twotone']) expect(group(id), id).toContain('class="gen-hint"');
    for (const id of ['noise', 'sweep']) expect(group(id), id).not.toContain('gen-hint');
  });

  it('shows the remembered parameters of a generator, falling back to the defaults (FR-GEN-4)', () => {
    const { html } = open({ sweep: { freq: 440, amp: 0.7, color: 'white', from: 50, to: 8000, time: 12, period: 500 } });
    expect(html).toMatch(/data-gen="sweep" data-key="from"[^>]*value="50"/);
    expect(html).toMatch(/data-gen="sweep" data-key="time"[^>]*value="12"/);
    expect(html).toMatch(/data-gen="impulse" data-key="period"[^>]*value="500"/);
    expect(html).toMatch(/data-gen="noise" data-key="amp"[^>]*value="0.25"/);
  });

  it('fails if a generator is missing from the select (FR-GEN-1)', () => {
    const { html } = open();
    for (const id of GEN_IDS) expect(html).toContain(`<option value="${id}"`);
  });

  it('accepts every generator id in an audioSource message and rejects unknown ones (FR-GEN-4)', () => {
    const { send } = open();
    for (const id of GEN_IDS) {
      send({ command: 'audioSource', input: id, sampleRate: 48000, bufferSize: 256, wavLoop: true });
      expect(sourceSpy).toHaveBeenLastCalledWith(expect.objectContaining({ input: id }));
    }
    sourceSpy.mockClear();
    send({ command: 'audioSource', input: 'bogus', sampleRate: 48000, bufferSize: 256, wavLoop: true });
    expect(sourceSpy).not.toHaveBeenCalled();
  });

  it('forwards a generator message to the emulator with clamped parameters, and remembers it (FR-GEN-4)', () => {
    const { send } = open();
    send({ command: 'generator', kind: 'sweep', params: { freq: 440, amp: 9, color: 'white', from: 1000, to: 10, time: 5, period: 500 } });
    const sent = (manager.sendGenerator as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(sent[0]).toBe('sweep');
    expect(sent[1]).toMatchObject({ amp: 1, from: 1000 });
    expect(sent[1].to).toBeGreaterThan(1000);
    expect(generatorSpy).toHaveBeenCalledWith('sweep', sent[1]);
  });

  it('drops generator messages with an unknown kind, sine, or malformed params (FR-GEN-4)', () => {
    const { send } = open();
    send({ command: 'generator', kind: 'bogus', params: {} });
    send({ command: 'generator', kind: 'sine', params: {} });
    send({ command: 'generator', kind: 'noise', params: 'loud' });
    send({ command: 'generator', kind: 'noise', params: { amp: 'loud' } });
    expect(manager.sendGenerator).not.toHaveBeenCalled();
    expect(generatorSpy).not.toHaveBeenCalled();
  });

  it('does not touch Time, Gain, Scale or Trigger when a generator is selected (FR-GEN-5)', () => {
    const { html } = open();
    const script = /<script[^>]*src=/.test(html);
    expect(script).toBe(true);
    // the chips and time select are independent of the Input select markup
    expect(html).toContain('id="timebase"');
    expect(html).toContain('id="chip-gain"');
    expect(html).not.toMatch(/audio-source-select[^>]*data-(time|gain|trigger)/);
  });
});
