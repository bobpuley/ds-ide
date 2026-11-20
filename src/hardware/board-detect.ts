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
  // FR-WIN-TCH-3: defaults to the host platform; overridable for tests.
  platform?: NodeJS.Platform;
  // Called with a user-facing diagnosis when a board is present but unusable.
  onDiagnostic?: (message: string) => void;
}

const DETECT_TIMEOUT_MS = 5000;

// execFile (no shell). dfu-util prints its listing on stdout; stderr is kept
// too since some builds report "No DFU capable USB device" there.
// A failing run keeps what it printed on the error, so the diagnostic below can
// still read it.
const defaultRun = (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    cp.execFile(command, args, { timeout: DETECT_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { output: `${stdout}\n${stderr}` }));
      else resolve(`${stdout}\n${stderr}`);
    });
  });

// FR-WIN-TCH-3: on Windows dfu-util can only open a DFU device that has a
// WinUSB (libusb-compatible) driver bound to it. Without one the board still
// enumerates, and dfu-util prints this line instead of listing it.
// ⚠️ ASSUMPTION: the wording is dfu-util's own ("Cannot open DFU device
// <vid>:<pid> found on devnum N (<libusb error>)"); it has not been captured on
// a Windows machine with the driver missing — confirm during M84.
const CANNOT_OPEN_RE = /Cannot open DFU device ([0-9a-f]{4}:[0-9a-f]{4})/i;

/** USB id of a DFU device that enumerates but cannot be opened, if dfu-util said so. */
export function findUnopenableDfuDevice(output: string): string | undefined {
  const m = CANNOT_OPEN_RE.exec(output);
  return m ? m[1]!.toLowerCase() : undefined;
}

export function winusbDriverMessage(usbId: string): string {
  return `dfu-util sees the board (USB ${usbId}) but cannot open it: no WinUSB driver is bound to it. ` +
    'Install one with Zadig (zadig.akeo.ie): put the board in bootloader mode (hold BOOT, press RESET), ' +
    'open Zadig, pick "STM32 BOOTLOADER" (Options > List All Devices if it is not listed), ' +
    'select WinUSB and click Install Driver.';
}

// On demand only — called when the Daisy view becomes visible, on its
// Refresh action, and before Build & Flash. Never polls. Any failure
// (dfu-util missing or erroring) reads as "no board"; on Windows a board that
// is present but cannot be opened is additionally reported through
// `onDiagnostic` (FR-WIN-TCH-3).
export async function detectBoard(deps: BoardDetectDeps = {}): Promise<BoardInfo | null> {
  const dfuUtil = await (deps.resolveDfuUtil ?? (() => detectDfuUtil()))();
  if (!dfuUtil) return null;
  const diagnose = (output: string): void => {
    if ((deps.platform ?? process.platform) !== 'win32') return;
    const usbId = findUnopenableDfuDevice(output);
    if (usbId) deps.onDiagnostic?.(winusbDriverMessage(usbId));
  };
  try {
    const output = await (deps.run ?? defaultRun)(dfuUtil, ['-l']);
    const board = selectDaisyBoard(parseDfuList(output));
    if (!board) diagnose(output);
    return board;
  } catch (err) {
    diagnose((err as { output?: unknown }).output as string ?? '');
    return null;
  }
}
