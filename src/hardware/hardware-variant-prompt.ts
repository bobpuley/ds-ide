import * as vscode from 'vscode';

// Mirrors the ds-ide.hardwareVariant setting's enum (package.json).
export type HardwareVariant = 'base' | '65mb-sdram';

interface VariantPickItem extends vscode.QuickPickItem {
  variant: HardwareVariant;
}

const ITEMS: VariantPickItem[] = [
  { label: 'Base Daisy Seed', description: 'No external SDRAM', variant: 'base' },
  { label: '65 MB SDRAM variant', description: 'Has external SDRAM', variant: '65mb-sdram' },
];

// Shared by the Effect Project Wizard and buildForHardware()'s first-build
// prompt (FR-HW-5d) so both ask the same question. Returns undefined if the
// user dismisses the prompt.
export async function promptHardwareVariant(): Promise<HardwareVariant | undefined> {
  const picked = await vscode.window.showQuickPick(ITEMS, {
    placeHolder: 'Which Daisy Seed hardware variant does this project target?',
  });
  return picked?.variant;
}
