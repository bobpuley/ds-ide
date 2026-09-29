// Knob and encoder SVG markup for the Controls Editor canvas (FR-THM-1,
// FR-THM-3). Pure string builders: colours are `var(--ds-*)` references set via
// inline `style`, because SVG presentation attributes don't resolve CSS
// variables. Being variables, they repaint on a theme switch with no JS (FR-THM-5).
import { computeKnobGeometry, KNOB_SVG_SIZE, KNOB_CENTER } from '../knob-math';
import { accentVar } from '../../devices/registry';

const ENCODER_VISIBLE_DETENTS = 32;

const DIAL = 'fill:var(--ds-surface);stroke:var(--ds-border)';
const svgOpen = `<svg class="knob-svg" viewBox="0 0 ${KNOB_SVG_SIZE} ${KNOB_SVG_SIZE}" width="${KNOB_SVG_SIZE}" height="${KNOB_SVG_SIZE}">`;

export function knobSvg(value: number): string {
  const { trackPath, valuePath, dotX, dotY } = computeKnobGeometry(value);
  const accent = accentVar('pot');
  return svgOpen +
    `<circle cx="${KNOB_CENTER}" cy="${KNOB_CENTER}" r="18" style="${DIAL}" stroke-width="1.5"/>` +
    `<path d="${trackPath}" style="fill:none;stroke:var(--ds-border)" stroke-width="3" stroke-linecap="round"/>` +
    `<path class="knob-value-path" d="${valuePath ?? 'M 0 0'}" style="fill:none;stroke:${accent}${valuePath ? '' : ';display:none'}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle class="knob-dot" cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="2.5" style="fill:${accent}"/>` +
    '</svg>';
}

export function encoderSvg(position: number): string {
  const cx = KNOB_CENTER, cy = KNOB_CENTER, r = 18;
  const angleDeg = (position % ENCODER_VISIBLE_DETENTS) * (360 / ENCODER_VISIBLE_DETENTS);
  const rad = (angleDeg * Math.PI) / 180;
  const dotX = cx + r * 0.7 * Math.sin(rad);
  const dotY = cy - r * 0.7 * Math.cos(rad);
  const accent = accentVar('encoder');
  return svgOpen +
    `<circle cx="${cx}" cy="${cy}" r="${r}" style="${DIAL}" stroke-width="1.5"/>` +
    `<line x1="${cx}" y1="${cy}" x2="${dotX.toFixed(2)}" y2="${dotY.toFixed(2)}" style="stroke:${accent}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="${dotX.toFixed(2)}" cy="${dotY.toFixed(2)}" r="2.5" style="fill:${accent}"/>` +
    '</svg>';
}
