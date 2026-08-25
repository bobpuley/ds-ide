/// <reference lib="dom" />
// Palette-to-canvas drag-and-drop (FR-EXT-32) — the only control-adding
// interaction, wired independently of which canvas renders it (today, only
// the legacy YAML editor canvas has palette items to drop). `addNewControl`
// is injected so this module has no dependency on yaml-editor-canvas.ts's
// internal state shape.
import { el } from '../dom-lookup';

export function wirePaletteDragDrop(
  addNewControl: (kind: 'pot' | 'button' | 'led', x: number, y: number) => void,
): void {
  document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      const de = e as DragEvent;
      de.dataTransfer?.setData('text/plain', (item as HTMLElement).dataset['kind'] || '');
    });
  });
  const canvasArea = el<HTMLElement>('canvas-area');
  canvasArea.addEventListener('dragover', e => e.preventDefault());
  canvasArea.addEventListener('drop', e => {
    const de = e as DragEvent;
    de.preventDefault();
    const kind = de.dataTransfer?.getData('text/plain');
    if (kind !== 'pot' && kind !== 'button' && kind !== 'led') return;
    const rect = canvasArea.getBoundingClientRect();
    const x = Math.max(0, de.clientX - rect.left);
    const y = Math.max(0, de.clientY - rect.top);
    addNewControl(kind, x, y);
  });
}
