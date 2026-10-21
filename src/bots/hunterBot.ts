// Hunter bot: a one-ply planner. It enumerates every legal set of 0-2 cards
// and every destination, scores each plan, then makes a weighted random choice
// among the best few (lower temperature = sharper play).
//
// Behaviour: dodge cube lanes and charge paths, Parry when it reads that it is
// the likely target, focus Armor, climb during Tumbles and race for the core,
// Rest when hurt or low on cards. Bots read their teammates' face-up commits so
// they play sensibly alongside humans.

import {
  BURST_TARGET,
  SHAKE_DAMAGE,
  bodySet,
  cardType,
  dist,
  distToBody,
  hunterBySeat,
  hunterDef,
  isRestCard,
  isSuperRest,
  reachable,
  revivableAllies,
  validateHunterPlays,
  type Action,
  type GameState,
  type HexKey,
  type HunterPlay,
  type HunterState,
} from '../engine';
import { quickAimMap } from './colossusBot';
import {
  TEMPERATURE,
  analyzeThreats,
  deducedBossHand,
  expectedAttack,
  positionPreference,
  quickAttackChance,
  softmaxPick,
  topN,
  type BotContext,
  type Scored,
  type Threats,
} from './common';

/** A deflected Quick Attack: no damage, a Tumble, a cancelled Charge and a climb window. */
const PARRY_WIN = 20;
/** Landing a Vital Strike, in the same units as Armor damage. */
const STRIKE_VALUE = 30;

/** Cost of spending a card without getting its effect (it is unavailable until the next Rest). */
function keepCost(card: string): number {
  const d = hunterDef(card);
  if (d.climb) return 3.5;
  if (d.attack) return 1.3;
  if (d.parry) return 0.7;
  if (d.rest) return 0.4;
  if (d.ability) return 0.9;
  if (d.move?.kind !== 'walk') return 0.6;
  return 0.25;
}

function* combos<T>(arr: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < arr.length; i++) yield* combos(arr, k, i + 1, [...acc, arr[i]]);
}

interface TeamIntel {
  /** Where committed allies will end their movement. */
  dests: Map<number, HexKey>;
  /** Allies who committed Climb & Strike. */
  climbers: Set<number>;
  /** Allies whose commit includes an attack, and allies still to commit. */
  attackers: number;
  uncommitted: number;
  /** Expected Burst damage committed allies will add on the core this round. */
  burst: number;
}

function teamIntel(s: GameState, seat: number): TeamIntel {
  const intel: TeamIntel = { dests: new Map(), climbers: new Set(), attackers: 0, uncommitted: 0, burst: 0 };
  for (const h of s.hunters) {
    if (h.seat === seat || h.down) continue;
    const c = s.commits[h.seat - 1];
    let pos = h.pos;
    if (!c) {
      intel.uncommitted++;
      // A climbing ally still deciding will most likely hit the core too.
      const best = Math.max(0, ...h.hand.filter((x) => hunterDef(x).attack).map((x) => expectedAttack(h, x)));
      if (h.climbing) intel.burst += 0.8 * best;
    } else if (c.kind === 'cards') {
      for (const p of c.plays) {
        const d = hunterDef(p.card);
        if (d.move && p.dest) pos = p.dest;
        if (d.climb && !h.climbing) intel.climbers.add(h.seat);
      }
      const attacks = c.plays.filter((p) => hunterDef(p.card).attack || (hunterDef(p.card).climb && h.climbing));
      if (attacks.length) intel.attackers++;
      if (h.climbing && pos === s.colossus.center) intel.burst += attacks.reduce((a, p) => a + expectedAttack(h, p.card), 0);
    }
    intel.dests.set(h.seat, pos);
  }
  return intel;
}

interface Ctx {
  s: GameState;
  me: HunterState;
  T: Threats;
  quick: { any: number; thrashShare: number };
  /** P(a Quick Attack lands on each hex), from a model of the Colossus. */
  aim: Map<HexKey, number>;
  shell: number;
  team: TeamIntel;
  hpFactor: number;
  exposedBonus: number;
  /** Reachability cache for this decision, keyed by card type and start hex. */
  reach: (card: string, from: HexKey) => Set<HexKey>;
}

function damageCost(c: Ctx, dmg: number): number {
  const total = dmg + c.exposedBonus;
  return total * c.hpFactor + (c.me.hp - total <= 0 ? 14 : 0);
}

function quickTargetChance(c: Ctx, hex: HexKey): number {
  // The aim model runs a little low against the real Colossus bot.
  return Math.min(0.95, 1.3 * (c.aim.get(hex) ?? 0));
}

function groundDanger(c: Ctx, hex: HexKey): number {
  let d = 0;
  if (c.T.detonating.has(hex)) d += damageCost(c, 5);
  if (c.T.charged.has(hex)) d += damageCost(c, 4);
  return d;
}

