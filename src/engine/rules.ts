// Rule queries and validation, shared by the engine, bots and UI.

import {
  CUBE_BUDGET,
  LEGS,
  NODE_LINKS,
  bodySet,
  isAdjacentToColossus,
  isNodeId,
  lineBurstHexes,
  reachable,
  ringSlamHexes,
  triConeHexes,
} from './board';
import { bossDef, cardType, hunterDef, isRestCard } from './cards';
import { inBoard, parse, type Dir, type HexKey } from './hex';
import { distance } from './hex';
import type { BossPlay, BossTarget, GameState, HunterPlay, HunterState } from './types';

export const hunterBySeat = (s: GameState, seat: number): HunterState | undefined => s.hunters[seat - 1];
export const isActive = (h: HunterState) => !h.down && !h.exhausted;
export const activeHunters = (s: GameState) => s.hunters.filter(isActive);
export const bossCardsPerRound = (s: GameState) => (s.colossus.enraged ? 3 : 2);

/** Seats that must act before the game can move on. */
export function seatsToAct(s: GameState): number[] {
  switch (s.phase) {
    case 'bossLock':
    case 'bossReveal':
      return [0];
    case 'hunterCommit':
      return s.hunters.filter((h) => isActive(h) && !s.commits[h.seat - 1]).map((h) => h.seat);
    default:
      return [];
  }
}

/** Seats that may submit something right now (Hunters can change cards until the last one commits). */
export function seatsThatMayAct(s: GameState): number[] {
  if (s.phase === 'hunterCommit') return activeHunters(s).map((h) => h.seat);
  return seatsToAct(s);
}

// ---------------------------------------------------------------- cubes

export function cubesOnBoard(s: GameState, exceptRound?: number): number {
  return s.cubes.filter((w) => w.round !== exceptRound).reduce((n, w) => n + w.hexes.length, 0);
}

export function cubesForPlay(s: GameState, p: BossPlay): HexKey[] {
  const c = s.colossus.center;
  switch (cardType(p.card)) {
    case 'triCone':
      return p.dir === undefined ? [] : triConeHexes(c, p.dir);
    case 'lineBurst':
      return p.dir === undefined ? [] : lineBurstHexes(c, p.dir);
    case 'ringSlam':
      return ringSlamHexes(c);
    case 'rest':
      return p.hex ? [p.hex] : [];
    default:
      return [];
  }
}

/** Every new cube a set of plays places (deduplicated, in play order). */
export function cubesForPlays(s: GameState, plays: BossPlay[]): HexKey[] {
  const out: HexKey[] = [];
  for (const p of plays) for (const h of cubesForPlay(s, p)) if (!out.includes(h)) out.push(h);
  return out;
}

// ---------------------------------------------------------------- Colossus validation

/** How many non-Rest cards the Colossus must lock this round (0 means it has to Rest). */
export function requiredBossCount(s: GameState): number {
  const nonRest = s.colossus.hand.filter((c) => !isRestCard(c));
  const charged = nonRest.filter((c) => bossDef(c).kind === 'charged').length;
  const eligible = nonRest.length - charged + (s.tumble ? 0 : Math.min(1, charged));
  return Math.min(bossCardsPerRound(s), eligible);
}

export const isSuperRestNow = (hand: string[]) => hand.length === 1 && isRestCard(hand[0]);

const isDir = (d: unknown): d is Dir => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 5;

function validTarget(s: GameState, t: BossTarget | undefined, adjacentOnly: boolean): string | null {
  if (!t) return 'Missing target';
  if (t.node !== undefined) {
    if (adjacentOnly) return 'Quick Swipe targets a ground hex';
    return isNodeId(t.node) ? null : 'Unknown body node';
  }
  if (typeof t.hex !== 'string' || !inBoard(parse(t.hex))) return 'Target must be a hex on the board';
  if (bodySet(s).has(t.hex)) return 'Target must be a ground hex, not the Colossus';
  if (adjacentOnly && !isAdjacentToColossus(s, t.hex)) return 'Quick Swipe must target a hex adjacent to the Colossus';
  return null;
}

export function validateBossParams(s: GameState, p: BossPlay, superRest: boolean): string | null {
  const def = bossDef(p.card);
  switch (def.needs) {
    case 'dir':
      return isDir(p.dir) ? null : `${def.name} needs a direction`;
    case 'adjacentHex':
      return p.targets?.length === 1 ? validTarget(s, p.targets[0], true) : `${def.name} needs one target`;
    case 'hexOrNode':
      return p.targets?.length === 1 ? validTarget(s, p.targets[0], false) : `${def.name} needs one target`;
    case 'twoTargets':
      if (p.targets?.length !== 2) return `${def.name} needs two targets`;
      return validTarget(s, p.targets[0], false) ?? validTarget(s, p.targets[1], false);
    case 'restCube':
      if (p.hex === undefined) return null;
      if (!superRest) return 'Only a Super Rest places a free Red Cube';
      if (!inBoard(parse(p.hex)) || bodySet(s).has(p.hex)) return 'The free cube must go on a ground hex';
      return null;
    default:
      return null;
  }
}

