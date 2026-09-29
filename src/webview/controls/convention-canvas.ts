/// <reference lib="dom" />
// Convention-mode canvas, extracted from controls-webview.ts (FR-EXT-32) —
// owns the parsed convention controls/placements and emulator-running flag
// instead of sharing controls-webview.ts's module scope with five other
// concerns. `getButtonMode` is injected (rather than reaching into the YAML
// editor canvas's `_yamlCfg` directly) so this module has no dependency on
// yaml-editor-canvas.ts's internal state shape.
import type { ConventionControl } from '../../controllers/controls-convention-parser';
import type { ControlsPlacement } from '../scope-panel';
import type { ButtonMode } from '../../controllers/controller-config';
import type { DeviceType } from '../../wiring/wiring-panel';
import type { ControlsWebviewMessage } from '../messages';
import { createRafCoalescer } from '../raf-coalesce';
import { TOGGLE_POSITIONS } from '../../devices/codegen/toggle';
import { wrapEncoderPosition } from '../../devices/codegen/encoder';
import { escJ, truncId } from './text-utils';
import { adcChannelFromPin } from './adc-channel';
import { makeDraggable } from './drag';
import { widgetHtml, potState, encoderState, toggleState, applyVars } from './device-widget';

// sdcard (FR-DEV-10), oled (FR-DEV-14), midiTrs (FR-DEV-16) and midiUsb
// (FR-DEV-17) are bus-attached peripherals and never appear as a control card
// here (they have no ConventionControl entry — see wiredControlIds() in
// devices/registry.ts) — their labels exist only to satisfy DeviceType's
// exhaustiveness.
const KIND_LABELS: Record<DeviceType, string> = {
  pot: 'Pot', button: 'Button', led: 'LED', toggle: 'Toggle', rgbled: 'RGB LED', encoder: 'Encoder',
  sdcard: 'SD Card', oled: 'OLED', midiTrs: 'MIDI TRS', midiUsb: 'MIDI USB',
};

// Encoder rotary dial (FR-DEV-9) — endless rotation, so unlike the pot's
// knob (a bounded arc over [0,1]) this always shows a full circle; the
// pointer's angle is the wrapped position mapped onto a coarser visual
// detent count purely for legibility (the wire value stays the full
// ENCODER_POSITION_MODULUS-resolution position — see codegen/encoder.ts).
const ENCODER_PX_PER_DETENT = 12;

export interface ConventionCanvas {
  apply(controls: ConventionControl[], placements: ControlsPlacement[]): void;
  setEmulatorRunning(running: boolean): void;
  getControls(): ConventionControl[];
}

