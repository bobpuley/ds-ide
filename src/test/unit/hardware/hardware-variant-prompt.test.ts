import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { promptHardwareVariant } from '../../../hardware/hardware-variant-prompt';

const showQuickPick = vscode.window.showQuickPick as ReturnType<typeof vi.fn>;

describe('promptHardwareVariant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "base" when the base item is picked', async () => {
    showQuickPick.mockImplementation(async (items: { variant: string }[]) =>
      items.find((i) => i.variant === 'base'),
    );
    expect(await promptHardwareVariant()).toBe('base');
  });

  it('returns "65mb-sdram" when the SDRAM item is picked', async () => {
    showQuickPick.mockImplementation(async (items: { variant: string }[]) =>
      items.find((i) => i.variant === '65mb-sdram'),
    );
    expect(await promptHardwareVariant()).toBe('65mb-sdram');
  });

  it('returns undefined when the prompt is dismissed', async () => {
    showQuickPick.mockResolvedValue(undefined);
    expect(await promptHardwareVariant()).toBeUndefined();
  });

  it('offers exactly the base and 65mb-sdram options', async () => {
    showQuickPick.mockResolvedValue(undefined);
    await promptHardwareVariant();
    const items = showQuickPick.mock.calls[0]![0] as { variant: string }[];
    expect(items.map((i) => i.variant).sort()).toEqual(['65mb-sdram', 'base']);
  });
});
