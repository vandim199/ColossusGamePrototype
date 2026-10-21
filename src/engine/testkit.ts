// Helpers for unit tests: drive scripted rounds through the real action path.

import { bodySet, hunterAt } from './board';
import { bossDef, cardType } from './cards';
import { makeBossCommitment } from './commit';
import { applyAction } from './engine';
import { DIRS, add, fromOffset, inBoard, key, parse, scale, type Dir, type HexKey } from './hex';
import { activeHunters, validateBossPlays } from './rules';
import type { Action, BossPlay, GameState, HunterPlay } from './types';

export const hexAt = (col: number, row: number): HexKey => key(fromOffset(col, row));

/** The hex `k` steps from the Colossus centre in direction `dir` (k = 2 is adjacent to the body). */
export const fromCenter = (s: GameState, dir: Dir, k: number): HexKey => key(add(parse(s.colossus.center), scale(DIRS[dir], k)));

export function emptyHex(s: GameState, preferred: HexKey[]): HexKey {
  const body = bodySet(s);
  const h = preferred.find((x) => inBoard(parse(x)) && !hunterAt(s, x) && !body.has(x));
  if (!h) throw new Error('no empty hex');
  return h;
}

/** A single harmless Colossus card (Feint, or Body Thrash into an empty corner), used to advance rounds. */
export function harmlessBossPlays(s: GameState): BossPlay[] {
  const order = ['feint', 'bodyThrash', 'shellHarden', 'rest'];
  const card = order.map((t) => s.colossus.hand.find((c) => cardType(c) === t)).find(Boolean) ?? s.colossus.hand[0];
  const play: BossPlay = { card };
  const def = bossDef(card);
  const corner = emptyHex(s, [hexAt(9, 0), hexAt(0, 0), hexAt(9, 1)]);
  if (def.needs === 'anyHex') play.targets = [corner];
  if (def.needs === 'twoHexes') play.targets = [corner, emptyHex(s, [hexAt(0, 0), hexAt(0, 1)])];
  if (def.needs === 'aim') play.aim = hexAt(4, 0);
  if (def.needs === 'adjacentHex') play.targets = [emptyHex(s, DIRS.map((_, d) => fromCenter(s, d as Dir, 2)))];
  const plays = [play];
  const err = validateBossPlays(s, plays);
  if (err) throw new Error(`harmlessBossPlays built an illegal lock: ${err}`);
  return plays;
}

export type HunterOrders = Record<number, Action | HunterPlay[] | undefined>;

/** Lock, commit every active Hunter (scripted, or a pass), reveal. */
export function playRound(s: GameState, bossPlays: BossPlay[] | null, orders: HunterOrders = {}, salt = 'test-salt'): GameState {
  const { lock, reveal } = makeBossCommitment(s, bossPlays ?? harmlessBossPlays(s), salt);
  let st = applyAction(s, lock);
  for (const h of activeHunters(st)) {
    const o = orders[h.seat];
    const a: Action = !o ? { type: 'CommitHunterCards', seat: h.seat, plays: [] } : Array.isArray(o) ? { type: 'CommitHunterCards', seat: h.seat, plays: o } : o;
    st = applyAction(st, a);
  }
  return applyAction(st, reveal);
}
