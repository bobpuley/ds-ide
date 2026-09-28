import { describe, it, expect, afterEach } from 'vitest';
import { isPinEligible } from '../../../wiring/pin-eligibility';
import { PIN_DEFS } from '../../../devices/pin-table.gen';
import type { PinDef } from '../../../devices/pin-table.gen';
import { REGISTRY } from '../../../devices/registry';

const assignable = PIN_DEFS.filter(d => d.pin !== null);
const powerPins  = PIN_DEFS.filter(d => d.pin === null);

function eligiblePins(deviceId: string): number[] {
  return PIN_DEFS.filter(d => isPinEligible(d, deviceId)).map(d => d.pin!).sort((a, b) => a - b);
}

describe('isPinEligible (FR-UDM-1)', () => {
  it('pot is eligible on ADC pins only', () => {
    const adcPins = assignable.filter(d => d.adc).map(d => d.pin!).sort((a, b) => a - b);
    expect(adcPins.length).toBeGreaterThan(0);
    expect(eligiblePins('pot')).toEqual(adcPins);
  });

  it('a device with no pinRequires is eligible on every assignable pin', () => {
    const all = assignable.map(d => d.pin!).sort((a, b) => a - b);
    for (const id of ['button', 'led', 'toggle', 'rgbled', 'encoder']) {
      expect(eligiblePins(id)).toEqual(all);
    }
  });

  it('power/special pins are never eligible', () => {
    for (const d of powerPins) {
      for (const id of Object.keys(REGISTRY)) {
        expect(isPinEligible(d, id)).toBe(false);
      }
    }
  });

  it('bus-attached peripherals and unknown ids are never pin-eligible', () => {
    for (const d of assignable) {
      expect(isPinEligible(d, 'sdcard')).toBe(false);
      expect(isPinEligible(d, 'oled')).toBe(false);
      expect(isPinEligible(d, 'servo')).toBe(false);
    }
  });

  describe('non-ADC requirements', () => {
    afterEach(() => { delete REGISTRY['fakeDev']; });

    const pin = (over: Partial<PinDef>): PinDef => ({
      row: 0, side: 'L', pin: 1, label: 'D1', aLabel: null, adc: false,
      i2c: null, uart: null, spi: null, sdmmc: null, canonicalBusSignal: null, ...over,
    });

    it.each([
      ['i2c',   pin({ i2c: ['I2C1_SCL'] })],
      ['uart',  pin({ uart: ['USART1_TX'] })],
      ['spi',   pin({ spi: ['SPI1_SCK'] })],
      ['sdmmc', pin({ sdmmc: 'SDMMC1_D0' })],
    ] as const)('derives %s eligibility from the pin table', (req, capable) => {
      REGISTRY['fakeDev'] = { ...REGISTRY['button']!, id: 'fakeDev', pinRequires: req };
      expect(isPinEligible(capable, 'fakeDev')).toBe(true);
      expect(isPinEligible(pin({}), 'fakeDev')).toBe(false);
    });
  });
});
