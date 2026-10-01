/// <reference lib="dom" />
// Header buttons that move every card at once (FR-CEH-2..4). They only touch
// the cards' inline left/top, then schedule the shared auto-save (FR-RCH-5),
// which reads positions back from the DOM — so no new IPC or schema.
import { snapToGrid, type Pos } from './layout-helpers';

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
  const align = document.getElementById('align-grid-btn') as HTMLButtonElement | null;

  align?.addEventListener('click', () => {
    for (const card of cards()) place(card, snapToGrid(currentPos(card)));
    deps.schedule();
  });

  return {
    // Positions persist from the DOM only in convention mode; the legacy
    // yaml-only canvas keeps them in its own model, so the buttons are off.
    setEnabled(enabled: boolean): void {
      if (align) align.disabled = !enabled;
    },
  };
}
