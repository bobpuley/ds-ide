import * as cp from 'child_process';
import * as fs from 'fs';

export const ARM_GCC_BINARY = 'arm-none-eabi-gcc';

export const ARM_GCC_CANDIDATES = [
  '/opt/homebrew/bin/arm-none-eabi-gcc',  // Homebrew on Apple Silicon
  '/usr/local/bin/arm-none-eabi-gcc',      // Homebrew on Intel / manual
  '/usr/bin/arm-none-eabi-gcc',            // system package manager
];

export const ARM_GCC_INSTALL_HINT =
  'Install the ARM embedded toolchain: brew install arm-none-eabi-gcc  ' +
  'or download from developer.arm.com/downloads/-/arm-gnu-toolchain-downloads';

export const CMAKE_BINARY = 'cmake';

export const CMAKE_CANDIDATES = [
  '/opt/homebrew/bin/cmake',  // Homebrew on Apple Silicon
  '/usr/local/bin/cmake',     // Homebrew on Intel / manual
];

export const CMAKE_INSTALL_HINT = 'Install CMake: brew install cmake';

// FR-REL-2: shown when the emulator build cannot find (or start) CMake.
export const CMAKE_NOT_FOUND_MESSAGE =
  'CMake not found. Install it (brew install cmake) and try again.';

export const DFU_UTIL_BINARY = 'dfu-util';

export const DFU_UTIL_CANDIDATES = [
  '/opt/homebrew/bin/dfu-util',
  '/usr/local/bin/dfu-util',
  '/usr/bin/dfu-util',
];

export const DFU_UTIL_INSTALL_HINT =
  'Install dfu-util: brew install dfu-util';

type Exists = (p: string) => Promise<boolean>;
type Exec   = (cmd: string, args: string[]) => Promise<string>;

const defaultExists: Exists = async (p) => {
  try { await fs.promises.access(p); return true; } catch { return false; }
};

// execFile (not exec) — no shell is involved, so binary/arg strings can't be
// reinterpreted as shell metacharacters.
const defaultExec: Exec = (cmd, args) =>
  new Promise<string>((resolve, reject) =>
    cp.execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  );

// Detect arm-none-eabi-gcc.
// configuredPath may be a full path to the binary or a bin directory.
// Detection order: configured setting → which → known Homebrew / system paths.
export async function detectArmToolchain(
  configuredPath: string | undefined,
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
): Promise<string | undefined> {
  if (configuredPath) {
    const candidate = configuredPath.endsWith(ARM_GCC_BINARY)
      ? configuredPath
      : `${configuredPath.replace(/\/$/, '')}/${ARM_GCC_BINARY}`;
    if (await exists(candidate)) return candidate;
  }

  try {
    const result = (await exec('which', [ARM_GCC_BINARY])).trim();
    if (result && await exists(result)) return result;
  } catch { /* not on PATH */ }

  for (const p of ARM_GCC_CANDIDATES) {
    if (await exists(p)) return p;
  }
  return undefined;
}

// Detect dfu-util. Detection order: which → known paths.
export async function detectDfuUtil(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
): Promise<string | undefined> {
  try {
    const result = (await exec('which', [DFU_UTIL_BINARY])).trim();
    if (result && await exists(result)) return result;
  } catch { /* not on PATH */ }

  for (const p of DFU_UTIL_CANDIDATES) {
    if (await exists(p)) return p;
  }
  return undefined;
}

// Detect cmake (FR-REL-2). Detection order: which → known paths, so a CMake
// the user already put on PATH always wins and the known locations only cover
// an editor started without the shell's PATH (e.g. launched from the Dock).
export async function detectCMake(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
): Promise<string | undefined> {
  try {
    const result = (await exec('which', [CMAKE_BINARY])).trim();
    if (result && await exists(result)) return result;
  } catch { /* not on PATH */ }

  for (const p of CMAKE_CANDIDATES) {
    if (await exists(p)) return p;
  }
  return undefined;
}
