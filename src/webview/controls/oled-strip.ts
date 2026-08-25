/// <reference lib="dom" />
// OLED live preview strip (FR-CE-2), extracted from controls-webview.ts
// (FR-EXT-32) — owns its own bus/frame-timestamp state.
import type { ControlsWebviewMessage } from '../messages';
import { decodeOledFrame, computeFrameRate } from '../oled-frame';

export interface OledStrip {
  applyEnabled(enabled: boolean, bus: string | null): void;
  applyFrame(data: string): void;
}

export function createOledStrip(vscode: { postMessage(msg: ControlsWebviewMessage): void }): OledStrip {
  const OLED_STRIP_WIDTH = 128;
  const OLED_STRIP_HEIGHT = 64;
  const OLED_STRIP_MAX_TIMESTAMPS = 120;
  let oledBus: string | null = null;
  const oledFrameTimestamps: number[] = [];

  function updateOledStripFoot(): void {
    const footEl = document.getElementById('oled-strip-foot');
    if (!footEl) return;
    const fps = computeFrameRate(oledFrameTimestamps, 1000);
    footEl.textContent = 'SSD1306 \xb7 ' + OLED_STRIP_WIDTH + '\xd7' + OLED_STRIP_HEIGHT + ' \xb7 ' + (oledBus ?? '—') + ' \xb7 ' + fps.toFixed(0) + ' fps';
  }

  // SSD1306 GDDRAM layout — mirrors oled-webview.ts's drawFrame (one byte per
  // 8 vertically-stacked pixels, height/8 pages of width bytes each). Kept
  // local rather than shared so the docked strip doesn't pull the standalone
  // OLED panel's bundle in as a dependency.
  function drawOledStripFrame(bytes: Uint8Array): void {
    const canvas = document.getElementById('oled-strip-canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.createImageData(OLED_STRIP_WIDTH, OLED_STRIP_HEIGHT);
    const pages = OLED_STRIP_HEIGHT / 8;
    for (let page = 0; page < pages; page++) {
      for (let x = 0; x < OLED_STRIP_WIDTH; x++) {
        const byte = bytes[page * OLED_STRIP_WIDTH + x] ?? 0;
        for (let bit = 0; bit < 8; bit++) {
          const on = (byte & (1 << bit)) !== 0;
          const y = page * 8 + bit;
          const idx = (y * OLED_STRIP_WIDTH + x) * 4;
          const v = on ? 255 : 0;
          imageData.data[idx] = v;
          imageData.data[idx + 1] = v;
          imageData.data[idx + 2] = v;
          imageData.data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  document.getElementById('oled-popout-btn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'oledPopOut' });
  });

  return {
    applyEnabled(enabled: boolean, bus: string | null): void {
      oledBus = bus;
      const strip = document.getElementById('oled-strip');
      if (strip) strip.classList.toggle('enabled', enabled);
      updateOledStripFoot();
    },
    applyFrame(data: string): void {
      const bytes = decodeOledFrame(data);
      if (bytes === null) {
        const footEl = document.getElementById('oled-strip-foot');
        if (footEl) footEl.textContent = 'SSD1306 \xb7 frame decode error';
        return;
      }
      drawOledStripFrame(bytes);
      oledFrameTimestamps.push(performance.now());
      if (oledFrameTimestamps.length > OLED_STRIP_MAX_TIMESTAMPS) oledFrameTimestamps.shift();
      updateOledStripFoot();
    },
  };
}
