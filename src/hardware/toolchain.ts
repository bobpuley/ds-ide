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

export const DFU_UTIL_BINARY = 'dfu-util';

export const DFU_UTIL_CANDIDATES = [
  '/opt/homebrew/bin/dfu-util',
  '/usr/local/bin/dfu-util',
  '/usr/bin/dfu-util',
];

export const DFU_UTIL_INSTALL_HINT =
  'Install dfu-util: brew install dfu-util';

type Exists = (p: string) => Promise<boolean>;
type Exec   = (cmd: string) => Promise<string>;

const defaultExists: Exists = async (p) => {
  try { await fs.promises.access(p); return true; } catch { return false; }
};

const defaultExec: Exec = (cmd) =>
  new Promise<string>((resolve, reject) =>
    cp.exec(cmd, (err, stdout) => (err ? reject(err) : resolve(stdout)))
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
    const result = (await exec(`which ${ARM_GCC_BINARY} 2>/dev/null`)).trim();
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
    const result = (await exec(`which ${DFU_UTIL_BINARY} 2>/dev/null`)).trim();
    if (result && await exists(result)) return result;
  } catch { /* not on PATH */ }

  for (const p of DFU_UTIL_CANDIDATES) {
    if (await exists(p)) return p;
  }
  return undefined;
}
