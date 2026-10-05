#!/usr/bin/env python3
"""Build-flag unit test for M41 / FR-QA-EMU-8.

Configures the emulator CMake project with CMAKE_EXPORT_COMPILE_COMMANDS=ON
and inspects the generated compile_commands.json to verify:

  - the effect object (EFFECT_SRC) still compiles at -O0 -g
  - the runtime/shim sources compile at -O2 -g
  - -Wextra and -Wshadow are present for BOTH the effect object and the
    runtime/shim sources
  - every runtime/shim .cpp in the tree has a compile entry (FR-WIN-BLD-4:
    the source list here is derived from the tree, so it always matches
    the CMake list on this platform)
  - the CMake platform split: audio_device_factory.cpp is common and
    core_audio_device.cpp Apple-only (FR-WIN-AUD-1), ipc_server.cpp and the TCP transport are
    common, the Unix-socket transport is built only off Windows
    (FR-WIN-IPC-1), Winsock is linked on Windows, libm only off Windows,
    TSan is rejected on Windows (FR-WIN-BLD-4)

This is a property of the generated build graph, not runtime behavior, so a
compile-commands inspection is the direct way to test it (rather than timing
a build or grepping raw compiler stdout).

Exit code: 0 = all checks pass, 1 = any failure.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
EMU_DIR = os.path.join(REPO_ROOT, "emulator")
EFFECT_SRC = os.path.join(
    REPO_ROOT, "daisy-seed-knowledge/examples/bypass/bypass.cpp")

CMAKELISTS = os.path.join(EMU_DIR, "CMakeLists.txt")


def tree_sources(subdir):
    d = os.path.join(EMU_DIR, subdir)
    return {f for f in os.listdir(d) if f.endswith(".cpp")}


RUNTIME_BASENAMES = tree_sources("runtime")
# FR-WIN-AUD-1: the CoreAudio backend is built only on Apple platforms; every
# other platform builds audio_device_factory.cpp's NullAudioDevice instead.
if sys.platform != "darwin":
    RUNTIME_BASENAMES.discard("core_audio_device.cpp")
SHIM_BASENAMES = tree_sources("shim/src")

failures = 0


def check(cond, msg):
    global failures
    if cond:
        print(f"  PASS  {msg}")
    else:
        print(f"  FAIL  {msg}")
        failures += 1


def check_platform_split():
    """FR-WIN-BLD-4: text checks on the CMake platform branches. The Windows
    side is exercised for real by the windows-ci emulator-compile job."""
    with open(CMAKELISTS) as f:
        cm = f.read()
    common = re.search(r"set\(RUNTIME_SRC\b(.*?)\)", cm, re.S)
    for name in ("ipc_server.cpp", "ipc_transport_socket.cpp", "ipc_transport_tcp.cpp"):
        check(common is not None and name in common.group(1),
              f"{name} is in the platform-independent RUNTIME_SRC list (FR-WIN-IPC-1)")
    check(common is not None and "audio_device_factory.cpp" in common.group(1),
          "audio_device_factory.cpp is in the platform-independent RUNTIME_SRC list (FR-WIN-AUD-1)")
    check(common is not None and "core_audio_device.cpp" not in common.group(1),
          "core_audio_device.cpp is not in the platform-independent RUNTIME_SRC list")
    check(re.search(r"if\(APPLE\)\s*\n\s*list\(APPEND RUNTIME_SRC\s+\"[^\"]*/runtime/core_audio_device\.cpp\"\)", cm) is not None,
          "the CoreAudio backend is appended only on Apple platforms (FR-WIN-AUD-1)")
    check(common is not None and "ipc_transport_unix.cpp" not in common.group(1),
          "ipc_transport_unix.cpp is not in the platform-independent RUNTIME_SRC list")
    check(re.search(r"if\(NOT WIN32\)\s*\n\s*list\(APPEND RUNTIME_SRC\s+\"[^\"]*/runtime/ipc_transport_unix\.cpp\"\)", cm) is not None,
          "the Unix-socket transport is appended only off Windows (FR-WIN-IPC-1)")
    check(re.search(r"if\(TSAN AND WIN32\)\s*\n\s*message\(FATAL_ERROR", cm) is not None,
          "TSan is rejected with a clear error on Windows")
    check(re.search(r"if\(WIN32\)[^\n]*\n(?:[^\n]*\n){0,4}?\s*target_link_libraries\(effect_emu PRIVATE[^)]*\bws2_32\b", cm) is not None,
          "Winsock (ws2_32) is linked on Windows")
    check(re.search(r"target_link_libraries\(effect_emu PRIVATE Threads::Threads m\)", cm) is None,
          "libm is not linked unconditionally")


def main():
    check_platform_split()
    build_dir = tempfile.mkdtemp()
    try:
        configure = subprocess.run(
            ["cmake", EMU_DIR, f"-DEFFECT_SRC={EFFECT_SRC}",
             "-DCMAKE_BUILD_TYPE=Debug", "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"],
            cwd=build_dir, capture_output=True, text=True)
        if configure.returncode != 0:
            print(f"cmake configure failed:\n{configure.stderr}", file=sys.stderr)
            sys.exit(1)

        build = subprocess.run(["cmake", "--build", build_dir, "--parallel"],
                                cwd=build_dir, capture_output=True, text=True)
        check(build.returncode == 0, "the project still builds successfully")
        if build.returncode != 0:
            print(build.stdout, file=sys.stderr)
            print(build.stderr, file=sys.stderr)

        cc_path = os.path.join(build_dir, "compile_commands.json")
        with open(cc_path) as f:
            entries = json.load(f)

        effect_entries = [e for e in entries if e["file"] == EFFECT_SRC]
        check(len(effect_entries) == 1, "exactly one compile entry for EFFECT_SRC")
        if effect_entries:
            cmd = effect_entries[0]["command"]
            check("-O0" in cmd.split(), "effect_obj (EFFECT_SRC) still compiles at -O0")
            check("-O2" not in cmd.split(), "effect_obj (EFFECT_SRC) does not compile at -O2")
            check("-Wextra" in cmd.split(), "effect_obj (EFFECT_SRC) gains -Wextra")
            check("-Wshadow" in cmd.split(), "effect_obj (EFFECT_SRC) gains -Wshadow")

        runtime_shim_entries = [
            e for e in entries
            if os.path.basename(e["file"]) in RUNTIME_BASENAMES | SHIM_BASENAMES
        ]
        expected = RUNTIME_BASENAMES | SHIM_BASENAMES
        compiled = {os.path.basename(e["file"]) for e in runtime_shim_entries}
        check(compiled == expected and len(runtime_shim_entries) == len(expected),
              f"exactly one compile entry for each of the {len(expected)} runtime/shim sources in the tree")
        if compiled != expected:
            print(f"    missing from build: {sorted(expected - compiled)}", file=sys.stderr)
        for e in runtime_shim_entries:
            cmd = e["command"].split()
            name = os.path.basename(e["file"])
            check("-O2" in cmd, f"{name} compiles at -O2")
            check("-Wextra" in cmd, f"{name} gains -Wextra")
            check("-Wshadow" in cmd, f"{name} gains -Wshadow")
    finally:
        shutil.rmtree(build_dir, ignore_errors=True)

    print(f"\nResult: {'all passed' if failures == 0 else 'FAILURES'}")
    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
