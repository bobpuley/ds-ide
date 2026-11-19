import * as path from 'path';

// Extending PATH for a child process (FR-WIN-TCH-2, FR-WIN-TCH-5). The separator
// and path rules follow the target platform, not the host, so the Windows behaviour
// is testable anywhere. On Windows the variable is usually spelled `Path`, so the
// existing key is reused rather than adding a second `PATH`.

/** A copy of `baseEnv` with `dirs` (deduplicated, empty and "." dropped) in front of its PATH. */
export function prependToPath(
  baseEnv: NodeJS.ProcessEnv,
  dirs: readonly string[],
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const key = platform === 'win32'
    ? Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    : 'PATH';
  const front = dirs.filter((d, i) => d !== '' && d !== '.' && dirs.indexOf(d) === i);
  const existing = baseEnv[key];
  return { ...baseEnv, [key]: [...front, ...(existing ? [existing] : [])].join(p.delimiter) };
}
