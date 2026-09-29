/// <reference lib="dom" />
// Legacy YAML editor canvas (missingBlock mode), extracted from
// controls-webview.ts (FR-EXT-32) — owns the parsed controllers.yaml state
// (`_yamlCfg`) and the editable card list (`editorControls`) instead of
// sharing controls-webview.ts's module scope with five other concerns.
// `_yamlCfg` is also read by the convention canvas (a control's button mode)
// and by save.ts (carrying forward encoder/toggle/rgbled positions) — both
// go through `getYamlCfg()` rather than reaching into this module's state.
import type { ControllerConfig, Taper, ButtonMode, ActiveLevel } from '../../controllers/controller-config';
import type { DeviceType } from '../../wiring/wiring-panel';
import { el } from '../dom-lookup';
import { escJ } from './text-utils';
import { makeDraggable } from './drag';

// A row in the legacy (missingBlock) YAML editor canvas — unifies the three
// device shapes with kind-specific fields left null where inapplicable.
export interface EditorControl {
  kind: DeviceType;
  id: string;
  label: string;
  adcChannel: number | null;
  range: [number, number] | null;
  taper: Taper | null;
  def: number | null;
  gpioPin: number | null;
  mode: ButtonMode | null;
  activeLevel: ActiveLevel | null;
  pos: [number, number];
}

export interface YamlEditorCanvas {
  editorLoad(cfg: Partial<ControllerConfig>): void;
  render(): void;
  getYamlCfg(): ControllerConfig;
  getEditorControls(): EditorControl[];
}

