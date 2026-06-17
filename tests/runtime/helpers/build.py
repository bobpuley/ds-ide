"""CMake build helpers for runtime integration tests."""
import os
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
EMU_DIR = os.path.join(REPO_ROOT, "emulator")

# DaisySP: prefer env-var, fall back to the known sibling-workspace path.
_DAISYSP_FALLBACK = os.path.join(
    os.path.dirname(REPO_ROOT),
    "documentation/DaisyExamples/DaisySP/Source",
)
DAISYSP_DIR = os.environ.get("DAISYSP_DIR", _DAISYSP_FALLBACK)


def cmake_build(effect_src: str, build_dir: str,
                daisysp_dir: str = "") -> bool:
    """Configure + build effect_emu from effect_src into build_dir.

    Returns True on success, prints errors and returns False on failure.
    """
    os.makedirs(build_dir, exist_ok=True)

    cmake_args = [
        "cmake", EMU_DIR,
        f"-DEFFECT_SRC={effect_src}",
        "-DCMAKE_BUILD_TYPE=Debug",
    ]
    if daisysp_dir and os.path.isdir(daisysp_dir):
        cmake_args.append(f"-DDAISYSP_DIR={daisysp_dir}")

    r = subprocess.run(cmake_args, cwd=build_dir,
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[build] cmake configure failed:\n{r.stderr}", file=sys.stderr)
        return False

    r = subprocess.run(["cmake", "--build", build_dir, "--parallel"],
                       cwd=build_dir, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"[build] cmake build failed:\n{r.stderr}", file=sys.stderr)
        return False

    return True
