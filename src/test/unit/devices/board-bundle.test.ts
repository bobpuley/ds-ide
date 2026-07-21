import { describe, it, expect } from 'vitest';
import { toAttachedDevices, type BoardBundle } from '../../../devices/board-bundle';
import { findConflicts, type AttachedDevice } from '../../../devices/attachment';

// FR-DEV-5: a throwaway two-control board fixture, proving the registry
// (device kinds) and attachment model (pin resolution/conflict checking)
// built in this milestone compose to express a board bundle without any
// further abstraction — the facility itself ships dormant (no UI, not
// enumerated anywhere else).
const TEST_BOARD: BoardBundle = {
  id: 'testboard',
  label: 'Test Board',
  faceplateGraphic: 'media/faceplates/testboard.svg',
  instances: [
    { id: 'knob1', kind: 'pot', pin: 15 },
    { id: 'sw1', kind: 'button', pin: 20 },
  ],
};

describe('toAttachedDevices (FR-DEV-5)', () => {
  it('resolves a two-control board bundle to one AttachedDevice per instance', () => {
    const devices = toAttachedDevices(TEST_BOARD);
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      id: 'testboard:knob1',
      owner: 'knob1 (Pot)',
      attachment: { kind: 'pin', pin: 15 },
    });
    expect(devices[1]).toEqual({
      id: 'testboard:sw1',
      owner: 'sw1 (Button)',
      attachment: { kind: 'pin', pin: 20 },
    });
  });

  it('resolved instances report no conflicts through the existing conflict engine', () => {
    const devices = toAttachedDevices(TEST_BOARD);
    const report = findConflicts(devices);
    expect(report.pinConflicts).toEqual([]);
  });

  it('a board bundle with two instances at the same fixed pin is caught as a conflict', () => {
    const brokenBoard: BoardBundle = {
      id: 'brokenboard',
      label: 'Broken Board',
      faceplateGraphic: 'media/faceplates/broken.svg',
      instances: [
        { id: 'knob1', kind: 'pot', pin: 15 },
        { id: 'knob2', kind: 'pot', pin: 15 },
      ],
    };
    const report = findConflicts(toAttachedDevices(brokenBoard));
    expect(report.pinConflicts).toHaveLength(1);
    expect(report.pinConflicts[0]!.pin).toBe(15);
    expect(report.pinConflicts[0]!.owners.sort()).toEqual(['knob1 (Pot)', 'knob2 (Pot)']);
  });

  it('a board bundle composes with an externally wired control through the same conflict engine', () => {
    const devices: AttachedDevice[] = [
      ...toAttachedDevices(TEST_BOARD),
      { id: 'user-vol', owner: 'vol (Pot)', attachment: { kind: 'pin', pin: 15 } }, // clashes with knob1
    ];
    const report = findConflicts(devices);
    expect(report.pinConflicts).toHaveLength(1);
    expect(report.pinConflicts[0]!.pin).toBe(15);
    expect(report.pinConflicts[0]!.owners.sort()).toEqual(['knob1 (Pot)', 'vol (Pot)']);
  });
});