function canClimbAt(c: Ctx, hex: HexKey): boolean {
  const t = c.s.tumble;
  if (!t || t.climbsLeft <= 0 || !c.T.adjacent.has(hex)) return false;
  if (t.kind === 'long' || t.parrier === c.me.seat) return true;
  const parrier = t.parrier ? hunterBySeat(c.s, t.parrier) : undefined;
  if (!parrier || parrier.climbing || c.team.climbers.has(parrier.seat)) return false;
  if (dist(parrier.pos, hex) !== 1) return false;
  return ![...c.team.climbers].some((seat) => seat < c.me.seat);
}

/** Blasting Shell punishes "all but one Hunter attacking": count committed allies and guess the rest. */
function shellRisk(c: Ctx): number {
  if (c.shell <= 0) return 0;
  const active = c.s.hunters.filter((h) => !h.down).length;
  const need = Math.max(1, active - 1);
  const expected = c.team.attackers + 1 + 0.65 * c.team.uncommitted;
  if (expected < need - 0.3) return 0;
  return c.shell * (damageCost(c, 2) + 2);
}

function blastingShellChance(s: GameState): number {
  const { base, hiddenRage } = deducedBossHand(s);
  if (!base.some((x) => cardType(x) === 'blastingShell')) return 0;
  const n = base.filter((x) => !isRestCard(x)).length + hiddenRage;
  const k = s.lock ? s.lock.cardCount - (s.lock.cubes.length >= 3 ? 1 : 0) : s.colossus.enraged ? 3 : 2;
  return Math.min(0.75, (Math.max(0, k) / Math.max(1, n)) * 1.6);
}

function restValue(c: Ctx, cards: string[]): number {
  const { me } = c;
  const superRest = isSuperRest(me.hand, cards);
  const heal = Math.min(superRest ? 4 : 2, me.maxHp - me.hp);
  const urgency = me.hp <= 5 ? 1.6 : me.hp <= 8 ? 1 : 0.4;
  const left = me.hand.filter((x) => !cards.includes(x)).length;
  const reclaim = me.discard.length * 0.35 + (left <= 1 ? 2.5 : 0);
  return heal * urgency + reclaim + (superRest && me.upgrades < 2 ? 2 : 0);
}

function revivableNear(s: GameState, me: HunterState, f: HexKey): boolean {
  return s.hunters.some((t) => t.seat !== me.seat && t.down && !t.revived && dist(t.pos, f) === 1);
}

/** Pull an ally out of a detonating lane or a Charge path, if one is within 5. */
function beamValue(c: Ctx): { value: number; target?: number } {
  const { s, me } = c;
  let best = { value: 0, target: undefined as number | undefined };
  for (const a of s.hunters) {
    if (a.seat === me.seat || a.climbing || dist(a.pos, me.pos) > 5) continue;
    const at = c.team.dests.get(a.seat) ?? a.pos;
    let v = 0;
    if (c.T.detonating.has(at) || c.T.charged.has(at)) v = a.down ? 1 : 6;
    if (v > best.value) best = { value: v, target: a.seat };
  }
  return best;
}

/** Value of everything except movement, for a plan that ends on hex `f`. */
function cardValues(c: Ctx, cards: string[], f: HexKey): number {
  const { s, me } = c;
  let score = 0;
  const onBody = bodySet(s).has(f);
  const atCore = onBody && f === s.colossus.center;
  const armorWeight = s.tumble?.kind === 'long' ? 0.15 : s.colossus.armor <= 6 ? 1.6 : s.colossus.armor <= 10 ? 1.25 : 1;
  const d2b = distToBody(s.colossus.center, f);
  let burst = 0;
  for (const card of cards) {
    const d = hunterDef(card);
    if (d.rest) score += restValue(c, cards);
    else if (d.attack || (d.climb && me.climbing)) {
      if (onBody) {
        if (atCore) burst += expectedAttack(me, card);
        else score -= keepCost(card);
      } else if (d.attack && d2b <= d.attack.range) score += expectedAttack(me, card) * armorWeight + (me.cls === 'slasher' ? 0.6 : 0);
      else score -= keepCost(card);
    } else if (d.climb) {
      score += canClimbAt(c, f) ? 14 : -keepCost(card);
    } else if (d.ability === 'hymn') {
      let heal = 0;
      for (const a of s.hunters) {
        if (a.down) continue;
        const at = a.seat === me.seat ? f : c.team.dests.get(a.seat) ?? a.pos;
        if (dist(at, f) <= 3) heal += Math.min(2, a.maxHp - a.hp) * (a.hp <= 5 ? 1.4 : 0.9);
      }
      score += heal > 0 ? heal : -keepCost(card);
    } else if (d.ability === 'anchor') {
      if (!c.T.adjacent.has(f)) score -= keepCost(card);
    } else if (d.ability === 'beam') {
      score += beamValue(c).value || -keepCost(card);
    } else if (d.move) {
      score -= keepCost(card);
    }
  }
  if (cards.some((x) => hunterDef(x).attack) && !onBody) score -= shellRisk(c);
  if (onBody) {
    // The climb: break the core with the Burst before the shake-off, or take the fall.
    const need = BURST_TARGET - s.burst;
    const total = burst + c.team.burst;
    const p = total > 0 ? Math.max(0.03, Math.min(0.97, 0.5 + (total - need) / 3)) : 0;
    score += p * STRIKE_VALUE;
    const shakenThisRound = me.climbing && me.mountedRound !== null && me.mountedRound < s.round;
    if (shakenThisRound) score -= (1 - p) * damageCost(c, SHAKE_DAMAGE);
  }
  return score;
}

