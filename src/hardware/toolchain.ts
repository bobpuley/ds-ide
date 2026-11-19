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

export const MAKE_BINARY = 'make';

// FR-WIN-TCH-1: install hints per platform. macOS and Linux keep the existing
// wording (the constants above); Windows names where each tool comes from.
const WIN_ARM_GCC_HINT =
  'Install the Arm GNU Toolchain for Windows (developer.arm.com/downloads/-/arm-gnu-toolchain-downloads, ' +
  '"arm-none-eabi"), or install the xPack build (xpm install --global @xpack-dev-tools/arm-none-eabi-gcc@latest). ' +
  'Add its bin directory to PATH, or set ds-ide.armToolchainPath.';
const WIN_DFU_UTIL_HINT =
  'Install dfu-util: download the Windows binaries from dfu-util.sourceforge.net and add them to PATH, ' +
  'or use Chocolatey (choco install dfu-util) or MSYS2 (pacman -S mingw-w64-x86_64-dfu-util).';
const WIN_MAKE_HINT =
  'Install make: MSYS2 (pacman -S make), Chocolatey (choco install make) or the xPack Windows Build Tools, ' +
  'and add its bin directory to PATH.';
const WIN_CMAKE_MESSAGE =
  'CMake not found. Run "Daisy IDE: Install Windows Toolchain" to download one, or install it yourself ' +
  '(cmake.org/download, or MSYS2: pacman -S mingw-w64-clang-x86_64-cmake) and add it to PATH, then try again.';
const WIN_CXX_COMPILER_MESSAGE =
  'No C++ compiler (clang) found. Run "Daisy IDE: Install Windows Toolchain" to download one, or install ' +
  'LLVM (llvm.org) or MSYS2 CLANG64 (pacman -S mingw-w64-clang-x86_64-clang), add its bin directory to PATH and try again.';

// FR-WIN-DBG-1: where lldb-dap lives, and what to do when it is missing.
export const LLDB_DAP_BINARY = 'lldb-dap';

export const LLDB_DAP_CANDIDATES = [
  '/Library/Developer/CommandLineTools/usr/bin/lldb-dap',
  '/usr/bin/lldb-dap',
  '/Applications/Xcode.app/Contents/Developer/usr/bin/lldb-dap',
];

// Debian/Ubuntu LLVM packages (apt.llvm.org and distro repos) install
// lldb-dap under a version-suffixed name alongside — or instead of — the
// unversioned symlink. Tried newest-first on PATH via `which` (FR-QA-EXT-9).
const LLDB_DAP_POSIX_PATH_NAMES = [
  'lldb-dap',
  'lldb-dap-20', 'lldb-dap-19', 'lldb-dap-18', 'lldb-dap-17',
  'lldb-dap-16', 'lldb-dap-15', 'lldb-dap-14',
];

const LINUX_LLDB_DAP_MESSAGE =
  'ds-ide: lldb-dap not found. Install LLDB from your package manager ' +
  '(for example: sudo apt install lldb) so that lldb-dap is on PATH.';
const WIN_LLDB_DAP_MESSAGE =
  'ds-ide: lldb-dap not found. Run "Daisy IDE: Install Windows Toolchain" to download one, or install ' +
  'LLVM (llvm.org, includes lldb-dap) or MSYS2 CLANG64 (pacman -S mingw-w64-clang-x86_64-lldb) and add its bin directory to PATH.';

export const lldbDapNotFoundMessage = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === 'win32') return WIN_LLDB_DAP_MESSAGE;
  return platform === 'darwin' ? LLDB_DAP_NOT_FOUND_MESSAGE : LINUX_LLDB_DAP_MESSAGE;
};

