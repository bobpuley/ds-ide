/// <reference lib="dom" />
// Generic card-dragging behavior (FR-EXT-32) — shared by the convention
// canvas's and the legacy YAML editor canvas's cards, which otherwise have
// unrelated markup/state. `addDocListener` is injected so both canvases'
// mousemove/mouseup listeners are tracked and cleared by the same shared
// doc-listener tracker (doc-listeners.ts).
export function makeDraggable(
  card: HTMLElement,
  ctrl: { pos: [number, number] },
  addDocListener: (event: string, fn: EventListener) => void,
): void {
  const header = (card.querySelector('.ctrl-handle') || card.querySelector('.card-header')) as HTMLElement | null;
  if (!header) return;
  let drag = false, sx = 0, sy = 0, sl = 0, st = 0;
  header.addEventListener('mousedown', e => {
    const me = e as MouseEvent;
    if ((me.target as HTMLElement).closest('.card-del')) return;
    drag = true; sx = me.clientX; sy = me.clientY;
    sl = parseInt(card.style.left, 10) || 0; st = parseInt(card.style.top, 10) || 0;
    e.preventDefault();
  });
  addDocListener('mousemove', e => {
    if (!drag) return;
    const me = e as MouseEvent;
    const nx = Math.max(0, sl + me.clientX - sx);
    const ny = Math.max(0, st + me.clientY - sy);
    card.style.left = nx + 'px'; card.style.top = ny + 'px';
    ctrl.pos = [nx, ny];
  });
  addDocListener('mouseup', () => { drag = false; });
}
