import * as fs from 'fs';
import * as path from 'path';

const EXCLUDED = new Set(['libDaisy', 'DaisySP', 'libdaisy', 'daisysp', '.ds-ide']);

async function findCpp(dir: string): Promise<string | undefined> {
  try {
    const entries = (await fs.promises.readdir(dir)) as string[];
    const cpps = entries.filter(e => e.endsWith('.cpp') && !EXCLUDED.has(e));
    if (cpps.length === 1) return path.join(dir, cpps[0]!);
    if (cpps.length > 1) {
      const nonMain = cpps.filter(f => f !== 'main.cpp');
      if (nonMain.length === 1) return path.join(dir, nonMain[0]!);
    }
  } catch { /* ignore fs errors */ }
  return undefined;
}

export async function findEffectSource(
  projectRoot: string,
  configured?: string,
): Promise<string | undefined> {
  if (configured) {
    const p = path.isAbsolute(configured) ? configured : path.join(projectRoot, configured);
    try { await fs.promises.access(p); return p; } catch { /* not accessible */ }
  }
  const r1 = await findCpp(projectRoot);
  if (r1) return r1;
  const r2 = await findCpp(path.join(projectRoot, 'src'));
  if (r2) return r2;
  return findCpp(path.join(projectRoot, 'source'));
}
