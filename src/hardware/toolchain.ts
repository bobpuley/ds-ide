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

// Detect arm-none-eabi-gcc.
// configuredPath may be a full path to the binary or a bin directory.
// Detection order: configured setting → which → known Homebrew / system paths.
export function detectArmToolchain(
  configuredPath: string | undefined,
  existsSync: (p: string) => boolean = fs.existsSync,
  execSync: (cmd: string) => Buffer = cp.execSync,
): string | undefined {
  if (configuredPath) {
    const candidate = configuredPath.endsWith(ARM_GCC_BINARY)
      ? configuredPath
      : `${configuredPath.replace(/\/$/, '')}/${ARM_GCC_BINARY}`;
    if (existsSync(candidate)) return candidate;
  }

  try {
    const result = execSync(`which ${ARM_GCC_BINARY} 2>/dev/null`).toString().trim();
    if (result && existsSync(result)) return result;
  } catch { /* not on PATH */ }

  return ARM_GCC_CANDIDATES.find((p) => existsSync(p));
}

// Detect dfu-util. Detection order: which → known paths.
export function detectDfuUtil(
  existsSync: (p: string) => boolean = fs.existsSync,
  execSync: (cmd: string) => Buffer = cp.execSync,
): string | undefined {
  try {
    const result = execSync(`which ${DFU_UTIL_BINARY} 2>/dev/null`).toString().trim();
    if (result && existsSync(result)) return result;
  } catch { /* not on PATH */ }

  return DFU_UTIL_CANDIDATES.find((p) => existsSync(p));
}
