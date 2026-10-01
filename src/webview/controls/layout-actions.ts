/// <reference lib="dom" />
// Header buttons that move every card at once (FR-CEH-2..4). They only touch
// the cards' inline left/top, then schedule the shared auto-save (FR-RCH-5),
// which reads positions back from the DOM — so no new IPC or schema.
import { snapToGrid, arrangeInRows, cascadePositions, CARD_ROW_PITCH, type Pos } from './layout-helpers';

export interface LayoutActionDeps {
  /** Auto-save trigger (FR-RCH-5). */
  schedule(): void;
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('#canvas-area .ctrl-card[data-id]'));
}

function place(card: HTMLElement, pos: Pos): void {
  card.style.left = pos[0] + 'px';
  card.style.top = pos[1] + 'px';
}

function currentPos(card: HTMLElement): Pos {
  return [parseInt(card.style.left, 10) || 0, parseInt(card.style.top, 10) || 0];
}

export function wireLayoutButtons(deps: LayoutActionDeps): { setEnabled(enabled: boolean): void } {
  document.getElementById('align-grid-btn')?.addEventListener('click', () => {
    for (const card of cards()) place(card, snapToGrid(currentPos(card)));
    deps.schedule();
  });

  // Cards are in DOM order: controls in controls-block order, then any
  // "not in code" placeholders (FR-CEH-3). The row pitch grows to the tallest
  // card so no two overlap.
  document.getElementById('auto-arrange-btn')?.addEventListener('click', () => {
    const all = cards();
    const area = document.getElementById('canvas-area');
    const tallest = all.reduce((h, c) => Math.max(h, c.offsetHeight), 0);
    const positions = arrangeInRows(all.length, area?.clientWidth ?? 0, Math.max(CARD_ROW_PITCH, tallest + 20));
    all.forEach((card, i) => place(card, positions[i]!));
    deps.schedule();
  });

  document.getElementById('reset-positions-btn')?.addEventListener('click', () => {
    const all = cards();
    const positions = cascadePositions(all.length);
    all.forEach((card, i) => place(card, positions[i]!));
    deps.schedule();
  });

  return {
    // Positions persist from the DOM only in convention mode; the legacy
    // yaml-only canvas keeps them in its own model, so the buttons are off.
    setEnabled(enabled: boolean): void {
      for (const id of ['align-grid-btn', 'auto-arrange-btn', 'reset-positions-btn']) {
        const b = document.getElementById(id) as HTMLButtonElement | null;
        if (b) b.disabled = !enabled;
      }
    },
  };
}
