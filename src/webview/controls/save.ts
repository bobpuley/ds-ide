/// <reference lib="dom" />
// Save serialization (FR-EXT-32) — reads the currently-active canvas's state
// (convention or legacy YAML editor, via injected getters) and posts an
// 'editorSave' message. Kept as its own module since it's a pure read/reduce
// over both canvases' state rather than something either canvas owns.
import type { ControllerConfig, Taper, ButtonMode, ActiveLevel } from '../../controllers/controller-config';
import type { ConventionControl } from '../../controllers/controls-convention-parser';
import type { ControlsWebviewMessage } from '../messages';
import type { EditorControl } from './yaml-editor-canvas';
import { el } from '../dom-lookup';
import { adcChannelFromPin } from './adc-channel';
import { createDebouncedSaver } from './auto-save';

export interface SaveDeps {
  vscode: { postMessage(msg: ControlsWebviewMessage): void };
  isConventionMissing(): boolean;
  getConventionControls(): ConventionControl[];
  getYamlCfg(): ControllerConfig;
  getEditorControls(): EditorControl[];
}

// FR-RCH-5: the layout saves itself ~500 ms after a drag ends or a field is
// committed — there is no save button. `schedule` is what the canvases call;
// `cancel` is for a drag that starts while a save is still pending, so the
// host's post-save re-render cannot stomp it.
export interface LayoutAutoSave {
  schedule(): void;
  cancel(): void;
  flush(): void;
}

export function wireAutoSave(deps: SaveDeps): LayoutAutoSave {
  const { vscode, isConventionMissing, getConventionControls, getYamlCfg, getEditorControls } = deps;

  const saveNow = (): void => {
    let cfg: ControllerConfig;
    if (!isConventionMissing()) {
      const conventionControls = getConventionControls();
      const yamlCfg = getYamlCfg();
      const domPos: Record<string, [number, number]> = {};
      document.querySelectorAll('#canvas-area .ctrl-card[data-id]').forEach(c => {
        const id = (c as HTMLElement).dataset['id'] || '';
        domPos[id] = [parseInt((c as HTMLElement).style.left, 10) || 0, parseInt((c as HTMLElement).style.top, 10) || 0];
      });
      const yamlPotMap    = Object.fromEntries(yamlCfg.pots.map(p => [p.id, p]));
      const yamlBtnMap    = Object.fromEntries(yamlCfg.buttons.map(b => [b.id, b]));
      const yamlLedMap    = Object.fromEntries(yamlCfg.leds.map(l => [l.id, l]));
      // FR-CE-3: encoder/toggle/rgbled have no other YAML-configurable fields
      // (pin/behavior comes from the code annotation), so their "existing
      // entry" lookup only ever needs to carry forward `pos` — there's nothing
      // else on a PosOnlyDef to spread the way pot/button/led do above.
      const yamlEncoderMap = Object.fromEntries(yamlCfg.encoders.map(e => [e.id, e]));
      const yamlToggleMap  = Object.fromEntries(yamlCfg.toggles.map(t => [t.id, t]));
      const yamlRgbLedMap  = Object.fromEntries(yamlCfg.rgbleds.map(r => [r.id, r]));
      const updatedPots    = conventionControls.filter(c => c.kind === 'pot').map(c => {
        const ex = yamlPotMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return ex ? { ...ex, pos } : { id: c.id, label: c.id, adcChannel: adcChannelFromPin(c.pin), range: [0, 1] as [number, number], taper: 'linear' as Taper, default: 0.5, errors: [], pos };
      });
      const updatedButtons = conventionControls.filter(c => c.kind === 'button').map(c => {
        const ex = yamlBtnMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, mode: 'momentary' as ButtonMode, activeLevel: 'low' as ActiveLevel, pos };
      });
      const updatedLeds    = conventionControls.filter(c => c.kind === 'led').map(c => {
        const ex = yamlLedMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return ex ? { ...ex, pos } : { id: c.id, label: c.id, gpioPin: c.pin, pos };
      });
      const updatedEncoders = conventionControls.filter(c => c.kind === 'encoder').map(c => {
        const ex = yamlEncoderMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return { id: c.id, pos };
      });
      const updatedToggles = conventionControls.filter(c => c.kind === 'toggle').map(c => {
        const ex = yamlToggleMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return { id: c.id, pos };
      });
      const updatedRgbLeds = conventionControls.filter(c => c.kind === 'rgbled').map(c => {
        const ex = yamlRgbLedMap[c.id];
        const pos = domPos[c.id] || (ex && ex.pos) || [20, 20];
        return { id: c.id, pos };
      });
      cfg = {
        pots: updatedPots, buttons: updatedButtons, leds: updatedLeds,
        encoders: updatedEncoders, toggles: updatedToggles, rgbleds: updatedRgbLeds,
        errors: [],
      };
    } else {
      const editorControls = getEditorControls();
      const yamlCfg = getYamlCfg();
      const pots    = editorControls.filter(c => c.kind === 'pot').map(c => ({ id: c.id, label: c.label, adcChannel: c.adcChannel ?? 0, range: c.range || [0, 1] as [number, number], taper: c.taper || 'linear' as Taper, default: c.def ?? 0.5, errors: [] as string[], pos: c.pos }));
      const buttons = editorControls.filter(c => c.kind === 'button').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, mode: c.mode || 'momentary' as ButtonMode, activeLevel: c.activeLevel || 'low' as ActiveLevel, pos: c.pos }));
      const leds    = editorControls.filter(c => c.kind === 'led').map(c => ({ id: c.id, label: c.label, gpioPin: c.gpioPin ?? 0, pos: c.pos }));
      // The legacy YAML-editor canvas (missingBlock mode) has no encoder/
      // toggle/rgbled cards (FR-DEV-9/7/8 are convention-only devices)
      // — carry the last-loaded values through unchanged rather than dropping
      // them, so a stray save while missingBlock can't silently wipe positions
      // saved earlier in convention mode.
      cfg = { pots, buttons, leds, encoders: yamlCfg.encoders, toggles: yamlCfg.toggles, rgbleds: yamlCfg.rgbleds, errors: [] };
    }
    vscode.postMessage({ command: 'editorSave', cfg });
    const st = el<HTMLElement>('save-status');
    st.textContent = 'Saved ✓';
    setTimeout(() => { st.textContent = ''; }, 2000);
  };

  const saver = createDebouncedSaver(saveNow);
  // A pending save must not be lost when the view is hidden or torn down.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saver.flush(); });
  return saver;
}
