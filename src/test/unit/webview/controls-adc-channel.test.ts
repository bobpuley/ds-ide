import { describe, it, expect } from 'vitest';
import { adcChannelFromPin } from '../../../webview/controls/adc-channel';

describe('adcChannelFromPin (FR-EXT-32)', () => {
  it('maps D15-D25 to A0-A10 and D28 to A11', () => {
    expect(adcChannelFromPin(15)).toBe(0);
    expect(adcChannelFromPin(25)).toBe(10);
    expect(adcChannelFromPin(28)).toBe(11);
  });

  it('degrades to channel 0 for a non-ADC pin instead of throwing', () => {
    expect(adcChannelFromPin(0)).toBe(0);
    expect(adcChannelFromPin(29)).toBe(0);
  });
});
