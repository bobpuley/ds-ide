// SD card's codegen strategy (FR-DEV-10) — unlike pot's N-instance shared
// array, a bus peripheral like this is enabled or not: at most one
// declaration and at most one Init call, never keyed by an id or pin the
// way every pin-attached device is. Mirrors the real libDaisy pattern of
// pairing an SdmmcHandler with a FatFSInterface that mounts the card; the
// emulator's fatfs_host shim (emulator/shim/src/fatfs_host.cpp) maps the
// mount onto a workspace-relative host directory instead of real hardware.
import type { PeripheralCodegenStrategy } from './types';

const SD_HANDLE_NAME = 'ds_ide_sd';
const FATFS_NAME = 'ds_ide_fatfs';
const DECL_RE = new RegExp(`^\\s*SdmmcHandler\\s+${SD_HANDLE_NAME}\\s*;\\s*FatFSInterface\\s+${FATFS_NAME}\\s*;\\s*$`);
const INIT_PREFIX_SD = `  ${SD_HANDLE_NAME}.Init(`;
const INIT_PREFIX_FATFS = `  ${FATFS_NAME}.Init(`;

function declLine(): string {
  return `  SdmmcHandler ${SD_HANDLE_NAME}; FatFSInterface ${FATFS_NAME};`;
}

function initLines(): string[] {
  return [
    `${INIT_PREFIX_SD});`,
    `${INIT_PREFIX_FATFS});`,
  ];
}

export const sdcardCodegen: PeripheralCodegenStrategy = {
  declLine,
  isDeclLine: (line) => DECL_RE.test(line),
  initLines,
  isInitLine: (line) => line.startsWith(INIT_PREFIX_SD) || line.startsWith(INIT_PREFIX_FATFS),
};
