import { describe, it, expect, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import { PotStore } from '../../../controllers/pot-store';
import type { ControllerDef } from '../../../controllers/controller-config';

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
  let memento: vscode.Memento;
  let store: PotStore;

  beforeEach(() => {
    memento = makeMockMemento();
    store = new PotStore(memento);
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
});