export function createConventionCanvas(
  vscode: { postMessage(msg: ControlsWebviewMessage): void },
  getButtonMode: (id: string) => ButtonMode | undefined,
  addDocListener: (event: string, fn: EventListener) => void,
  clearDocListeners: () => void,
): ConventionCanvas {
  let conventionControls: ConventionControl[] = [];
  let conventionPlacements: ControlsPlacement[] = [];
  let ceEmulatorRunning = false;

  function updateCeEmulatorState(running: boolean): void {
    ceEmulatorRunning = running;
    const ceStatusEl = document.getElementById('ce-emu-status');
    if (ceStatusEl) {
      ceStatusEl.textContent = running ? '▶' : '■';
      ceStatusEl.className = running ? 'ce-emu-running' : 'ce-emu-stopped';
    }
    document.querySelectorAll('#canvas-area .ctrl-body').forEach(body => {
      body.classList.toggle('body-disabled', !running);
    });
  }

  function updateKnob(knobWrap: HTMLElement, value: number): number {
    const { value: clamped, vars } = potState(value);
    applyVars(knobWrap, vars);
    const valEl = knobWrap.querySelector('.knob-value');
    if (valEl) valEl.textContent = clamped.toFixed(3);
    return clamped;
  }

  function buildConventionCard(ctrl: ConventionControl, pos: [number, number]): HTMLElement {
    const kindLabel = KIND_LABELS[ctrl.kind];
    const card = document.createElement('div');
    card.className = 'ctrl-card ds-hc';
    card.dataset['kind'] = ctrl.kind;
    card.dataset['id'] = ctrl.id;
    card.style.minWidth = '90px';
    card.style.left = pos[0] + 'px';
    card.style.top = pos[1] + 'px';

    // RGB LED keyed by its primary (first / red-channel) pin — matches the IPC
    // rgbLed message's gpioPin, which is the shim's r_pin_ (FR-DEV-8).
    const adcCh = ctrl.kind === 'pot' ? adcChannelFromPin(ctrl.pin) : 0;
    const bodyInnerHtml = widgetHtml(ctrl.kind, { pin: ctrl.pin, channel: adcCh });

    card.innerHTML =
      '<div class="ctrl-handle" title="' + escJ(kindLabel + ' \xb7 pin ' + ctrl.pin) + '">' +
        '<span class="handle-glyph">&#x283F;</span>' +
        '<span class="card-id-label" title="' + escJ(ctrl.id) + '">' + escJ(truncId(ctrl.id)) + '</span>' +
      '</div>' +
      '<div class="ctrl-body' + (ceEmulatorRunning ? '' : ' body-disabled') + '">' +
        bodyInnerHtml +
      '</div>';

    if (ctrl.kind === 'pot') {
      const knobWrap = card.querySelector('.knob-wrap') as HTMLElement;
      let kDrag = false, kStartY = 0, kStartVal = 0;
      knobWrap.addEventListener('mousedown', e => {
        kDrag = true;
        kStartY = (e as MouseEvent).clientY;
        kStartVal = parseFloat(knobWrap.dataset['value'] || '0');
        e.preventDefault();
      });
      // Raw mousemove can fire well above the display refresh rate; coalescing
      // to one update per animation frame keeps the DOM write + IPC postMessage
      // at a smooth, bounded rate instead of one of each per native event
      // (FR-UX-5). The extension-host side (PotStore) separately debounces its
      // own workspaceState persistence — this only bounds the webview's work.
      const flushKnobMove = createRafCoalescer<number>((targetValue) => {
        const newVal = updateKnob(knobWrap, targetValue);
        knobWrap.dataset['value'] = String(newVal);
        vscode.postMessage({ command: 'pot', channel: adcCh, value: newVal });
      }, (cb) => requestAnimationFrame(cb));
      const onKnobMove = (e: Event): void => {
        if (!kDrag) return;
        const delta = (kStartY - (e as MouseEvent).clientY) / 100;
        flushKnobMove(kStartVal + delta);
      };
      const onKnobUp = (): void => { kDrag = false; };
      addDocListener('mousemove', onKnobMove);
      addDocListener('mouseup', onKnobUp);
    } else if (ctrl.kind === 'button') {
      const btn = card.querySelector('.btn-ce') as HTMLButtonElement;
      const gpioPin = ctrl.pin;
      const btnMode = getButtonMode(ctrl.id) || 'momentary';
      if (btnMode === 'toggle') {
        let latch = false;
        btn.addEventListener('mousedown', () => {
          latch = !latch;
          btn.setAttribute('aria-pressed', String(latch));
          vscode.postMessage({ command: 'button', gpioPin, pressed: true });
        });
        btn.addEventListener('mouseup', () => {
          vscode.postMessage({ command: 'button', gpioPin, pressed: false });
        });
      } else {
        const press   = (): void => { btn.setAttribute('aria-pressed', 'true');  vscode.postMessage({ command: 'button', gpioPin, pressed: true }); };
        const release = (): void => { btn.setAttribute('aria-pressed', 'false'); vscode.postMessage({ command: 'button', gpioPin, pressed: false }); };
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup',   release);
        btn.addEventListener('mouseleave', () => { if (btn.getAttribute('aria-pressed') === 'true') release(); });
      }
    } else if (ctrl.kind === 'toggle') {
      // Cycles 0 -> 1 -> 2 -> 0 on each click (FR-DEV-7) — the multi-position
      // primitive's minimal interaction; no drag state to track, unlike pot's knob.
      const tgl = card.querySelector('.tgl-ce') as HTMLButtonElement;
      const gpioPin = ctrl.pin;
      tgl.addEventListener('click', () => {
        const next = (parseInt(tgl.dataset['pos'] || '0', 10) + 1) % TOGGLE_POSITIONS;
        tgl.dataset['pos'] = String(next);
        applyVars(tgl, toggleState(next).vars);
        const posEl = tgl.querySelector('.tgl-pos');
        if (posEl) posEl.textContent = String(next);
        vscode.postMessage({ command: 'toggle', gpioPin, position: next });
      });
    } else if (ctrl.kind === 'encoder') {
      // Vertical drag in ENCODER_PX_PER_DETENT-px steps (the "detents") —
      // unlike pot's continuous knob, only whole-detent movement posts a
      // message, and rotation is endless (wraps via wrapEncoderPosition)
      // rather than clamped to [0,1] (FR-DEV-9).
      const encWrap = card.querySelector('.enc-wrap') as HTMLElement;
      const gpioPin = ctrl.pin;
      let eDrag = false, eStartY = 0, eStartPos = 0, eLastSentPos = 0;
      encWrap.addEventListener('mousedown', e => {
        eDrag = true;
        eStartY = (e as MouseEvent).clientY;
        eStartPos = parseInt(encWrap.dataset['pos'] || '0', 10);
        eLastSentPos = eStartPos;
        e.preventDefault();
      });
      const flushEncoderMove = createRafCoalescer<number>((targetPos) => {
        const wrapped = wrapEncoderPosition(targetPos);
        encWrap.dataset['pos'] = String(wrapped);
        applyVars(encWrap, encoderState(wrapped).vars);
        const valEl = encWrap.querySelector('.enc-value');
        if (valEl) valEl.textContent = String(wrapped);
        if (wrapped !== eLastSentPos) {
          eLastSentPos = wrapped;
          vscode.postMessage({ command: 'encoder', gpioPin, position: wrapped });
        }
      }, (cb) => requestAnimationFrame(cb));
      const onEncoderMove = (e: Event): void => {
        if (!eDrag) return;
        const pxDelta = eStartY - (e as MouseEvent).clientY;
        const detents = Math.round(pxDelta / ENCODER_PX_PER_DETENT);
        flushEncoderMove(eStartPos + detents);
      };
      const onEncoderUp = (): void => { eDrag = false; };
      addDocListener('mousemove', onEncoderMove);
      addDocListener('mouseup', onEncoderUp);
    }

    makeDraggable(card, { pos: [pos[0], pos[1]] }, addDocListener);
    return card;
  }

  function buildNotInCodeCard(pl: ControlsPlacement): HTMLElement {
    const card = document.createElement('div');
    card.className = 'ctrl-card ds-hc not-in-code-card';
    card.dataset['id'] = pl.id;
    card.style.left = pl.pos[0] + 'px';
    card.style.top = pl.pos[1] + 'px';
    card.style.opacity = '0.4';
    card.innerHTML =
      '<div class="card-header"><span class="card-kind" style="color:var(--ds-error)">not in code</span></div>' +
      '<div class="card-body"><div class="card-field"><label>id</label><span class="card-val">' + escJ(pl.id) + '</span></div></div>';
    return card;
  }

  function renderConventionCanvas(): void {
    clearDocListeners();
    const area = document.getElementById('canvas-area');
    const hint = document.getElementById('canvas-hint');
    if (!area) return;
    area.querySelectorAll('.ctrl-card').forEach(c => c.remove());
    const placementMap: Record<string, [number, number]> = {};
    for (const p of conventionPlacements) placementMap[p.id] = p.pos;
    const conventionIds = new Set(conventionControls.map(c => c.id));
    const posState = { ax: 20, ay: 20 };
    function nextPos(): [number, number] {
      const p: [number, number] = [posState.ax, posState.ay];
      posState.ax += 190;
      if (posState.ax > 580) { posState.ax = 20; posState.ay += 170; }
      return p;
    }
    for (const ctrl of conventionControls) {
      const pos = placementMap[ctrl.id] || nextPos();
      area.appendChild(buildConventionCard(ctrl, pos));
    }
    for (const pl of conventionPlacements) {
      if (!conventionIds.has(pl.id)) area.appendChild(buildNotInCodeCard(pl));
    }
    if (hint) hint.style.display = (conventionControls.length === 0 && conventionPlacements.length === 0) ? 'flex' : 'none';
    updateCeEmulatorState(ceEmulatorRunning);
  }

  return {
    apply(controls: ConventionControl[], placements: ControlsPlacement[]): void {
      conventionControls = controls;
      conventionPlacements = placements;
      renderConventionCanvas();
    },
    setEmulatorRunning(running: boolean): void {
      updateCeEmulatorState(running);
    },
    getControls(): ConventionControl[] {
      return conventionControls;
    },
  };
}
