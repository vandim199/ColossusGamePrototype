// Helpers for unit tests: drive scripted rounds through the real action path.

import { bossDef, cardType, hunterDef, isRestCard } from './cards';
import { makeBossCommitment } from './commit';
import { applyAction } from './engine';
import { DIRS, add, fromOffset, inBoard, key, parse, scale, type Dir, type HexKey } from './hex';
import { CUBE_BUDGET, bodySet, hunterAt } from './board';
import { activeHunters, cubesForPlays, cubesOnBoard, requiredBossCount, validateBossPlays, validateHunterPlays } from './rules';
import type { Action, BossPlay, GameState, HunterPlay } from './types';

export const hexAt = (col: number, row: number): HexKey => key(fromOffset(col, row));

/** The ground hex `k` steps from the Colossus centre in direction `dir` (k = 2 is adjacent to the body). */
export const fromCenter = (s: GameState, dir: Dir, k: number): HexKey =>
  key(add(parse(s.colossus.center), scale(DIRS[dir], k)));

export function emptyHex(s: GameState, preferred: HexKey[]): HexKey {
  const body = bodySet(s);
  const h = preferred.find((x) => inBoard(parse(x)) && !hunterAt(s, x) && !body.has(x));
  if (!h) throw new Error('no empty hex');
  return h;
}

/** Boss plays that hurt nobody in the default setup (used to advance rounds in long tests). */
export function harmlessBossPlays(s: GameState): BossPlay[] {
  const need = requiredBossCount(s);
  const rest = s.colossus.hand.find(isRestCard)!;
  if (need === 0) return [{ card: rest }];
  const order = ['feint', 'bodyThrash', 'quickSwipe', 'blastingShell', 'stompQuake', 'shellHarden', 'roar', 'wildThrash', 'chargeForward', 'tailSweep', 'lineBurst', 'triCone', 'ringSlam'];
  const hand = s.colossus.hand.filter((c) => !isRestCard(c)).sort((a, b) => order.indexOf(cardType(a)) - order.indexOf(cardType(b)));
  const far = emptyHex(s, [hexAt(9, 0), hexAt(0, 0), hexAt(9, 1)]);
  const far2 = emptyHex(s, [hexAt(0, 0), hexAt(0, 1), hexAt(1, 0)]);
  const plays: BossPlay[] = [];
  for (const c of hand) {
    if (plays.length === need) break;
    const kind = bossDef(c).kind;
    if (kind === 'charged' && (s.tumble || plays.some((p) => bossDef(p.card).kind === 'charged'))) continue;
    const t = cardType(c);
    const play: BossPlay = { card: c };
    if (t === 'triCone' || t === 'lineBurst' || t === 'chargeForward') play.dir = 0;
    if (t === 'bodyThrash') play.targets = [{ hex: far }];
    if (t === 'wildThrash') play.targets = [{ hex: far }, { hex: far2 }];
    if (t === 'quickSwipe') play.targets = [{ hex: emptyHex(s, DIRS.map((_, d) => fromCenter(s, d as Dir, 2))) }];
    if (cubesOnBoard(s) + cubesForPlays(s, [...plays, play]).length > CUBE_BUDGET) continue;
    plays.push(play);
  }
  const err = validateBossPlays(s, plays);
  if (err) throw new Error(`harmlessBossPlays built an illegal lock: ${err}`);
  return plays;
}

function* combos<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < arr.length; i++) yield* combos(arr, k, i + 1, [...acc, arr[i]]);
}

/** A legal, harmless commit: play cards in place without moving; Beam and Parry last; Rest only when forced. */
export function idleHunterAction(s: GameState, seat: number): Action {
  const h = s.hunters[seat - 1];
  const nonRest = h.hand.filter((c) => !isRestCard(c));
  const need = Math.min(2, nonRest.length);
  const ally = s.hunters.find((x) => x.seat !== seat && !x.exhausted)?.seat;
  const withParams = (c: string): HunterPlay => (hunterDef(c).ability === 'beam' && ally ? { card: c, target: ally } : { card: c });
  if (need > 0) {
    const rank = (c: string) => (cardType(c) === 'parry' ? 2 : cardType(c) === 'beam' ? 1 : 0);
    const ordered = [...nonRest].sort((a, b) => rank(a) - rank(b));
    for (const combo of combos(ordered, need)) {
      const plays = combo.map(withParams);
      if (!validateHunterPlays(s, seat, plays)) return { type: 'CommitHunterCards', seat, plays };
    }
  }
  const burn = h.discard.find((c) => cardType(c) === 'parry') ?? h.discard[0];
  return { type: 'Rest', seat, burn };
}

export type HunterOrders = Record<number, Action | HunterPlay[] | undefined>;

/** Lock, commit every active Hunter (scripted or idle), reveal. */
export function playRound(s: GameState, bossPlays: BossPlay[] | null, orders: HunterOrders = {}, salt = 'test-salt'): GameState {
  const { lock, reveal } = makeBossCommitment(s, bossPlays ?? harmlessBossPlays(s), salt);
  let st = applyAction(s, lock);
  for (const h of activeHunters(st)) {
    const o = orders[h.seat];
    const a: Action = !o ? idleHunterAction(st, h.seat) : Array.isArray(o) ? { type: 'CommitHunterCards', seat: h.seat, plays: o } : o;
    st = applyAction(st, a);
  }
  return applyAction(st, reveal);
}
