import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// Import under test — vscode resolved from __mocks__ via vitest.config.ts alias.
import { activate, deactivate } from '../../extension';

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: '/ext',
    workspaceState: {
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: (_key: string, _value: unknown) => Promise.resolve(),
      keys: () => [],
    },
  } as unknown as vscode.ExtensionContext;
}

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports activate and deactivate', () => {
    expect(typeof activate).toBe('function');
    expect(typeof deactivate).toBe('function');
  });

  it('activate registers all four commands', () => {
    const ctx = makeContext();
    activate(ctx);

    const calls = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const registeredIds = calls.map((c: unknown[]) => c[0] as string);

    expect(registeredIds).toContain('ds-ide.build');
    expect(registeredIds).toContain('ds-ide.deploy');
    expect(registeredIds).toContain('ds-ide.start');
    expect(registeredIds).toContain('ds-ide.stop');
  });

  it('activate pushes disposables onto context.subscriptions', () => {
    const ctx = makeContext();
    activate(ctx);
    // 4 commands + 1 manager/scope dispose subscription
    expect((ctx.subscriptions as unknown[]).length).toBe(5);
  });

  it('deactivate does not throw', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
