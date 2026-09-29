import * as cp from 'child_process';
import { detectDfuUtil } from './toolchain';
import type { BoardInfo } from '../transport/transport-state';

export interface DfuDevice {
  /** USB vendor:product, e.g. `0483:df11`. */
  usbId: string;
  path: string;
  serial: string;
}

// The STM32 system bootloader's DFU id — what a Daisy Seed enumerates as
// after BOOT + RESET.
const DAISY_DFU_USB_ID = '0483:df11';

// e.g. Found DFU: [0483:df11] ver=0200, devnum=12, cfg=1, intf=0, path="20-2", alt=0, name="…", serial="…"
const FOUND_DFU_RE = /^Found DFU: \[([0-9a-f]{4}:[0-9a-f]{4})\].*?\bpath="([^"]*)".*?\bserial="([^"]*)"/i;

// FR-TRN-7: pure parse of `dfu-util -l`. One device lists one line per alt
// setting, so lines are collapsed by (usb id, path, serial).
export function parseDfuList(stdout: string): DfuDevice[] {
  const devices: DfuDevice[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const m = FOUND_DFU_RE.exec(line.trim());
    if (!m) continue;
    const device = { usbId: m[1]!.toLowerCase(), path: m[2]!, serial: m[3]! };
    const key = `${device.usbId}|${device.path}|${device.serial}`;
    if (seen.has(key)) continue;
    seen.add(key);
    devices.push(device);
  }
  return devices;
}

export function selectDaisyBoard(devices: DfuDevice[]): BoardInfo | null {
  const daisy = devices.find((d) => d.usbId === DAISY_DFU_USB_ID);
  return daisy ? { name: 'Daisy Seed', usbId: daisy.usbId } : null;
}

export interface BoardDetectDeps {
  resolveDfuUtil?: () => Promise<string | undefined>;
  run?: (command: string, args: string[]) => Promise<string>;
}

const DETECT_TIMEOUT_MS = 5000;

// execFile (no shell). dfu-util prints its listing on stdout; stderr is kept
// too since some builds report "No DFU capable USB device" there.
const defaultRun = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    cp.execFile(command, args, { timeout: DETECT_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(`${stdout}\n${stderr}`);
    });
  });

// On demand only — called when the Daisy view becomes visible, on its
// Refresh action, and before Build & Flash. Never polls. Any failure
// (dfu-util missing or erroring) reads as "no board".
export async function detectBoard(deps: BoardDetectDeps = {}): Promise<BoardInfo | null> {
  const dfuUtil = await (deps.resolveDfuUtil ?? (() => detectDfuUtil()))();
  if (!dfuUtil) return null;
  try {
    return selectDaisyBoard(parseDfuList(await (deps.run ?? defaultRun)(dfuUtil, ['-l'])));
  } catch {
    return null;
  }
}