export const armGccInstallHint = (platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32' ? WIN_ARM_GCC_HINT : ARM_GCC_INSTALL_HINT);
export const dfuUtilInstallHint = (platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32' ? WIN_DFU_UTIL_HINT : DFU_UTIL_INSTALL_HINT);
export const makeInstallHint = (platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32'
    ? WIN_MAKE_HINT
    : 'Install make: on macOS run `xcode-select --install`; on Linux use your package manager (e.g. apt install make).');
export const cmakeNotFoundMessage = (platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32' ? WIN_CMAKE_MESSAGE : CMAKE_NOT_FOUND_MESSAGE);
export const cxxCompilerNotFoundMessage = (platform: NodeJS.Platform = process.platform): string =>
  (platform === 'win32' ? WIN_CXX_COMPILER_MESSAGE : CXX_COMPILER_NOT_FOUND_MESSAGE);

// Platform/environment overrides for tests; production passes none.
type Env = Pick<LocateOptions, 'platform' | 'env' | 'listDir'>;

// macOS/Linux known locations are the fixed lists above (their directories).
const dirsOf = (files: readonly string[]): string[] => files.map((f) => path.posix.dirname(f));

// ── Windows install locations (FR-WIN-TCH-1) ────────────────────────────────
// Built from the environment, never from a hard-coded user or drive; a
// variable that is not set simply contributes nothing. `*` is a versioned
// directory (see tool-locator.ts).
type WinEnv = NodeJS.ProcessEnv;

const joinWin = (base: string | undefined, ...parts: string[]): string[] =>
  (base ? [[base, ...parts].join('\\')] : []);

const programFiles = (env: WinEnv): string[] => [
  env['ProgramFiles'] ?? 'C:\\Program Files',
  env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
];
const msys2 = (env: WinEnv, ...subdirs: string[]): string[] =>
  subdirs.map((s) => `${env['SystemDrive'] ?? 'C:'}\\msys64\\${s}`);
const chocolatey = (env: WinEnv): string[] => joinWin(env['ProgramData'] ?? 'C:\\ProgramData', 'chocolatey', 'bin');
const scoop = (env: WinEnv): string[] => joinWin(env['USERPROFILE'], 'scoop', 'shims');
const winget = (env: WinEnv): string[] => joinWin(env['LOCALAPPDATA'], 'Microsoft', 'WinGet', 'Links');
const xpack = (env: WinEnv, pkg: string): string[] =>
  joinWin(env['APPDATA'], 'xPacks', '@xpack-dev-tools', pkg, '*', '.content', 'bin');

const windowsDirs: Record<string, (env: WinEnv) => string[]> = {
  [ARM_GCC_BINARY]: (env) => [
    ...programFiles(env).flatMap((pf) => [
      `${pf}\\Arm GNU Toolchain arm-none-eabi\\*\\bin`,
      `${pf}\\GNU Arm Embedded Toolchain\\*\\bin`,
      `${pf}\\GNU Tools Arm Embedded\\*\\bin`,
    ]),
    ...xpack(env, 'arm-none-eabi-gcc'),
    ...msys2(env, 'mingw64\\bin', 'ucrt64\\bin'),
    ...chocolatey(env), ...scoop(env),
  ],
  [DFU_UTIL_BINARY]: (env) => [
    ...programFiles(env).map((pf) => `${pf}\\dfu-util`),
    ...msys2(env, 'mingw64\\bin', 'ucrt64\\bin', 'clang64\\bin'),
    ...chocolatey(env), ...scoop(env), ...winget(env),
  ],
  [MAKE_BINARY]: (env) => [
    ...msys2(env, 'usr\\bin', 'mingw64\\bin'),
    ...chocolatey(env), ...scoop(env),
    ...xpack(env, 'windows-build-tools'),
    ...programFiles(env).map((pf) => `${pf}\\GnuWin32\\bin`),
  ],
  [CMAKE_BINARY]: (env) => [
    ...programFiles(env).map((pf) => `${pf}\\CMake\\bin`),
    ...msys2(env, 'clang64\\bin', 'ucrt64\\bin', 'mingw64\\bin'),
    ...chocolatey(env), ...scoop(env), ...winget(env),
  ],
  'clang++': (env) => [
    ...programFiles(env).map((pf) => `${pf}\\LLVM\\bin`),
    ...msys2(env, 'clang64\\bin'),
    ...scoop(env), ...winget(env),
  ],
  [LLDB_DAP_BINARY]: (env) => [
    ...programFiles(env).map((pf) => `${pf}\\LLVM\\bin`),
    ...msys2(env, 'clang64\\bin'),
    ...scoop(env), ...winget(env),
  ],
};

const knownDirsFor = (binary: string, posix: readonly string[]): ToolSpec['knownDirs'] =>
  (platform, env) => (platform === 'win32' ? windowsDirs[binary]!(env) : dirsOf(posix));

const ARM_GCC_SPEC: ToolSpec = { binary: ARM_GCC_BINARY, knownDirs: knownDirsFor(ARM_GCC_BINARY, ARM_GCC_CANDIDATES) };
const DFU_UTIL_SPEC: ToolSpec = { binary: DFU_UTIL_BINARY, knownDirs: knownDirsFor(DFU_UTIL_BINARY, DFU_UTIL_CANDIDATES) };
const CMAKE_SPEC: ToolSpec = { binary: CMAKE_BINARY, knownDirs: knownDirsFor(CMAKE_BINARY, CMAKE_CANDIDATES) };
// macOS/Linux: make is on PATH, or the system one in /usr/bin.
const MAKE_SPEC: ToolSpec = { binary: MAKE_BINARY, knownDirs: knownDirsFor(MAKE_BINARY, ['/usr/bin/make']) };
// Windows only: macOS locates its compiler through xcode-select instead.
const CLANGXX_SPEC: ToolSpec = { binary: 'clang++', knownDirs: knownDirsFor('clang++', []) };

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

// Detect lldb-dap (FR-WIN-DBG-1). PATH → known paths: on Windows the clang/MinGW
// toolchain (LLVM, MSYS2 CLANG64), on macOS/Linux the Command Line Tools /
// Xcode locations and the versioned Debian/Ubuntu names. The macOS `xcrun`
// lookup, which respects the active Xcode selection, stays in debug-adapter.ts.
export async function detectLldbDap(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  const windows = (env.platform ?? process.platform) === 'win32';
  const spec: ToolSpec = {
    binary: LLDB_DAP_BINARY,
    pathNames: windows ? [LLDB_DAP_BINARY] : LLDB_DAP_POSIX_PATH_NAMES,
    knownDirs: knownDirsFor(LLDB_DAP_BINARY, LLDB_DAP_CANDIDATES),
  };
  return locateTool(spec, undefined, { ...env, exists, exec });
}

// Detect make (FR-WIN-TCH-2). PATH → known paths. Stock Windows has none.
export async function detectMake(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  return locateTool(MAKE_SPEC, undefined, { ...env, exists, exec });
}

// Detect a C++ compiler (FR-PRE-1). On Windows that is clang++ (the toolchain
// is clang/MinGW): PATH → LLVM / MSYS2 CLANG64. On macOS the developer
// directory `xcode-select -p` reports, then the known Command Line Tools
// location; the compiler is looked up inside that directory rather than via
// `which`, because a bare macOS has /usr/bin/clang++ as an installer stub.
export async function detectCxxCompiler(
  exists: Exists = defaultExists,
  exec: Exec = defaultExec,
  env: Env = {},
): Promise<string | undefined> {
  if ((env.platform ?? process.platform) === 'win32') {
    return locateTool(CLANGXX_SPEC, undefined, { ...env, exists, exec });
  }
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
