import { describe, it, expect, vi } from 'vitest';
import {
  parseDfuList, selectDaisyBoard, detectBoard, findUnopenableDfuDevice, winusbDriverMessage,
} from '../../../hardware/board-detect';

// Captured from `dfu-util -l` (dfu-util 0.11, Homebrew, macOS) with no board
// attached — exits 0 and lists nothing after the banner.
const DFU_UTIL_BANNER = `dfu-util 0.11

Copyright 2005-2009 Weston Schmidt, Harald Welte and OpenMoko Inc.
Copyright 2010-2021 Tormod Volden and Stefan Schmidt
This program is Free Software and has ABSOLUTELY NO WARRANTY
Please report bugs to http://sourceforge.net/p/dfu-util/tickets/

`;

// A Daisy Seed held in the STM32H750 system bootloader (BOOT + RESET) lists
// one "Found DFU" line per alt setting of the same device. The line format is
// dfu-util 0.11's; the alt names are the H750 bootloader's.
// ⚠️ Not captured from a physical board in this session — confirm against real
// output during the FR-TRN-7 manual check.
const DAISY_LINES =
  'Found DFU: [0483:df11] ver=0200, devnum=12, cfg=1, intf=0, path="20-2", alt=1, name="@Option Bytes   /0x5200201C/01*128 e", serial="200364500000"\n' +
  'Found DFU: [0483:df11] ver=0200, devnum=12, cfg=1, intf=0, path="20-2", alt=0, name="@Internal Flash   /0x08000000/16*128Kg", serial="200364500000"\n';

const OTHER_DEVICE_LINE =
  'Found DFU: [1209:2002] ver=0100, devnum=5, cfg=1, intf=0, path="20-1", alt=0, name="UNKNOWN", serial="ABCDEF"\n';

describe('parseDfuList() (FR-TRN-7)', () => {
  it('finds nothing in the real no-board output', () => {
    expect(parseDfuList(DFU_UTIL_BANNER)).toEqual([]);
  });

  it('finds nothing when dfu-util says no DFU device is available', () => {
    expect(parseDfuList(`${DFU_UTIL_BANNER}No DFU capable USB device available\n`)).toEqual([]);
  });

  it('collapses the alt settings of one board into a single device', () => {
    expect(parseDfuList(DFU_UTIL_BANNER + DAISY_LINES)).toEqual([
      { usbId: '0483:df11', path: '20-2', serial: '200364500000' },
    ]);
  });

  it('lists several devices separately', () => {
    const devices = parseDfuList(DFU_UTIL_BANNER + OTHER_DEVICE_LINE + DAISY_LINES);
    expect(devices.map((d) => d.usbId)).toEqual(['1209:2002', '0483:df11']);
  });

  it('tolerates Windows line endings', () => {
    expect(parseDfuList((DFU_UTIL_BANNER + DAISY_LINES).replace(/\n/g, '\r\n'))).toHaveLength(1);
  });
});

describe('selectDaisyBoard()', () => {
  it('names the STM32 DFU bootloader device as the Daisy Seed', () => {
    expect(selectDaisyBoard(parseDfuList(OTHER_DEVICE_LINE + DAISY_LINES)))
      .toEqual({ name: 'Daisy Seed', usbId: '0483:df11' });
  });

  it('returns null when only other DFU devices are present', () => {
    expect(selectDaisyBoard(parseDfuList(OTHER_DEVICE_LINE))).toBeNull();
  });

  it('returns null for no devices', () => {
    expect(selectDaisyBoard([])).toBeNull();
  });
});

