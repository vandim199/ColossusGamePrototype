import { CLASSES, type HunterClass } from '../engine';
import type { SeatInfo } from '../host/types';

export const ROLE_COLOR: Record<SeatInfo['role'], string> = {
  colossus: 'var(--colossus)',
  slasher: 'var(--slasher)',
  marksman: 'var(--marksman)',
  vanguard: 'var(--vanguard)',
  bard: 'var(--bard)',
};

export const ROLE_LETTER: Record<SeatInfo['role'], string> = {
  colossus: 'C',
  slasher: 'S',
  marksman: 'M',
  vanguard: 'V',
  bard: 'B',
};

export const className = (c: HunterClass) => CLASSES[c].name;

export function controllerLabel(s: SeatInfo, you: number | 'spectator'): string {
  if (s.seat === you) return 'You';
  if (s.dropped) return 'Bot (player dropped)';
  if (s.controller === 'bot') return `Bot · ${s.difficulty}`;
  return s.name || 'Human';
}
