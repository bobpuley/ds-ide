// SD card's codegen strategy (FR-DEV-10) — unlike pot's N-instance shared
// array, a bus peripheral like this is enabled or not: at most one
// declaration and at most one Init call, never keyed by an id or pin the
// way every pin-attached device is. Mirrors the real libDaisy pattern of
// pairing an SdmmcHandler with a FatFSInterface that mounts the card; the
// emulator's fatfs_host shim (emulator/shim/src/fatfs_host.cpp) maps the
// mount onto a workspace-relative host directory instead of real hardware.
import { makeSimplePeripheralCodegen } from './shared';

const SD_HANDLE_NAME = 'ds_ide_sd';
const FATFS_NAME = 'ds_ide_fatfs';

export const sdcardCodegen = makeSimplePeripheralCodegen({
  declLine: `  SdmmcHandler ${SD_HANDLE_NAME}; FatFSInterface ${FATFS_NAME};`,
  initLinePrefixes: [
    `  ${SD_HANDLE_NAME}.Init(`,
    `  ${FATFS_NAME}.Init(`,
  ],
});