describe('detectBoard()', () => {
  it('runs `<dfu-util> -l` through the toolchain resolution and returns the board', async () => {
    const run = vi.fn(async () => DFU_UTIL_BANNER + DAISY_LINES);
    const board = await detectBoard({ resolveDfuUtil: async () => '/opt/homebrew/bin/dfu-util', run });
    expect(run).toHaveBeenCalledWith('/opt/homebrew/bin/dfu-util', ['-l']);
    expect(board).toEqual({ name: 'Daisy Seed', usbId: '0483:df11' });
  });

  it('returns null when no board is attached', async () => {
    expect(await detectBoard({ resolveDfuUtil: async () => '/x/dfu-util', run: async () => DFU_UTIL_BANNER })).toBeNull();
  });

  it('returns null without running anything when dfu-util is not installed', async () => {
    const run = vi.fn();
    expect(await detectBoard({ resolveDfuUtil: async () => undefined, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('returns null when dfu-util fails', async () => {
    expect(await detectBoard({ resolveDfuUtil: async () => '/x/dfu-util', run: async () => { throw new Error('EACCES'); } })).toBeNull();
  });
});

// ── WinUSB diagnostic (FR-WIN-TCH-3) ─────────────────────────────────────────
// ⚠️ ASSUMPTION: the "Cannot open DFU device" line is dfu-util's own wording
// (probe_devices in dfu-util's main.c); not captured from a Windows machine
// with the driver missing — confirm during the Windows verification (M84).
const CANNOT_OPEN_OUTPUT =
  `${DFU_UTIL_BANNER}Cannot open DFU device 0483:df11 found on devnum 2 (LIBUSB_ERROR_NOT_SUPPORTED)\n` +
  'No DFU capable USB device available\n';

describe('findUnopenableDfuDevice() (FR-WIN-TCH-3)', () => {
  it('returns the USB id of a DFU device that enumerates but cannot be opened', () => {
    expect(findUnopenableDfuDevice(CANNOT_OPEN_OUTPUT)).toBe('0483:df11');
  });

  it('tolerates Windows line endings and upper-case ids', () => {
    expect(findUnopenableDfuDevice('Cannot open DFU device 0483:DF11 found on devnum 2 (x)\r\n')).toBe('0483:df11');
  });

  it('returns undefined for a listing, for no device, and for unrelated output', () => {
    expect(findUnopenableDfuDevice(DFU_UTIL_BANNER + DAISY_LINES)).toBeUndefined();
    expect(findUnopenableDfuDevice(DFU_UTIL_BANNER)).toBeUndefined();
    expect(findUnopenableDfuDevice('No DFU capable USB device available\n')).toBeUndefined();
  });
});

describe('winusbDriverMessage() (FR-WIN-TCH-3)', () => {
  it('names the missing WinUSB driver, the device, and how to install it with Zadig', () => {
    const m = winusbDriverMessage('0483:df11');
    expect(m).toMatch(/WinUSB/);
    expect(m).toMatch(/0483:df11/);
    expect(m).toMatch(/Zadig/);
    expect(m).toMatch(/zadig\.akeo\.ie/);
    expect(m).toMatch(/BOOT/);
  });
});

describe('detectBoard() — WinUSB driver missing (FR-WIN-TCH-3)', () => {
  it('on Windows, reports the diagnostic once and still returns null', async () => {
    const onDiagnostic = vi.fn();
    const board = await detectBoard({
      platform: 'win32',
      resolveDfuUtil: async () => 'C:\\dfu-util\\dfu-util.exe',
      run: async () => CANNOT_OPEN_OUTPUT,
      onDiagnostic,
    });
    expect(board).toBeNull();
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith(winusbDriverMessage('0483:df11'));
  });

  it('does not diagnose off Windows (libusb access errors there are a different problem)', async () => {
    const onDiagnostic = vi.fn();
    await detectBoard({
      platform: 'darwin', resolveDfuUtil: async () => '/usr/local/bin/dfu-util',
      run: async () => CANNOT_OPEN_OUTPUT, onDiagnostic,
    });
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('does not diagnose when the board lists normally', async () => {
    const onDiagnostic = vi.fn();
    const board = await detectBoard({
      platform: 'win32', resolveDfuUtil: async () => 'dfu-util.exe',
      run: async () => DFU_UTIL_BANNER + DAISY_LINES, onDiagnostic,
    });
    expect(board).not.toBeNull();
    expect(onDiagnostic).not.toHaveBeenCalled();
  });

  it('does not diagnose a plain "no board attached"', async () => {
    const onDiagnostic = vi.fn();
    await detectBoard({
      platform: 'win32', resolveDfuUtil: async () => 'dfu-util.exe',
      run: async () => DFU_UTIL_BANNER, onDiagnostic,
    });
    expect(onDiagnostic).not.toHaveBeenCalled();
  });
});
