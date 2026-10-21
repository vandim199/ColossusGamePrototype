// Shared analysis for the bots. Bots only ever look at their own seat's
// projected view, so they cannot see hidden cards.

import {
  BOSS_DECK,
  bodyRing,
  cardType,
  chargedZone,
  dieAverage,
  distToBody,
  hunterDef,
  isRestCard,
  reachable,
  type GameState,
  type HexKey,
  type HunterState,
  type Rng,
} from '../engine';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Softmax temperature: higher means more random (and more mistakes). */
export const TEMPERATURE: Record<Difficulty, number> = { easy: 2.6, normal: 1.0, hard: 0.45 };

export interface BotContext {
  rng: Rng;
  difficulty: Difficulty;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Weighted random choice: P(item) is proportional to exp(score / temperature). */
export function softmaxPick<T>(options: Scored<T>[], temperature: number, rng: Rng): T {
  if (options.length === 1) return options[0].item;
  const max = Math.max(...options.map((o) => o.score));
  const weights = options.map((o) => Math.exp((o.score - max) / Math.max(0.05, temperature)));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i].item;
  }
  return options[options.length - 1].item;
}

export function topN<T>(options: Scored<T>[], n: number): Scored<T>[] {
  return [...options].sort((a, b) => b.score - a.score).slice(0, n);
}

// ---------------------------------------------------------------- threats

export interface Threats {
  /** Cubes that detonate at step 3.2 this round. */
  detonating: Set<HexKey>;
  /** Cubes placed this round (they detonate next round). */
  nextCubes: Set<HexKey>;
  /** Hexes the declared Charged Attack will hit at step 3.5. */
  charged: Set<HexKey>;
  adjacent: Set<HexKey>;
}

export function analyzeThreats(s: GameState): Threats {
  const detonating = new Set<HexKey>();
  const nextCubes = new Set<HexKey>();
  for (const w of s.cubes) for (const h of w.hexes) (w.round < s.round ? detonating : nextCubes).add(h);
  const charged = new Set<HexKey>();
  for (const p of s.pendingCharged) for (const h of chargedZone(s, p)) charged.add(h);
  return { detonating, nextCubes, charged, adjacent: new Set(bodyRing(s.colossus.center, 1)) };
}

/** The Colossus hand as the Hunters can deduce it: base cards are public by elimination; Rage cards are not. */
export function deducedBossHand(s: GameState): { base: string[]; hiddenRage: number } {
  if (!s.colossus.hand.includes('hidden')) {
    return { base: s.colossus.hand.filter((c) => !c.endsWith('.r')), hiddenRage: s.colossus.hand.filter((c) => c.endsWith('.r')).length };
  }
  const base = BOSS_DECK.filter((c) => !s.colossus.discard.includes(c));
  return { base, hiddenRage: Math.max(0, s.colossus.hand.length - base.length) };
}

/** Chance the Colossus aims at least one single-target Quick Attack this round, from public information. */
export function quickAttackChance(s: GameState): { any: number; thrashShare: number } {
  const { base, hiddenRage } = deducedBossHand(s);
  const nonRest = base.filter((c) => !isRestCard(c)).length + hiddenRage;
  const swipes = base.filter((c) => cardType(c) === 'quickSwipe').length;
  const thrashes = base.filter((c) => cardType(c) === 'bodyThrash').length + hiddenRage * 0.25;
  const q = swipes + thrashes;
  let k = Math.min(s.colossus.enraged ? 3 : 2, nonRest);
  if (s.lock) {
    k = s.lock.cardCount;
    if (s.lock.cubes.length >= 3) k -= 1; // one of the locked cards is a telegraph
    if (s.lock.cardCount === 1 && s.lock.cubes.length <= 1 && nonRest > 1) k = 0; // a lone card with <=1 cube smells like Rest
  }
  if (nonRest <= 0 || k <= 0 || q <= 0) return { any: 0, thrashShare: 0 };
  let none = 1;
  for (let j = 0; j < k; j++) none *= Math.max(0, nonRest - q - j) / Math.max(1, nonRest - j);
  return { any: Math.min(1, 1 - none), thrashShare: thrashes / q };
}

// ---------------------------------------------------------------- Hunters

export const isMelee = (h: HunterState) => h.cls === 'slasher' || h.cls === 'vanguard';

/** How much a Hunter likes standing on a hex, by class, ignoring danger. */
export function positionPreference(s: GameState, h: HunterState, hex: HexKey): number {
  const d = distToBody(s.colossus.center, hex);
  switch (h.cls) {
    case 'slasher':
    case 'vanguard':
      return d === 1 ? 2 : -0.9 * (d - 1);
    case 'marksman':
      return d >= 2 && d <= 4 ? 1.6 : d === 1 ? 0.6 : -0.9 * (d - 4);
    case 'bard':
      return d >= 1 && d <= 3 ? 1.3 : -0.9 * (d - 3);
  }
}

export function expectedAttack(h: HunterState, card: string): number {
  const def = hunterDef(card);
  if (!def.attack && !def.climb) return 0;
  if (def.attack?.roll === 'sledge') return 3 + dieAverage('heavy');
  const mom = h.cls === 'slasher' ? h.momentum * 0.5 : 0;
  if (def.attack?.roll === 'vector') {
    const best = [...h.dice].map(dieAverage).sort((a, b) => b - a).slice(0, 4);
    return best.reduce((a, b) => a + b, 0) + mom;
  }
  return h.dice.reduce((a, d) => a + dieAverage(d), 0) + mom;
}

/** Every hex a Hunter could plausibly end on this round with the movement cards in hand (approximate). */
export function plausibleReach(s: GameState, h: HunterState): Set<HexKey> {
  const from = h.pos;
  if (!from) return new Set();
  const moves = h.hand.filter((c) => hunterDef(c).move);
  const out = new Set<HexKey>([from]);
  for (const c of moves) for (const x of reachable(s, c, from)) out.add(x);
  // Two walking cards compose into one longer walk: longest first, then the next longest.
  const walks = moves
    .filter((c) => hunterDef(c).move!.kind === 'walk')
    .sort((a, b) => hunterDef(b).move!.range - hunterDef(a).move!.range);
  if (walks.length >= 2) {
    for (const mid of reachable(s, walks[0], from)) for (const x of reachable(s, walks[1], mid)) out.add(x);
  }
  return out;
}

export const nonRestCards = (h: HunterState) => h.hand.filter((c) => !isRestCard(c));