function evalPlan(c: Ctx, cards: string[], f: HexKey): number {
  const { s, me, T } = c;
  const onBody = bodySet(s).has(f);
  let score = cardValues(c, cards, f);
  if (!onBody) {
    score += positionPreference(s, me, f) * 0.9;
    score -= groundDanger(c, f);
    if (T.nextCubes.has(f)) score -= 1.2;
    if ([...c.team.dests.values()].includes(f)) score -= 4;
    if (revivableNear(s, me, f)) score += 3;
  }
  const pTarget = quickTargetChance(c, f);
  const defs = cards.map(hunterDef);
  if (defs.some((d) => d.parry)) score += pTarget * PARRY_WIN - (1 - pTarget) * 2.4;
  else if (defs.some((d) => d.ability === 'anchor') && T.adjacent.has(f)) score += pTarget * 4;
  else score -= pTarget * damageCost(c, 3);
  return score;
}

/** Every distinct final hex for a set of cards, with the plays that reach it. */
function plansFor(c: Ctx, cards: string[]): Map<HexKey, HunterPlay[]> {
  const from = c.me.pos;
  const out = new Map<HexKey, HunterPlay[]>();
  const moves = cards.filter((x) => hunterDef(x).move);
  const build = (dests: Map<string, HexKey>) =>
    cards.map((card): HunterPlay => {
      const d = dests.get(card);
      const p: HunterPlay = hunterDef(card).ability === 'beam' ? { card, target: beamTarget(c) } : { card };
      return d ? { ...p, dest: d } : p;
    });
  if (moves.length === 0) out.set(from, build(new Map()));
  else if (moves.length === 1) {
    for (const f of c.reach(moves[0], from)) out.set(f, build(f === from ? new Map() : new Map([[moves[0], f]])));
  } else {
    for (const mid of c.reach(moves[0], from)) {
      for (const f of c.reach(moves[1], mid)) {
        if (out.has(f)) continue;
        const m = new Map<string, HexKey>();
        if (mid !== from) m.set(moves[0], mid);
        if (f !== mid) m.set(moves[1], f);
        out.set(f, build(m));
      }
    }
  }
  return out;
}

function beamTarget(c: Ctx): number | undefined {
  return beamValue(c).target ?? c.s.hunters.find((h) => h.seat !== c.me.seat)?.seat;
}

export function hunterBotAction(view: GameState, seat: number, ctx: BotContext): Action {
  const s = view;
  const me = hunterBySeat(s, seat)!;
  const quick = quickAttackChance(s);
  const c: Ctx = {
    s,
    me,
    T: analyzeThreats(s),
    quick,
    aim: quickAimMap(s, quick.any, quick.thrashShare),
    shell: blastingShellChance(s),
    team: teamIntel(s, seat),
    hpFactor: me.hp <= 5 ? 1.9 : me.hp <= 8 ? 1.3 : 1,
    exposedBonus: me.exposed ? 2 : 0,
    reach: (() => {
      const cache = new Map<string, Set<HexKey>>();
      return (card: string, from: HexKey) => {
        const k = `${cardType(card)}|${from}`;
        let r = cache.get(k);
        if (!r) cache.set(k, (r = reachable(s, card, from)));
        return r;
      };
    })(),
  };

  const plans: Scored<Action>[] = [];
  for (const target of revivableAllies(s, seat)) {
    const danger = groundDanger(c, me.pos) + quickTargetChance(c, me.pos) * damageCost(c, 3);
    plans.push({ item: { type: 'Revive', seat, target }, score: 15 - danger });
  }
  for (let k = 0; k <= 2; k++) {
    const seen = new Set<string>();
    for (const cards of combos(me.hand, k)) {
      // Copies of the same card play identically: evaluate each type combination once.
      const sig = cards.map(cardType).join('+');
      if (seen.has(sig)) continue;
      seen.add(sig);
      const scored: Scored<Action>[] = [];
      for (const [f, plays] of plansFor(c, cards)) scored.push({ item: { type: 'CommitHunterCards', seat, plays }, score: evalPlan(c, cards, f) });
      plans.push(...topN(scored, 3));
    }
  }

  const finalists = topN(plans, ctx.difficulty === 'hard' ? 5 : 10);
  for (let attempt = 0; attempt < 4 && finalists.length; attempt++) {
    const pick = softmaxPick(finalists, TEMPERATURE[ctx.difficulty], ctx.rng);
    if (pick.type !== 'CommitHunterCards' || validateHunterPlays(s, seat, pick.plays) === null) return pick;
    finalists.splice(finalists.findIndex((f) => f.item === pick), 1);
  }
  return fallbackHunterAction(s, seat);
}

/** Always legal: pass (commit no cards). */
export function fallbackHunterAction(_s: GameState, seat: number): Action {
  return { type: 'CommitHunterCards', seat, plays: [] };
}
