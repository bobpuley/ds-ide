import { describe, it, expect } from 'vitest';
import { detectNonPortableSymbol } from '../../../diagnostics/non-portable';

describe('detectNonPortableSymbol', () => {
  it('returns empty array when all symbols are resolved', () => {
    const lines = [
      '-- Build files have been written to: .ds-ide/build',
      '[100%] Linking CXX executable effect_emu',
      'Build succeeded',
    ];
    expect(detectNonPortableSymbol(lines)).toEqual([]);
  });

  it('detects clang/ld64 undefined symbol style', () => {
    const lines = [
      'Undefined symbols for architecture arm64:',
      '  "_MIDI_SendNoteOn", referenced from:',
      '      effect_main() in effect.cpp.o',
      'ld: symbol(s) not found for architecture arm64',
    ];
    expect(detectNonPortableSymbol(lines)).toEqual(['MIDI_SendNoteOn']);
  });

  it('strips leading underscore on macOS symbol names', () => {
    const lines = ['  "_stm32_gpio_init", referenced from:'];
    expect(detectNonPortableSymbol(lines)).toEqual(['stm32_gpio_init']);
  });

  it('detects GNU ld / gold undefined reference style', () => {
    const lines = [
      "/proj/effect.cpp.o: in function 'main':",
      "undefined reference to `Switch::Init(daisy::Pin)'",
    ];
    expect(detectNonPortableSymbol(lines)).toEqual(["Switch::Init(daisy::Pin)"]);
  });

  it('returns empty array for empty line array', () => {
    expect(detectNonPortableSymbol([])).toEqual([]);
  });

  it('returns all unresolved symbols when multiple exist', () => {
    const lines = [
      '  "_MIDI_Send", referenced from:',
      '  "_SD_Init", referenced from:',
    ];
    expect(detectNonPortableSymbol(lines)).toEqual(['MIDI_Send', 'SD_Init']);
  });
});
