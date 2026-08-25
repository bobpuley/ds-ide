/// <reference lib="dom" />
import type { OledHostMessage } from './messages';
import { decodeOledFrame, computeFrameRate } from './oled-frame';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const vscode = acquireVsCodeApi();
const canvas = el<HTMLCanvasElement>('oled');
const ctx = canvas.getContext('2d')!;
const footEl = el<HTMLElement>('oled-foot');

const WIDTH = 128;
const HEIGHT = 64;
const MAX_TIMESTAMPS = 120;

let currentBus: string | null = null;
const frameTimestamps: number[] = [];

function updateFoot(): void {
  const fps = computeFrameRate(frameTimestamps, 1000);
  footEl.textContent = 'SSD1306 · ' + WIDTH + '×' + HEIGHT + ' · ' + (currentBus ?? '—') + ' · ' + fps.toFixed(0) + ' fps';
}

// SSD1306 GDDRAM layout: one byte per 8 vertically-stacked pixels ("page"),
// height/8 pages of width bytes each — matches the shim's DrawPixel/Update
// layout exactly (emulator/shim/include/daisy/oled_display.h). Decoded here
// rather than assumed, so a future panel change can't silently disagree with
// the shim about pixel addressing.
function drawFrame(bytes: Uint8Array): void {
  const imageData = ctx.createImageData(WIDTH, HEIGHT);
  const pages = HEIGHT / 8;
  for (let page = 0; page < pages; page++) {
    for (let x = 0; x < WIDTH; x++) {
      const byte = bytes[page * WIDTH + x] ?? 0;
      for (let bit = 0; bit < 8; bit++) {
        const on = (byte & (1 << bit)) !== 0;
        const y = page * 8 + bit;
        const idx = (y * WIDTH + x) * 4;
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

window.addEventListener('message', (e: MessageEvent<OledHostMessage>) => {
  const msg = e.data;
  if (msg.command === 'oledFrame') {
    const bytes = decodeOledFrame(msg.data);
    if (bytes === null) {
      footEl.textContent = 'SSD1306 \xb7 frame decode error';
      return;
    }
    drawFrame(bytes);
    frameTimestamps.push(performance.now());
    if (frameTimestamps.length > MAX_TIMESTAMPS) frameTimestamps.shift();
    updateFoot();
  } else if (msg.command === 'oledBus') {
    currentBus = msg.bus;
    updateFoot();
  }
});

vscode.postMessage({ command: 'webviewReady' });
