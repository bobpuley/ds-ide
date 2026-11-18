import * as path from 'path';
import {
  locateTool, defaultExists, defaultExec,
  type ToolSpec, type Exists, type Exec, type LocateOptions,
} from './tool-locator';

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

// FR-PRE-1: shown when the emulator build finds no C++ compiler. On macOS that
// is the Xcode Command Line Tools; /usr/bin/clang++ exists as a stub without
// them, so it cannot be used as evidence of a compiler.
export const CXX_COMPILER_NOT_FOUND_MESSAGE =
  'Xcode Command Line Tools not found. Run `xcode-select --install` and try again.';

// FR-PRE-1: shown when Debug Daisy Effect cannot find lldb-dap.
export const LLDB_DAP_NOT_FOUND_MESSAGE =
  'ds-ide: lldb-dap not found. Install Xcode Command Line Tools: xcode-select --install';

const CLT_DEVELOPER_DIR = '/Library/Developer/CommandLineTools';

// FR-PRE-3: shown when Build for Hardware finds no Makefile in the project root.
export const NO_MAKEFILE_MESSAGE =
  'No Makefile in this project. Build for Hardware needs a libDaisy-style project; see Limitations in the README.';

export const DFU_UTIL_BINARY = 'dfu-util';

export const DFU_UTIL_CANDIDATES = [
  '/opt/homebrew/bin/dfu-util',
  '/usr/local/bin/dfu-util',
  '/usr/bin/dfu-util',
];

export const DFU_UTIL_INSTALL_HINT =
  'Install dfu-util: brew install dfu-util';

// Platform/environment overrides for tests; production passes none.
type Env = Pick<LocateOptions, 'platform' | 'env' | 'listDir'>;

// macOS/Linux known locations are the fixed lists above (their directories);
// Windows locations are added per tool in FR-WIN-TCH-1.
const dirsOf = (files: readonly string[]): string[] => files.map((f) => path.posix.dirname(f));

const ARM_GCC_SPEC: ToolSpec = {
  binary: ARM_GCC_BINARY,
  knownDirs: (platform) => (platform === 'win32' ? [] : dirsOf(ARM_GCC_CANDIDATES)),
};

const DFU_UTIL_SPEC: ToolSpec = {
  binary: DFU_UTIL_BINARY,
  knownDirs: (platform) => (platform === 'win32' ? [] : dirsOf(DFU_UTIL_CANDIDATES)),
};

const CMAKE_SPEC: ToolSpec = {
  binary: CMAKE_BINARY,
  knownDirs: (platform) => (platform === 'win32' ? [] : dirsOf(CMAKE_CANDIDATES)),
};

// Detect arm-none-eabi-gcc.
// configuredPath may be a full path to the binary or a bin directory.
// Detection order: configured setting → PATH → known install locations.
export async function detectArmToolchain(
  configuredPath: string | undefined,
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  return locateTool(ARM_GCC_SPEC, configuredPath, { ...env, exists, exec });
}

// Detect dfu-util. Detection order: PATH → known paths.
export async function detectDfuUtil(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  return locateTool(DFU_UTIL_SPEC, undefined, { ...env, exists, exec });
}

// Detect cmake (FR-REL-2). Detection order: PATH → known paths, so a CMake
// the user already put on PATH always wins and the known locations only cover
// an editor started without the shell's PATH (e.g. launched from the Dock).
export async function detectCMake(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  return locateTool(CMAKE_SPEC, undefined, { ...env, exists, exec });
}

// Detect a C++ compiler (FR-PRE-1). Detection order: the developer directory
// `xcode-select -p` reports, then the known Command Line Tools location. The
// compiler is looked up inside that directory rather than via `which`, because
// a bare macOS has /usr/bin/clang++ as an installer stub.
export async function detectCxxCompiler(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
): Promise<string | undefined> {
  const dirs: string[] = [];
  try {
    const dir = (await exec('xcode-select', ['-p'])).trim();
    if (dir) dirs.push(dir);
  } catch { /* no developer tools selected */ }
  dirs.push(CLT_DEVELOPER_DIR);

  for (const dir of dirs) {
    const candidate = `${dir.replace(/\/$/, '')}/usr/bin/clang++`;
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}