export function createYamlEditorCanvas(
  initialYamlInit: Partial<ControllerConfig>,
  addDocListener: (event: string, fn: EventListener) => void,
  clearDocListeners: () => void,
): YamlEditorCanvas {
  let yamlCfg: ControllerConfig = {
    pots: initialYamlInit.pots || [], buttons: initialYamlInit.buttons || [], leds: initialYamlInit.leds || [],
    encoders: initialYamlInit.encoders || [], toggles: initialYamlInit.toggles || [], rgbleds: initialYamlInit.rgbleds || [],
    errors: [],
  };
  let editorControls: EditorControl[] = [];

  function nextPos(state: { ax: number; ay: number }): [number, number] {
    const p: [number, number] = [state.ax, state.ay];
    state.ax += 190;
    if (state.ax > 580) { state.ax = 20; state.ay += 170; }
    return p;
  }

  function buildCard(ctrl: EditorControl): HTMLElement {
    const kindLabel = ctrl.kind === 'pot' ? 'Pot' : ctrl.kind === 'button' ? 'Button' : 'LED';
    const pinOpts = [...Array(32).keys()].map(i => '<option value="' + i + '"' + (ctrl.gpioPin === i ? ' selected' : '') + '>pin ' + i + '</option>').join('');
    const chOpts  = [...Array(12).keys()].map(i => '<option value="' + i + '"' + (ctrl.adcChannel === i ? ' selected' : '') + '>ch ' + i + '</option>').join('');
    const taperOpts = (['linear', 'log', 'antilog'] as const).map(t => '<option value="' + t + '"' + (ctrl.taper === t ? ' selected' : '') + '>' + t + '</option>').join('');
    const modeOpts  = (['momentary', 'toggle'] as const).map(m => '<option value="' + m + '"' + (ctrl.mode === m ? ' selected' : '') + '>' + m + '</option>').join('');

    const card = document.createElement('div');
    card.className = 'ctrl-card ds-hc';
    card.dataset['kind'] = ctrl.kind;
    card.style.left = ctrl.pos[0] + 'px';
    card.style.top  = ctrl.pos[1] + 'px';
    card.innerHTML =
      '<div class="card-header">' +
        '<span class="card-kind">' + kindLabel + '</span>' +
        '<button class="card-del" title="Remove">\xD7</button>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-field"><label>ID</label><input class="card-inp card-id" value="' + escJ(ctrl.id) + '"/></div>' +
        '<div class="card-field"><label>Label</label><input class="card-inp card-lbl" value="' + escJ(ctrl.label) + '"/></div>' +
        (ctrl.kind === 'pot'
          ? '<div class="card-field"><label>ADC ch</label><select class="card-sel card-ch">' + chOpts + '</select></div>' +
            '<div class="card-field"><label>Taper</label><select class="card-sel card-taper">' + taperOpts + '</select></div>' +
            '<div class="card-field"><label>Default</label><input class="card-inp card-def" type="number" min="0" max="1" step="0.01" value="' + ctrl.def + '"/></div>'
          : '<div class="card-field"><label>GPIO pin</label><select class="card-sel card-pin">' + pinOpts + '</select></div>' +
            (ctrl.kind === 'button' ? '<div class="card-field"><label>Mode</label><select class="card-sel card-mode">' + modeOpts + '</select></div>' : '')) +
      '</div>';

    (card.querySelector('.card-del') as HTMLElement).addEventListener('click', () => {
      editorControls = editorControls.filter(c => c !== ctrl);
      card.remove();
      const hint = document.getElementById('canvas-hint');
      if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
    });
    (card.querySelector('.card-id') as HTMLInputElement).addEventListener('input', e => { ctrl.id = (e.target as HTMLInputElement).value; });
    (card.querySelector('.card-lbl') as HTMLInputElement).addEventListener('input', e => { ctrl.label = (e.target as HTMLInputElement).value; });
    if (ctrl.kind === 'pot') {
      (card.querySelector('.card-ch') as HTMLSelectElement).addEventListener('change', e => { ctrl.adcChannel = parseInt((e.target as HTMLSelectElement).value, 10); });
      (card.querySelector('.card-taper') as HTMLSelectElement).addEventListener('change', e => { ctrl.taper = (e.target as HTMLSelectElement).value as Taper; });
      (card.querySelector('.card-def') as HTMLInputElement).addEventListener('change', e => { ctrl.def = parseFloat((e.target as HTMLInputElement).value); });
    } else {
      (card.querySelector('.card-pin') as HTMLSelectElement).addEventListener('change', e => { ctrl.gpioPin = parseInt((e.target as HTMLSelectElement).value, 10); });
      if (ctrl.kind === 'button') (card.querySelector('.card-mode') as HTMLSelectElement).addEventListener('change', e => { ctrl.mode = (e.target as HTMLSelectElement).value as ButtonMode; });
    }
    makeDraggable(card, ctrl, addDocListener);
    return card;
  }

  return {
    editorLoad(cfg: Partial<ControllerConfig>): void {
      yamlCfg = {
        pots: cfg.pots || [], buttons: cfg.buttons || [], leds: cfg.leds || [],
        encoders: cfg.encoders || [], toggles: cfg.toggles || [], rgbleds: cfg.rgbleds || [],
        errors: [],
      };
      editorControls = [];
      const posState = { ax: 20, ay: 20 };
      for (const p of (cfg.pots || [])) editorControls.push({ kind: 'pot', id: p.id, label: p.label, adcChannel: p.adcChannel, range: p.range || [0, 1], taper: p.taper || 'linear', def: p.default ?? 0.5, gpioPin: null, mode: null, activeLevel: null, pos: p.pos || nextPos(posState) });
      for (const b of (cfg.buttons || [])) editorControls.push({ kind: 'button', id: b.id, label: b.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: b.gpioPin ?? 0, mode: b.mode || 'momentary', activeLevel: b.activeLevel || 'low', pos: b.pos || nextPos(posState) });
      for (const l of (cfg.leds || [])) editorControls.push({ kind: 'led', id: l.id, label: l.label, adcChannel: null, range: null, taper: null, def: null, gpioPin: l.gpioPin ?? 0, mode: null, activeLevel: null, pos: l.pos || nextPos(posState) });
      // Canvas rendering is owned by applyControlsConfig() (driven by the
      // 'controlsConfig' message's authoritative missingBlock flag), not here —
      // editorLoad()'s job is only to refresh yamlCfg/editorControls. Every
      // real call site sends 'editorLoad' immediately followed by
      // 'controlsConfig' (loadEditor() then postControlsConfig(), or _flush()'s
      // same order), so rendering unconditionally here used to momentarily (or,
      // after FR-CE-1's fix started firing this pair right after a layout save,
      // visibly) stomp a convention-mode canvas with the legacy YAML-editor's
      // card set before the very next message corrected it (FR-CE-1 follow-up).
    },

    render(): void {
      clearDocListeners();
      const area = el<HTMLElement>('canvas-area');
      const hint = document.getElementById('canvas-hint');
      area.innerHTML = '';
      if (hint) area.appendChild(hint);
      if (hint) hint.style.display = editorControls.length ? 'none' : 'flex';
      for (const ctrl of editorControls) area.appendChild(buildCard(ctrl));
    },


    getYamlCfg(): ControllerConfig {
      return yamlCfg;
    },

    getEditorControls(): EditorControl[] {
      return editorControls;
    },
  };
}
