// Live illustrated widgets for the Controls Editor cards (FR-CWS-2). Each
// control renders the same art as its Wiring Editor palette chip
// (wiring/device-icons.ts), and live state is applied as CSS custom properties
// on the widget root — the SVG is never rebuilt on a value change. The
// stylesheet in controls-editor-panel.ts maps each variable onto the art's
// `data-part` hooks (angle, offset, opacity).
//
// Pure strings and numbers apart from `applyVars`, which only needs an
// element-like with `style.setProperty`, so it is unit-testable without a DOM.
import { deviceIconSvg } from '../../wiring/device-icons';
import { accentVar } from '../../devices/registry';

// The dial shows a coarser detent count than the wire resolution, purely for
// legibility (see convention-canvas.ts's encoder comment, FR-DEV-9).
export const ENCODER_VISIBLE_DETENTS = 32;

export type WidgetVars = Record<string, string>;

export interface WidgetOptions {
  pin: number;
  /** ADC channel — pot only. */
  channel?: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export function potState(value: number): { value: number; vars: WidgetVars } {
  const clamped = clamp01(value);
  return { value: clamped, vars: { '--v': String(clamped) } };
}

export function encoderState(position: number): { vars: WidgetVars } {
  const detent = ((position % ENCODER_VISIBLE_DETENTS) + ENCODER_VISIBLE_DETENTS) % ENCODER_VISIBLE_DETENTS;
  return { vars: { '--e': String(detent) } };
}

export function toggleState(position: number): { vars: WidgetVars } {
  return { vars: { '--p': String(position) } };
}

/** Emulator-driven colour: `color(srgb …)` takes the 0..1 channels directly. */
export function rgbState(r: number, g: number, b: number): { vars: WidgetVars } {
  const [cr, cg, cb] = [clamp01(r), clamp01(g), clamp01(b)];
  const off = cr === 0 && cg === 0 && cb === 0;
  return { vars: { '--c': `color(srgb ${cr} ${cg} ${cb})`, '--co': off ? '0' : '1' } };
}

export function applyVars(el: { style: { setProperty(name: string, value: string): void } }, vars: WidgetVars): void {
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
}

/** The widget markup for a control kind; an unknown kind renders as an LED, as the old card body did. */
export function widgetHtml(kind: string, opts: WidgetOptions): string {
  const art = deviceIconSvg(kind, accentVar(kind), { live: true });
  switch (kind) {
    case 'pot':
      return `<div class="knob-wrap" data-channel="${opts.channel ?? 0}" data-value="0" style="--v:0">${art}<span class="knob-value">0.000</span></div>`;
    case 'button':
      return `<button class="btn-ce" type="button" data-pin="${opts.pin}" aria-pressed="false">${art}</button>`;
    case 'toggle':
      return `<button class="tgl-ce" type="button" data-pin="${opts.pin}" data-pos="0" style="--p:0">${art}<span class="tgl-pos">0</span></button>`;
    case 'encoder':
      return `<div class="enc-wrap" data-pos="0" style="--e:0">${art}<span class="enc-value">0</span></div>`;
    case 'rgbled':
      return `<span class="vrgb-dot" data-pin="${opts.pin}" style="--co:0">${art}</span>`;
    default:
      return `<span class="vled-dot" data-pin="${opts.pin}">${deviceIconSvg('led', accentVar('led'), { live: true })}</span>`;
  }
}
