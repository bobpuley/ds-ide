#!/usr/bin/env python3
"""Build-flag unit test for M41 / FR-QA-EMU-8.

Configures the emulator CMake project with CMAKE_EXPORT_COMPILE_COMMANDS=ON
and inspects the generated compile_commands.json to verify:

  - the effect object (EFFECT_SRC) still compiles at -O0 -g
  - the runtime/shim sources compile at -O2 -g
  - -Wextra and -Wshadow are present for BOTH the effect object and the
    runtime/shim sources

This is a property of the generated build graph, not runtime behavior, so a
compile-commands inspection is the direct way to test it (rather than timing
a build or grepping raw compiler stdout).

Exit code: 0 = all checks pass, 1 = any failure.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
EMU_DIR = os.path.join(REPO_ROOT, "emulator")
EFFECT_SRC = os.path.join(
    REPO_ROOT, "daisy-seed-knowledge/examples/bypass/bypass.cpp")

RUNTIME_BASENAMES = {
    "main.cpp", "audio_engine.cpp", "core_audio_device.cpp",
    "ipc_server.cpp", "wav_reader.cpp", "session_recorder.cpp",
    "session_player.cpp", "platform_file.cpp",
}
SHIM_BASENAMES = {
    "daisy_seed.cpp", "adc_handle.cpp", "system.cpp", "switch.cpp", "led.cpp",
}

failures = 0


def check(cond, msg):
    global failures
    if cond:
        print(f"  PASS  {msg}")
    else:
        print(f"  FAIL  {msg}")
        failures += 1


def main():
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
        expected_count = len(RUNTIME_BASENAMES | SHIM_BASENAMES)
        check(len(runtime_shim_entries) == expected_count,
              f"a compile entry exists for all {expected_count} runtime/shim sources")
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
