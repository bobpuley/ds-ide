import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// FR-WIN-BLD-1: a CI workflow runs the TypeScript unit tests on a Windows
// runner. Checked as text so the test needs no YAML dependency.
const WORKFLOW = path.join(__dirname, '../../../../.github/workflows/windows-ci.yml');

describe('Windows CI workflow (FR-WIN-BLD-1)', () => {
  const yml = fs.existsSync(WORKFLOW) ? fs.readFileSync(WORKFLOW, 'utf8') : '';

  it('exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  it('runs on pushes and pull requests to main', () => {
    expect(yml).toMatch(/^\s*push:\s*\n\s*branches:[^\n]*\n?[^\n]*main/m);
    expect(yml).toMatch(/^\s*pull_request:\s*\n\s*branches:[^\n]*\n?[^\n]*main/m);
  });

  it('runs on a Windows runner', () => {
    expect(yml).toMatch(/runs-on:\s*windows-latest/);
  });

  it('installs without lifecycle scripts, so the macOS-only midi rebuild is not attempted', () => {
    expect(yml).toMatch(/npm ci --ignore-scripts/);
  });

  it('runs the vitest unit suite and lets a failure fail the job', () => {
    expect(yml).toMatch(/run:\s*npm test\b/);
    expect(yml).not.toMatch(/continue-on-error:\s*true/);
  });
});

describe('Windows emulator compile check (FR-WIN-BLD-2..4)', () => {
  const yml = fs.existsSync(WORKFLOW) ? fs.readFileSync(WORKFLOW, 'utf8') : '';

  it('uses the clang/MinGW (MSYS2 CLANG64) toolchain', () => {
    expect(yml).toMatch(/msys2\/setup-msys2@v2/);
    expect(yml).toMatch(/msystem:\s*CLANG64/);
  });

  it.each([
    'emulator/runtime/wav_reader.cpp',
    'emulator/runtime/session_player.cpp',
    'emulator/runtime/session_recorder.cpp',
    'emulator/runtime/platform_file.cpp',
    'emulator/shim/src/fatfs_host.cpp',
  ])('compiles %s for Windows (FR-WIN-BLD-2)', (src) => {
    expect(yml).toContain(src);
  });

  it('compiles emulator/runtime/main.cpp for Windows (FR-WIN-BLD-3)', () => {
    expect(yml).toContain('emulator/runtime/main.cpp');
  });

  it('configures the emulator CMake project with Ninja and a tracked effect fixture (FR-WIN-BLD-4)', () => {
    expect(yml).toMatch(/mingw-w64-clang-x86_64-cmake/);
    expect(yml).toMatch(/mingw-w64-clang-x86_64-ninja/);
    expect(yml).toMatch(/cmake -S emulator -B [^\s]+ -G Ninja\b/);
    expect(yml).toMatch(/-DEFFECT_SRC="\$\(cygpath -m "\$PWD"\)\/tests\/runtime\/fixtures\/passthrough\.cpp"/);
  });

  it('builds and links the full effect_emu (FR-WIN-IPC-1)', () => {
    expect(yml).toMatch(/run: cmake --build build-win\s*$/m);
    expect(yml).not.toMatch(/--target runtime_shim_obj effect_obj/);
  });

  it('runs the TCP transport runtime test as the Windows smoke test (FR-WIN-IPC-1)', () => {
    expect(yml).toMatch(/mingw-w64-clang-x86_64-python/);
    expect(yml).toMatch(/CMAKE_GENERATOR:\s*Ninja/);
    expect(yml).toMatch(/python tests\/runtime\/test_tcp_transport\.py/);
  });

  it('asserts TSan configuration is rejected on Windows (FR-WIN-BLD-4)', () => {
    expect(yml).toMatch(/-DTSAN=ON/);
  });
});
