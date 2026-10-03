// Menu model of the Daisy Scope's toolbar chips (FR-SCI-15). Pure — no DOM.
//
// Each chip shows one current value and opens a popover of choices. A chip owns
// one or more option groups; the Trigger chip has two (Edge, Source).

export type ChipId = 'gain' | 'scale' | 'trigger' | 'faxis' | 'lmode';

/** Current value of every group, keyed by group id. */
export type ChipState = Readonly<Record<string, string>>;

export interface ChipOption { readonly value: string; readonly label: string }

export interface ChipGroup {
  readonly id: string;
  readonly title?: string;
  readonly options: readonly ChipOption[];
  readonly defaultValue: string;
}

export interface ChipDef {
  readonly id: ChipId;
  /** Name used for the accessible label, e.g. "Gain". */
  readonly name: string;
  readonly groups: readonly ChipGroup[];
}

const EDGE_GLYPH: Readonly<Record<string, string>> = { rise: '↗', fall: '↘' };

export const CHIPS: readonly ChipDef[] = [
  {
    id: 'gain', name: 'Gain',
    groups: [{
      id: 'gain', defaultValue: '1',
      options: [{ value: '1', label: '×1' }, { value: '2', label: '×2' }, { value: '4', label: '×4' }, { value: 'auto', label: 'Auto' }],
    }],
  },
  {
    id: 'scale', name: 'Scale',
    groups: [{
      id: 'unit', defaultValue: 'lin',
      options: [{ value: 'lin', label: 'Linear' }, { value: 'db', label: 'dBFS' }],
    }],
  },
  {
    id: 'trigger', name: 'Trigger',
    groups: [
      {
        id: 'edge', title: 'Edge', defaultValue: 'free',
        options: [{ value: 'free', label: 'Free' }, { value: 'rise', label: '↗ Rising' }, { value: 'fall', label: '↘ Falling' }],
      },
      {
        id: 'source', title: 'Source', defaultValue: 'in',
        options: [{ value: 'in', label: 'In' }, { value: 'l', label: 'L' }],
      },
    ],
  },
  {
    id: 'faxis', name: 'Frequency axis',
    groups: [{
      id: 'fscale', defaultValue: 'log',
      options: [{ value: 'lin', label: 'Lin Hz' }, { value: 'log', label: 'Log Hz' }],
    }],
  },
  {
    id: 'lmode', name: 'Level mode',
    groups: [{
      id: 'lmode', defaultValue: 'abs',
      options: [{ value: 'rel', label: 'Relative' }, { value: 'abs', label: 'Absolute dBFS' }],
    }],
  },
];

function optionLabel(group: ChipGroup, value: string | undefined): string {
  return group.options.find(o => o.value === value)?.label ?? '';
}

/** Text shown on the chip for the current state. */
export function chipLabel(chip: ChipDef, state: ChipState): string {
  if (chip.id === 'trigger') {
    const edge = state['edge'];
    const glyph = edge === undefined ? undefined : EDGE_GLYPH[edge];
    if (glyph === undefined) return 'Free';
    return `${glyph} ${optionLabel(chip.groups[1]!, state['source'])}`;
  }
  return optionLabel(chip.groups[0]!, state[chip.groups[0]!.id]);
}

/** A group's entries are disabled when the group has no effect: Source while the edge is Free. */
export function isGroupDisabled(chip: ChipDef, groupId: string, state: ChipState): boolean {
  return chip.id === 'trigger' && groupId === 'source' && state['edge'] === 'free';
}

/** True when the chip shows its default. The Trigger source is ignored while the edge is Free. */
export function isDefault(chip: ChipDef, state: ChipState): boolean {
  return chip.groups.every(g => isGroupDisabled(chip, g.id, state) || state[g.id] === g.defaultValue);
}

export function defaultState(): Record<string, string> {
  const state: Record<string, string> = {};
  for (const chip of CHIPS) for (const g of chip.groups) state[g.id] = g.defaultValue;
  return state;
}
