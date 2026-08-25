import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as vscode from 'vscode';
import { PotStore } from '../../../controllers/pot-store';
import type { ControllerDef } from '../../../controllers/controller-config';

function makeMockMemento(): vscode.Memento & { update: ReturnType<typeof vi.fn> } {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      const v = store.get(key);
      return (v !== undefined ? v : defaultValue) as T;
    },
    update: vi.fn((key: string, value: unknown): Thenable<void> => {
      store.set(key, value);
      return Promise.resolve();
    }),
    keys(): readonly string[] {
      return [...store.keys()];
    },
  } as unknown as vscode.Memento & { update: ReturnType<typeof vi.fn> };
}

const DEF_0: ControllerDef = {
  id: 'pitch',
  label: 'Pitch',
  adcChannel: 0,
  range: [0, 1],
  taper: 'linear',
  default: 0.5,
};

const DEF_1: ControllerDef = {
  id: 'cutoff',
  label: 'Cutoff',
  adcChannel: 1,
  range: [0, 1],
  taper: 'log',
  default: 0.3,
};

describe('PotStore', () => {
  let memento: vscode.Memento & { update: ReturnType<typeof vi.fn> };
  let store: PotStore;

  beforeEach(() => {
    vi.useFakeTimers();
    memento = makeMockMemento();
    store = new PotStore(memento);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getAll()', () => {
    it('returns empty object when no values stored', () => {
      expect(store.getAll()).toEqual({});
    });
  });

  describe('set()', () => {
    it('persists a channel value', () => {
      store.set(0, 0.75);
      expect(store.getAll()[0]).toBe(0.75);
    });

    it('persists multiple channel values independently', () => {
      store.set(0, 0.25);
      store.set(3, 0.9);
      const all = store.getAll();
      expect(all[0]).toBe(0.25);
      expect(all[3]).toBe(0.9);
    });

    it('overwrites a previously set value', () => {
      store.set(0, 0.5);
      store.set(0, 0.8);
      expect(store.getAll()[0]).toBe(0.8);
    });
  });

  describe('setDefaults()', () => {
    it('sets default for channels not yet in storage', () => {
      store.setDefaults([DEF_0, DEF_1]);
      const all = store.getAll();
      expect(all[0]).toBe(0.5);
      expect(all[1]).toBe(0.3);
    });

    it('does not overwrite existing channel values', () => {
      store.set(0, 0.9);
      store.setDefaults([DEF_0]);
      expect(store.getAll()[0]).toBe(0.9); // original value preserved
    });

    it('partially applies defaults when some channels already set', () => {
      store.set(0, 0.1);
      store.setDefaults([DEF_0, DEF_1]);
      expect(store.getAll()[0]).toBe(0.1); // unchanged
      expect(store.getAll()[1]).toBe(0.3); // default applied
    });

    it('is idempotent', () => {
      store.setDefaults([DEF_0]);
      store.setDefaults([DEF_0]);
      expect(store.getAll()[0]).toBe(0.5);
    });
  });

  describe('getSnapshot()', () => {
    it('returns all stored values', () => {
      store.set(0, 0.4);
      store.set(2, 0.7);
      const snap = store.getSnapshot();
      expect(snap[0]).toBe(0.4);
      expect(snap[2]).toBe(0.7);
    });

    it('returns empty object when nothing stored', () => {
      expect(store.getSnapshot()).toEqual({});
    });
  });

  describe('debounced persistence (FR-UX-5)', () => {
    it('does not call workspaceState.update synchronously on set()', () => {
      store.set(0, 0.5);
      expect(memento.update).not.toHaveBeenCalled();
    });

    it('flushes to workspaceState ~250ms after the last set() call', () => {
      store.set(0, 0.5);
      vi.advanceTimersByTime(249);
      expect(memento.update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(memento.update).toHaveBeenCalledOnce();
      expect(memento.update).toHaveBeenCalledWith('ds-ide.potValues', { 0: 0.5 });
    });

    it('resets the flush timer on each new set() call, coalescing a burst into a single write', () => {
      // Simulate a continuous 5-second drag: a set() call every 10ms (~500 calls).
      for (let t = 0; t < 5000; t += 10) {
        store.set(0, t / 5000);
        vi.advanceTimersByTime(10);
      }
      // No flush yet — the timer keeps resetting as long as calls keep arriving.
      expect(memento.update).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      // Exactly one flush once the burst goes idle — comfortably under the
      // "~20 workspaceState.update calls for a 5s drag" budget.
      expect(memento.update).toHaveBeenCalledOnce();
    });

    it('getAll() reflects the latest dragged value immediately, even before the debounced flush fires', () => {
      store.set(0, 0.5);
      store.set(0, 0.9);
      expect(store.getAll()[0]).toBe(0.9);
      expect(memento.update).not.toHaveBeenCalled();
    });

    it('getSnapshot() reflects the latest value immediately for post-deploy replay, independent of the pending flush', () => {
      store.set(0, 0.5);
      store.set(0, 0.42);
      expect(store.getSnapshot()[0]).toBe(0.42);
    });

    it('setDefaults() flushes immediately rather than waiting on the debounce', () => {
      store.setDefaults([DEF_0]);
      expect(memento.update).toHaveBeenCalledOnce();
      expect(memento.update).toHaveBeenCalledWith('ds-ide.potValues', { 0: 0.5 });
    });

    it('does not produce an unhandled rejection when update() fails (FR-EXT-19)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      memento.update.mockReturnValueOnce(Promise.reject(new Error('disk full')));

      store.setDefaults([DEF_0]);
      await vi.advanceTimersByTimeAsync(0);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist'), expect.any(Error));
      warnSpy.mockRestore();
    });
  });
});
