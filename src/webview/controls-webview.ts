/// <reference lib="dom" />
// Controls Editor webview entry point. FR-EXT-32 split what used to be one
// 767-line file with 13+ module-scoped mutable variables shared across six
// unrelated concerns into per-concern modules (src/webview/controls/), each
// owning its own state; this file is now just the orchestrator that wires
// the data-island config, cross-module getters, and the top-level message
// listener together.
import type { ControlsHostMessage, ControlsWebviewMessage } from './messages';
import type { ControllerConfig } from '../controllers/controller-config';
import { hasKnownCommand } from './message-guard';
import { el } from './dom-lookup';
import { readDataIsland, showDataIslandError } from './data-island';
import { createDocListenerTracker } from './controls/doc-listeners';
import { createConventionCanvas } from './controls/convention-canvas';
import { createYamlEditorCanvas } from './controls/yaml-editor-canvas';
import { wireSaveButton } from './controls/save';
import { createSdCardPanel } from './controls/sd-card-panel';
import { createOledStrip } from './controls/oled-strip';
import { rgbState, applyVars } from './controls/device-widget';

interface VsCodeApiForControls {
  postMessage(msg: ControlsWebviewMessage): void;
}

const vscode = acquireVsCodeApi() as unknown as VsCodeApiForControls;

function isPartialControllerConfig(v: unknown): v is Partial<ControllerConfig> {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (['pots', 'buttons', 'leds', 'encoders', 'toggles', 'rgbleds'] as const)
    .every(field => obj[field] === undefined || Array.isArray(obj[field]));
}

const _yamlInitResult = readDataIsland<Partial<ControllerConfig>>(
  el<HTMLElement>('yaml-init').textContent ?? '{}',
  isPartialControllerConfig,
  {},
);
if (_yamlInitResult.error) showDataIslandError('yaml-init', _yamlInitResult.error);

const docListeners = createDocListenerTracker();

const yamlEditorCanvas = createYamlEditorCanvas(_yamlInitResult.value, docListeners.add, docListeners.clear);

const conventionCanvas = createConventionCanvas(
  vscode,
  (id) => yamlEditorCanvas.getYamlCfg().buttons.find(b => b.id === id)?.mode,
  docListeners.add,
  docListeners.clear,
);

const sdCardPanel = createSdCardPanel(vscode);
const oledStrip = createOledStrip(vscode);

let conventionMissing = true;

wireSaveButton({
  vscode,
  isConventionMissing: () => conventionMissing,
  getConventionControls: () => conventionCanvas.getControls(),
  getYamlCfg: () => yamlEditorCanvas.getYamlCfg(),
  getEditorControls: () => yamlEditorCanvas.getEditorControls(),
});

type ControlsConfigMsg = Extract<ControlsHostMessage, { command: 'controlsConfig' }>;

function applyControlsConfig(msg: ControlsConfigMsg): void {
  conventionMissing = !!msg.missingBlock;
  const banner = document.getElementById('convention-banner');
  if (banner) banner.style.display = conventionMissing ? 'flex' : 'none';
  if (!conventionMissing) {
    conventionCanvas.apply(msg.controls || [], msg.placements || []);
  } else {
    yamlEditorCanvas.render();
  }
}

// ── LED state from emulator ───────────────────────────────────────────────
function applyLed(gpioPin: number, lit: boolean): void {
  document.querySelectorAll('.vled-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    dot.classList.toggle('vled-lit', !!lit);
  });
}

// ── RGB LED state from emulator (FR-DEV-8) ────────────────────────────────
function applyRgbLed(gpioPin: number, r: number, g: number, b: number): void {
  const { vars } = rgbState(r, g, b);
  document.querySelectorAll('.vrgb-dot[data-pin="' + gpioPin + '"]').forEach(dot => {
    applyVars(dot as HTMLElement, vars);
  });
}

// ── Message handler ───────────────────────────────────────────────────────
const CONTROLS_HOST_COMMANDS = new Set<ControlsHostMessage['command']>([
  'controlsConfig', 'status', 'editorLoad', 'led', 'rgbLed',
  'sdCardEnabled', 'sdContents', 'sdPreview', 'oledEnabled', 'oledFrame',
]);

window.addEventListener('message', (e: MessageEvent<unknown>) => {
  if (!hasKnownCommand(e.data, CONTROLS_HOST_COMMANDS)) return;
  const msg = e.data as ControlsHostMessage;
  if (msg.command === 'controlsConfig') {
    applyControlsConfig(msg);
  } else if (msg.command === 'status') {
    conventionCanvas.setEmulatorRunning(!!msg.running);
  } else if (msg.command === 'editorLoad') {
    yamlEditorCanvas.editorLoad(msg.cfg || {});
  } else if (msg.command === 'led') {
    applyLed(msg.gpioPin, msg.lit);
  } else if (msg.command === 'rgbLed') {
    applyRgbLed(msg.gpioPin, msg.r, msg.g, msg.b);
  } else if (msg.command === 'sdCardEnabled') {
    sdCardPanel.applyEnabled(msg.enabled);
  } else if (msg.command === 'sdContents') {
    sdCardPanel.applyContents(msg.entries);
  } else if (msg.command === 'sdPreview') {
    sdCardPanel.applyPreview(msg.name, msg.content);
  } else if (msg.command === 'oledEnabled') {
    oledStrip.applyEnabled(msg.enabled, msg.bus);
  } else if (msg.command === 'oledFrame') {
    oledStrip.applyFrame(msg.data);
  }
});

vscode.postMessage({ command: 'webviewReady' });
