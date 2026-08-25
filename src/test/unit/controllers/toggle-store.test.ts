import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as vscode from 'vscode';
import { ToggleStore } from '../../../controllers/toggle-store';

function makeMockMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      const v = store.get(key);
      return (v !== undefined ? v : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...store.keys()];
    },
  } as unknown as vscode.Memento;
}

describe('ToggleStore (FR-DEV-7)', () => {
  let memento: vscode.Memento;
  let store: ToggleStore;

  beforeEach(() => {
    memento = makeMockMemento();
    store = new ToggleStore(memento);
  });

  it('returns empty object when nothing stored', () => {
    expect(store.getAll()).toEqual({});
  });

  it('persists a toggle position keyed by gpio pin', () => {
    store.set(5, 2);
    expect(store.getAll()[5]).toBe(2);
  });

  it('overwrites a previous position', () => {
    store.set(5, 2);
    store.set(5, 0);
    expect(store.getAll()[5]).toBe(0);
  });

  describe('setDefaults()', () => {
    it('seeds unset toggles to position 0', () => {
      store.setDefaults([5, 6]);
      expect(store.getAll()[5]).toBe(0);
      expect(store.getAll()[6]).toBe(0);
    });

    it('does not overwrite an existing position', () => {
      store.set(5, 2);
      store.setDefaults([5]);
      expect(store.getAll()[5]).toBe(2);
    });
  });

  it('getSnapshot returns all stored positions (round-trip)', () => {
    store.set(5, 2);
    store.set(6, 1);
    expect(store.getSnapshot()).toEqual({ 5: 2, 6: 1 });
  });

  it('does not produce an unhandled rejection when update() fails (FR-EXT-19)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failingMemento = { ...memento, update: () => Promise.reject(new Error('disk full')) } as vscode.Memento;
    const failingStore = new ToggleStore(failingMemento);

    failingStore.set(5, 2);
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist'), expect.any(Error));
    warnSpy.mockRestore();
  });
});
