// The five bounded dice from GDD section "Dice, Rest and Super Rest".
// Every face is printed, so there is no hidden math.

export type DieKind = 'slasher' | 'standard' | 'upgraded' | 'heavy' | 'pull';

export const DIE_FACES: Record<DieKind, readonly number[]> = {
  slasher: [0, 0, 1, 1],
  standard: [0, 1, 1, 2],
  upgraded: [1, 1, 2, 2],
  heavy: [0, 0, 2, 2, 3, 3, 4, 4],
  pull: [2, 2, 2, 3, 3, 4],
};

export const DIE_LABEL: Record<DieKind, string> = {
  slasher: 'Slasher d4',
  standard: 'Standard d4',
  upgraded: 'Upgraded d4',
  heavy: 'Heavy d8',
  pull: 'Pull d6',
};

export function dieAverage(kind: DieKind): number {
  const f = DIE_FACES[kind];
  return f.reduce((a, b) => a + b, 0) / f.length;
}

/** Super Rest upgrade path: Slasher -> Standard -> Upgraded. Heavy and Pull never upgrade. */
export const UPGRADE: Partial<Record<DieKind, DieKind>> = {
  slasher: 'standard',
  standard: 'upgraded',
};

export function rollDie(kind: DieKind, random: () => number): number {
  const f = DIE_FACES[kind];
  return f[Math.floor(random() * f.length)];
}