/** Full legality check for a Colossus lock. `atReveal` ignores this round's already-placed cubes in the budget. */
export function validateBossPlays(s: GameState, plays: BossPlay[], atReveal = false): string | null {
  if (!Array.isArray(plays) || plays.length === 0) return 'The Colossus must lock at least one card';
  const ids = plays.map((p) => p?.card);
  if (ids.some((id) => typeof id !== 'string')) return 'Malformed card';
  if (new Set(ids).size !== ids.length) return 'The same card was locked twice';
  for (const id of ids) if (!s.colossus.hand.includes(id)) return `${id} is not in the Colossus hand`;
  const superRest = isSuperRestNow(s.colossus.hand);
  if (ids.some(isRestCard)) {
    if (plays.length !== 1) return 'Rest is played alone';
  } else {
    const need = requiredBossCount(s);
    if (need === 0) return 'No playable cards left: the Colossus must Rest';
    if (plays.length !== need) return `Lock exactly ${need} card${need === 1 ? '' : 's'}`;
  }
  let charged = 0;
  for (const p of plays) {
    if (bossDef(p.card).kind === 'charged') {
      charged++;
      if (s.tumble) return 'Charged cards are locked while the Colossus is Tumbled';
    }
    const err = validateBossParams(s, p, superRest);
    if (err) return err;
  }
  if (charged > 1) return 'Only one Charged Attack per round (one arrow token)';
  const cubes = cubesForPlays(s, plays);
  if (cubesOnBoard(s, atReveal ? s.round : undefined) + cubes.length > CUBE_BUDGET)
    return `Not enough Red Cubes (${CUBE_BUDGET} total)`;
  return null;
}

// ---------------------------------------------------------------- Hunter validation

/** How many cards a Hunter must commit (0 means they only hold Rest and must Rest). */
export const requiredHunterCount = (h: HunterState) => Math.min(2, h.hand.filter((c) => !isRestCard(c)).length);

export function validateHunterPlays(s: GameState, seat: number, plays: HunterPlay[]): string | null {
  const h = hunterBySeat(s, seat);
  if (!h) return 'No such Hunter';
  if (!isActive(h)) return `${h.cls} is ${h.exhausted ? 'Exhausted' : 'Down'} and cannot act`;
  if (!Array.isArray(plays)) return 'Malformed commit';
  const need = requiredHunterCount(h);
  if (need === 0) return 'Only Rest is left in hand: you must Rest';
  if (plays.length !== need) return `Commit exactly ${need} card${need === 1 ? '' : 's'}`;
  const ids = plays.map((p) => p?.card);
  if (ids.some((id) => typeof id !== 'string')) return 'Malformed card';
  if (new Set(ids).size !== ids.length) return 'The same card was committed twice';
  for (const id of ids) {
    if (!h.hand.includes(id)) return `${id} is not in your hand`;
    if (isRestCard(id)) return 'Rest is played alone (use the Rest action)';
  }
  const defs = ids.map(hunterDef);
  if (plays.length === 2 && defs.some((d) => d.parry) && !defs.some((d) => d.move))
    return 'Parry must be played with a movement card';

  let pos = h.pos;
  let node = h.node;
  for (const p of plays) {
    const def = hunterDef(p.card);
    if (def.move) {
      if (node) {
        if (p.jump !== undefined) {
          if (!inBoard(parse(p.jump)) || !isAdjacentToColossus(s, p.jump)) return 'Jump down to a hex adjacent to the Colossus';
          node = null;
          pos = p.jump;
        } else if (p.node !== undefined) {
          if (!isNodeId(p.node) || !NODE_LINKS[node].includes(p.node)) return 'Climb to a linked node (1 node per card)';
          node = p.node;
        }
      } else if (pos && p.dest !== undefined) {
        if (!reachable(s, p.card, pos).has(p.dest)) return `${def.name} cannot reach that hex`;
        pos = p.dest;
      }
    }
    if (def.climb && !node && p.node !== undefined && !LEGS.includes(p.node)) return 'Mount onto a Legs node';
    if (def.ability === 'beam') {
      const t = p.target === undefined ? undefined : hunterBySeat(s, p.target);
      if (!t || t.seat === seat || t.exhausted) return 'Rescue Beam needs an ally to target';
    }
  }
  return null;
}

export function validateRest(s: GameState, seat: number, burn: string): string | null {
  const h = hunterBySeat(s, seat);
  if (!h) return 'No such Hunter';
  if (!isActive(h)) return 'This Hunter cannot act';
  if (h.discard.length === 0) return 'Nothing in your discard pile to reclaim';
  if (!h.discard.includes(burn)) return 'Burn a card from your discard pile';
  return null;
}

export function validateRevive(s: GameState, seat: number, target: number): string | null {
  const h = hunterBySeat(s, seat);
  const t = hunterBySeat(s, target);
  if (!h || !t || h === t) return 'Pick a Downed ally';
  if (!isActive(h) || !h.pos) return 'You must be standing on the ground to revive';
  if (!t.down || t.exhausted) return 'That ally is not Down';
  if (t.revived) return 'That ally has already been revived once this game';
  if (!t.pos || distance(parse(h.pos), parse(t.pos)) !== 1) return 'You must be adjacent to the Downed ally';
  return null;
}

/** The Hunters a Downed ally could be revived by right now (for UI hints and bots). */
export function revivableAllies(s: GameState, seat: number): number[] {
  return s.hunters.filter((t) => validateRevive(s, seat, t.seat) === null).map((t) => t.seat);
}
