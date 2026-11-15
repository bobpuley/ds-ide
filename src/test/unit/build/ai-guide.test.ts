import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { wiredControlIds, registryIds } from '../../../devices/registry';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import { parseControlsConvention } from '../../../controllers/controls-convention-parser';
import { parseControllerConfig } from '../../../controllers/controller-config';

const root = path.join(__dirname, '../../../..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const GUIDE_PATH = 'ai/DAISY_IDE_AI_GUIDE.md';
const guide = read(GUIDE_PATH);
const pkg = JSON.parse(read('package.json'));

/** The code blocks of the guide, in order. */
function codeBlocks(text: string, lang: string): string[] {
  const out: string[] = [];
  const re = new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]!);
  return out;
}

// FR-AIG-2: the guide states rules the code enforces elsewhere. Each test ties
// one of those statements to the code, so a change on either side fails here.
describe('AI agent guide stays true to the product (FR-AIG-2)', () => {
  it('has a line budget so an agent reads all of it', () => {
    expect(guide.split('\n').length).toBeLessThanOrEqual(250);
  });

  it('states the Daisy IDE release line and a verification date', () => {
    const [major, minor] = pkg.version.split('.');
    expect(guide).toContain(`Describes Daisy IDE ${major}.${minor}.x`);
    expect(guide).toMatch(/Last verified: \d{4}-\d{2}-\d{2}/);
  });

  it('names every convention marker the parsers use', () => {
    for (const marker of [
      '// ds-ide:controls:begin',
      '// ds-ide:controls:end',
      '// ds-ide:controls:init:begin',
      '// ds-ide:controls:init:end',
      '// ds-ide:peripherals:begin',
      '// ds-ide:peripherals:end',
    ]) {
      expect(guide, marker).toContain(marker);
    }
  });

  it('lists every wired control kind in the registry', () => {
    for (const id of wiredControlIds()) {
      expect(guide, `kind ${id}`).toContain(`\`${id}\``);
    }
    // A bus peripheral is not a control kind; the guide must not offer it as one.
    expect(registryIds().length).toBeGreaterThan(wiredControlIds().length);
  });

  it('shows a controls block the real parser accepts, with every kind it lists', () => {
    const block = codeBlocks(guide, 'cpp').find(b => b.includes('ds-ide:controls:begin'));
    expect(block).toBeDefined();
    const parsed = parseControlsConvention(block!);
    expect(parsed.missingBlock).toBe(false);
    expect(parsed.errors).toEqual([]);
    expect(parsed.controls.map(c => c.id)).toEqual(['gainPot', 'tonePot', 'muteBtn', 'statusLed']);
  });

  it('shows a controllers.yaml the real parser accepts, naming its sections and fields', () => {
    const yaml = codeBlocks(guide, 'yaml')[0]!;
    const cfg = parseControllerConfig(yaml);
    expect(cfg.errors).toEqual([]);
    expect(cfg.pots.map(p => p.id)).toEqual(['gainPot']);
    expect(cfg.buttons.map(b => b.id)).toEqual(['muteBtn']);
    expect(cfg.leds.map(l => l.id)).toEqual(['statusLed']);
    for (const word of [
      'controllers:', 'buttons:', 'leds:', 'encoders:', 'toggles:', 'rgbleds:',
      'adc_channel', 'range', 'taper', 'default', 'gpio_pin', 'mode', 'active_level', 'editor_pos',
      'linear', 'log', 'antilog', 'momentary',
    ]) {
      expect(guide, word).toContain(word);
    }
  });

  it('states the ADC channel and GPIO ranges the validators enforce', () => {
    const maxPin = Math.max(...PIN_DEFS.filter(p => p.pin !== null).map(p => p.pin as number));
    const pot = (ch: number) =>
      parseControllerConfig(`controllers:\n  - id: a\n    label: A\n    adc_channel: ${ch}\n    range: [0, 1]\n    taper: linear\n    default: 0.5\n`).errors;
    const led = (pin: number) =>
      parseControllerConfig(`leds:\n  - id: a\n    label: A\n    gpio_pin: ${pin}\n`).errors;
    expect(pot(11)).toEqual([]);
    expect(pot(12)).not.toEqual([]);
    expect(led(maxPin)).toEqual([]);
    expect(led(maxPin + 1)).not.toEqual([]);
    expect(guide).toContain('integer 0–11');
    expect(guide).toContain(`GPIO 0–${maxPin}`);
    expect(guide).toContain(`0–${maxPin}, unique`);
  });

  it('uses the same structure as the project the wizard creates', () => {
    for (const piece of [
      '#include "daisy_seed.h"'.replace('#include ', ''),
      'DaisySeed hardware;',
      'hardware.Init();',
      'hardware.StartAudio(',
      'AudioHandle::InterleavingInputBuffer',
      'AudioHandle::InputBuffer',
    ]) {
      expect(guide, piece).toContain(piece);
    }
    const wizard = read('src/commands/create-effect-project.ts');
    expect(wizard).toContain('#include "daisy_seed.h"');
    expect(wizard).toContain('DaisySeed hardware;');
    expect(wizard).toContain('hardware.StartAudio(AudioCallback);');
  });

  it('never tells the agent to use a macro the emulator build does not define', () => {
    expect(guide).not.toContain('DS_IDE_EMULATOR');
    expect(read('emulator/CMakeLists.txt')).not.toContain('DS_IDE_EMULATOR');
  });
});

describe('AI agent guide ships in the package (FR-AIG-2)', () => {
  it('is not excluded by .vscodeignore', () => {
    const lines = read('.vscodeignore')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#') && !l.startsWith('!'));
    for (const line of lines) {
      expect(line === 'ai/**' || line === 'ai' || line === '**/*.md' || line === '*.md', line).toBe(false);
    }
  });

  it('is required by verify-vsix.sh', () => {
    expect(read('scripts/verify-vsix.sh')).toContain('check "ai/DAISY_IDE_AI_GUIDE.md"');
  });
});
