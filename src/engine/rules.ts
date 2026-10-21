// Rule queries and validation, shared by the engine, bots and UI.

import { bodySet, coneHexes, isAdjacentToColossus, lineHexes, reachable, ringSlamHexes } from './board';
import { bossDef, cardType, hunterDef, isRestCard, lockedWhileTumbled } from './cards';
import { distance, inBoard, parse, type HexKey } from './hex';
import type { BossPlay, GameState, HunterPlay, HunterState } from './types';

export const hunterBySeat = (s: GameState, seat: number): HunterState | undefined => s.hunters[seat - 1];
export const isActive = (h: HunterState) => !h.down;
export const activeHunters = (s: GameState) => s.hunters.filter(isActive);
/** Most cards the Colossus may lock this round (it may lock fewer, but at least one). */
export const maxBossCards = (s: GameState) => (s.colossus.enraged ? 3 : 2);
/** Most cards a Hunter may commit (they may commit fewer, even none). */
export const MAX_HUNTER_CARDS = 2;

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

// ---------------------------------------------------------------- cubes

export function cubesOnBoard(s: GameState, exceptRound?: number): number {
  return s.cubes.filter((w) => w.round !== exceptRound).reduce((n, w) => n + w.hexes.length, 0);
}

export function cubesForPlay(s: GameState, p: BossPlay): HexKey[] {
  const c = s.colossus.center;
  switch (cardType(p.card)) {
    case 'triCone':
      return p.aim ? coneHexes(c, p.aim) : [];
    case 'lineBurst':
      return p.aim ? lineHexes(c, p.aim) : [];
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

/** A Rest is a Super Rest when it is played together with every other card left in hand. */
export const isSuperRest = (hand: string[], playedIds: string[]) =>
  playedIds.some(isRestCard) && hand.every((c) => playedIds.includes(c));

// ---------------------------------------------------------------- Colossus validation

const isHexKey = (h: unknown): h is HexKey => typeof h === 'string' && /^-?\d+,-?\d+$/.test(h);

function validBoardHex(h: unknown): h is HexKey {
  return isHexKey(h) && inBoard(parse(h));
}

export function validateBossParams(s: GameState, p: BossPlay, superRest: boolean): string | null {
  const def = bossDef(p.card);
  const body = bodySet(s);
  switch (def.needs) {
    case 'aim':
      if (!validBoardHex(p.aim) || p.aim === s.colossus.center) return `${def.name} needs a hex to aim at`;
      return null;
    case 'adjacentHex':
      if (p.targets?.length !== 1 || !validBoardHex(p.targets[0]) || !isAdjacentToColossus(s, p.targets[0]))
        return 'Quick Swipe must target a hex adjacent to the Colossus';
      return null;
    case 'anyHex':
      return p.targets?.length === 1 && validBoardHex(p.targets[0]) ? null : `${def.name} needs one target hex`;
    case 'twoHexes':
      return p.targets?.length === 2 && p.targets.every(validBoardHex) ? null : `${def.name} needs two target hexes`;
    case 'restCube':
      if (p.hex === undefined) return null;
      if (!superRest) return 'Only a Super Rest places a free Red Cube';
      if (!validBoardHex(p.hex) || body.has(p.hex)) return 'The free cube must go on a ground hex';
      return null;
    default:
      return null;
  }
}

/** Full legality check for a Colossus lock: 1 to 2 cards (3 Enraged), in any combination. */
export function validateBossPlays(s: GameState, plays: BossPlay[]): string | null {
  if (!Array.isArray(plays) || plays.length === 0) return 'The Colossus must lock at least one card';
  if (plays.length > maxBossCards(s)) return `Lock at most ${maxBossCards(s)} cards`;
  const ids = plays.map((p) => p?.card);
  if (ids.some((id) => typeof id !== 'string')) return 'Malformed card';
  if (new Set(ids).size !== ids.length) return 'The same card was locked twice';
  for (const id of ids) if (!s.colossus.hand.includes(id)) return `${id} is not in the Colossus hand`;
  const superRest = isSuperRest(s.colossus.hand, ids);
  for (const p of plays) {
    if (s.tumble && lockedWhileTumbled(p.card)) return `${bossDef(p.card).name} is locked while the Colossus is Tumbled`;
    const err = validateBossParams(s, p, superRest);
    if (err) return err;
  }
  return null;
}

// ---------------------------------------------------------------- Hunter validation

/** 0 to 2 cards from hand, any combination (Rest included). */
export function validateHunterPlays(s: GameState, seat: number, plays: HunterPlay[]): string | null {
  const h = hunterBySeat(s, seat);
  if (!h) return 'No such Hunter';
  if (!isActive(h)) return `${h.cls} is Down and cannot act`;
  if (!Array.isArray(plays)) return 'Malformed commit';
  if (plays.length > MAX_HUNTER_CARDS) return `Commit at most ${MAX_HUNTER_CARDS} cards`;
  const ids = plays.map((p) => p?.card);
  if (ids.some((id) => typeof id !== 'string')) return 'Malformed card';
  if (new Set(ids).size !== ids.length) return 'The same card was committed twice';
  for (const id of ids) if (!h.hand.includes(id)) return `${id} is not in your hand`;

  let pos = h.pos;
  for (const p of plays) {
    const def = hunterDef(p.card);
    if (def.move && p.dest !== undefined) {
      if (!isHexKey(p.dest) || !reachable(s, p.card, pos).has(p.dest)) return `${def.name} cannot reach that hex`;
      pos = p.dest;
    }
    if (def.ability === 'beam') {
      const t = p.target === undefined ? undefined : hunterBySeat(s, p.target);
      if (!t || t.seat === seat) return 'Rescue Beam needs an ally to target';
    }
  }
  return null;
}

export function validateRevive(s: GameState, seat: number, target: number): string | null {
  const h = hunterBySeat(s, seat);
  const t = hunterBySeat(s, target);
  if (!h || !t || h === t) return 'Pick a Downed ally';
  if (!isActive(h) || h.climbing) return 'You must be standing on the ground to revive';
  if (!t.down) return 'That ally is not Down';
  if (t.revived) return 'That ally has already been revived once this game';
  if (distance(parse(h.pos), parse(t.pos)) !== 1) return 'You must be adjacent to the Downed ally';
  return null;
}

/** The Hunters a Downed ally could be revived by right now (for UI hints and bots). */
export function revivableAllies(s: GameState, seat: number): number[] {
  return s.hunters.filter((t) => validateRevive(s, seat, t.seat) === null).map((t) => t.seat);
}
