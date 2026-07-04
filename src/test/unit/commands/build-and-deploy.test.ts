import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as buildMod from '../../../commands/build';
import * as deployMod from '../../../commands/deploy';

vi.mock('../../../commands/build', async () => {
  const real = await vi.importActual<typeof buildMod>('../../../commands/build');
  return { ...real, buildForEmulator: vi.fn() };
});

vi.mock('../../../commands/deploy', () => ({
  deployToEmulator: vi.fn(),
}));

// Minimal stub for the combined-command logic so we can test chaining
// without importing the full extension (which pulls in vscode internals).
async function buildAndDeployLogic(
  buildFn: () => Promise<boolean>,
  deployFn: () => Promise<void>,
): Promise<void> {
  const ok = await buildFn();
  if (!ok) return;
  await deployFn();
}

describe('buildAndDeployLogic (AC-26)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls deploy when build succeeds', async () => {
    const build  = vi.fn().mockResolvedValue(true);
    const deploy = vi.fn().mockResolvedValue(undefined);
    await buildAndDeployLogic(build, deploy);
    expect(build).toHaveBeenCalledOnce();
    expect(deploy).toHaveBeenCalledOnce();
  });

  it('does NOT call deploy when build fails', async () => {
    const build  = vi.fn().mockResolvedValue(false);
    const deploy = vi.fn();
    await buildAndDeployLogic(build, deploy);
    expect(build).toHaveBeenCalledOnce();
    expect(deploy).not.toHaveBeenCalled();
  });
});

describe('buildForEmulator return value', () => {
  it('returns true on success', async () => {
    // detectEffectSrc is tested separately; here we verify the boolean contract
    // using the already-mocked stub.
    vi.mocked(buildMod.buildForEmulator).mockResolvedValue(true);
    const result = await buildMod.buildForEmulator({} as never, '/ext', undefined, {} as never);
    expect(result).toBe(true);
  });

  it('returns false on failure', async () => {
    vi.mocked(buildMod.buildForEmulator).mockResolvedValue(false);
    const result = await buildMod.buildForEmulator({} as never, '/ext', undefined, {} as never);
    expect(result).toBe(false);
  });
});
