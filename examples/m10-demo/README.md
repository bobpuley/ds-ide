# M10 demo — buttons, GPIO & LEDs

A tiny project to manually exercise the M10 features in the emulator.

## Files
- `m10_demo.cpp` — the effect (pot + toggle button + momentary button + 2 LEDs).
- `controllers.yaml` — the control map (pots / buttons / leds sections).

## What it does
| Control | Pin | Behaviour |
|---------|-----|-----------|
| Volume pot | ADC0 | Scales output level |
| Bypass button | 28 | **Toggle** — click to pass audio (on) or mute (off) |
| Boost button | 25 | **Momentary** — full level while held |
| Status LED | 23 | Onboard LED (`hw.SetLed`) — lit while audio is passing |
| Boost LED | 18 | External LED (`Led` class) — lit while Boost is held |

## How to try it
1. Open this folder as the workspace (so `controllers.yaml` is at the root).
2. **Daisy IDE: Build for Emulator**, then **Deploy to Emulator** — the scope
   panel shows the Volume slider, the two buttons, and the two LED indicators.
3. **Start Audio** (sine input by default).
4. Click **Bypass** → audio appears on the scope and the **Status** LED lights.
   Click again → muted, LED off.
5. Hold **Boost** → output jumps to full level and the **Boost** LED lights;
   release → it drops back to the pot-controlled level.
6. Drag **Volume** → output amplitude tracks it (while Bypass is on, Boost off).

The same behaviour is covered automatically by `tests/runtime/test_buttons.py`
(AC-11).
