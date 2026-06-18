"""Integration test — virtual buttons + LED (AC-11 / M10).

Drives the `button_bypass` fixture through the real runtime:
  - button released → output muted; pressed → sine input passes through
    (AC-11a: a button press visibly changes the effect output);
  - the effect's hw.SetLed(pressed) emits `led {gpioPin:23, lit}` messages
    (AC-11b: lighting a declared LED drives the indicator).

Bare libDaisy fixture (no DaisySP) so the test never skips.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "helpers"))
from build import cmake_build, REPO_ROOT
from runner import run_emulator

FIXTURE   = os.path.join(REPO_ROOT, "tests/runtime/fixtures/button_bypass.cpp")
BUILD_DIR = os.path.join(REPO_ROOT, ".ds-ide/build/test-buttons")
SOCKET    = "/tmp/daisy_emu_buttons_test.sock"

BUTTON_PIN = 28
LED_PIN    = 23


def build() -> str:
    assert cmake_build(FIXTURE, BUILD_DIR), "button_bypass build failed"
    exe = os.path.join(BUILD_DIR, "effect_emu")
    assert os.path.isfile(exe), f"effect_emu not found at {exe}"
    return exe


def collect(client, n_scope: int, budget: int = 600):
    """Collect up to n_scope scope frames; also return any led messages seen."""
    scope, leds = [], []
    for _ in range(budget):
        msg = client.recv_one()
        t = msg.get("type")
        if t == "scope":
            scope.append(msg)
            if len(scope) >= n_scope:
                break
        elif t == "led":
            leds.append(msg)
    return scope, leds


def out_mean_abs(frames) -> float:
    samples = [s for f in frames for s in f.get("out", [])]
    return sum(abs(s) for s in samples) / len(samples) if samples else 0.0


def test_button_and_led(exe: str) -> None:
    with run_emulator(exe, SOCKET) as client:
        client.send({"type": "config", "sampleRate": 48000, "blockSize": 48})
        client.send({"type": "transport", "action": "start"})

        # Button released → muted output; LED off.
        scope, leds = collect(client, n_scope=6)
        muted = out_mean_abs(scope[-4:])
        assert muted < 0.01, f"output should be muted when button released, got {muted:.4f}"
        assert any(m.get("gpioPin") == LED_PIN and m.get("lit") is False for m in leds), (
            "expected a led{pin:23,lit:false} on startup (SetLed(false))"
        )
        print(f"  PASS  released → muted (mean_abs={muted:.4f}) + LED off")

        # Press the button → audio passes through; LED on (AC-11a + AC-11b).
        client.send({"type": "button", "gpioPin": BUTTON_PIN, "pressed": True})
        scope, leds = collect(client, n_scope=30)
        active = out_mean_abs(scope[-4:])
        assert active > 0.05, f"output should pass audio when pressed, got {active:.4f}"
        assert any(m.get("gpioPin") == LED_PIN and m.get("lit") is True for m in leds), (
            "expected a led{pin:23,lit:true} after button press"
        )
        print(f"  PASS  pressed → audio passes (mean_abs={active:.4f}) + LED on")

        # Release → muted again; LED off.
        client.send({"type": "button", "gpioPin": BUTTON_PIN, "pressed": False})
        scope, leds = collect(client, n_scope=30)
        muted2 = out_mean_abs(scope[-4:])
        assert muted2 < 0.01, f"output should mute again on release, got {muted2:.4f}"
        assert any(m.get("gpioPin") == LED_PIN and m.get("lit") is False for m in leds), (
            "expected a led{pin:23,lit:false} after button release"
        )
        print(f"  PASS  released → muted again (mean_abs={muted2:.4f}) + LED off")

        assert active > muted * 50 if muted > 0 else active > 0.05, (
            "pressed output must be clearly louder than released"
        )


def main() -> int:
    print("=== test_buttons (AC-11 virtual button + LED) ===")
    exe = build()
    test_button_and_led(exe)
    return 0


if __name__ == "__main__":
    sys.exit(main())
