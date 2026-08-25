import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as vscode from 'vscode';
import { ButtonStore } from '../../../controllers/button-store';
import type { ButtonDef } from '../../../controllers/controller-config';

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

const BYPASS: ButtonDef = { id: 'bypass', label: 'Bypass', gpioPin: 28, mode: 'toggle', activeLevel: 'low' };
const TAP: ButtonDef = { id: 'tap', label: 'Tap', gpioPin: 25, mode: 'momentary', activeLevel: 'low' };

describe('ButtonStore', () => {
  let memento: vscode.Memento;
  let store: ButtonStore;

  beforeEach(() => {
    memento = makeMockMemento();
    store = new ButtonStore(memento);
  });

  it('returns empty object when nothing stored', () => {
    expect(store.getAll()).toEqual({});
  });

  it('persists a button state keyed by gpio pin', () => {
    store.set(28, true);
    expect(store.getAll()[28]).toBe(true);
  });

  it('overwrites a previous state (toggle off)', () => {
    store.set(28, true);
    store.set(28, false);
    expect(store.getAll()[28]).toBe(false);
  });

  describe('setDefaults()', () => {
    it('seeds unset buttons to released (false)', () => {
      store.setDefaults([BYPASS, TAP]);
      expect(store.getAll()[28]).toBe(false);
      expect(store.getAll()[25]).toBe(false);
    });

    it('does not overwrite an existing latched state', () => {
      store.set(28, true);
      store.setDefaults([BYPASS]);
      expect(store.getAll()[28]).toBe(true);
    });
  });

  it('getSnapshot returns all stored states', () => {
    store.set(28, true);
    store.set(25, false);
    expect(store.getSnapshot()).toEqual({ 28: true, 25: false });
  });

  it('does not produce an unhandled rejection when update() fails (FR-EXT-19)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failingMemento = { ...memento, update: () => Promise.reject(new Error('disk full')) } as vscode.Memento;
    const failingStore = new ButtonStore(failingMemento);

    failingStore.set(28, true);
    await new Promise((r) => setTimeout(r, 0));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist'), expect.any(Error));
    warnSpy.mockRestore();
  });
});
