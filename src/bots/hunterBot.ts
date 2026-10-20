// Hunter bot: a one-ply planner. It enumerates every legal card combination
// and destination, scores each plan, then makes a weighted random choice among
// the best few (lower temperature = sharper play).
//
// Behaviour the GDD asks for: dodge cube lanes, Parry sometimes (more when the
// Colossus has Quick cards left and the bot is adjacent), focus Armor, climb
// during Tumbles, and Rest smartly around the fatigue clock. Bots read their
// teammates' face-up commits so they play sensibly alongside humans.

import {
  LEGS,
  NODE_LINKS,
  NODE_POINTS,
  bodyRing,
  cardType,
  dist,
  distToBody,
  hunterBySeat,
  hunterDef,
  isFree,
  isRestCard,
  reachable,
  requiredHunterCount,
  revivableAllies,
  validateHunterPlays,
  validateRest,
  type Action,
  type GameState,
  type HexKey,
  type HunterPlay,
  type HunterState,
  type NodeId,
} from '../engine';
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
import { quickAimMap } from './colossusBot';

const PARRY_WIN = 22;

/** Cost of spending a card without getting its effect (it is unavailable until the next Rest). */
function keepCost(card: string): number {
  const d = hunterDef(card);
  if (d.climb) return 3.5;
  if (d.attack) return 1.3;
  if (d.parry) return 0.7;
  if (d.ability) return 0.9;
  if (d.move?.kind !== 'walk') return 0.6;
  return 0.25;
}

/** How much a card is worth keeping in the deck when choosing what to burn. */
function burnKeepValue(me: HunterState, card: string): number {
  const d = hunterDef(card);
  if (d.climb) return 7;
  if (d.attack) return d.move ? 6.5 : 6;
  if (d.ability === 'hymn') return 4.5;
  if (d.ability) return 4;
  if (d.parry) return 3;
  if (d.move) {
    const deck = [...me.hand, ...me.discard];
    const moves = deck.filter((c) => hunterDef(c).move).length;
    const base = d.move.kind === 'walk' ? 1.5 + d.move.range * 0.3 : 3;
    return base + (moves <= 2 ? 5 : moves <= 3 ? 1.5 : 0);
  }
  return 2;
}

export function chooseBurn(me: HunterState): string {
  return [...me.discard].sort((a, b) => burnKeepValue(me, a) - burnKeepValue(me, b))[0];
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
}

function teamIntel(s: GameState, seat: number): TeamIntel {
  const dests = new Map<number, HexKey>();
  const climbers = new Set<number>();
  let attackers = 0;
  let uncommitted = 0;
  for (const h of s.hunters) {
    if (h.seat === seat || h.exhausted || h.down) continue;
    const c = s.commits[h.seat - 1];
    if (!c) uncommitted++;
    else if (c.kind === 'cards' && c.plays.some((p) => hunterDef(p.card).attack || (hunterDef(p.card).climb && h.node))) attackers++;
    if (!h.pos) continue;
    let pos = h.pos;
    if (c?.kind === 'cards') {
      for (const p of c.plays) {
        if (hunterDef(p.card).move && p.dest) pos = p.dest;
        if (hunterDef(p.card).climb) climbers.add(h.seat);
      }
    }
    dests.set(h.seat, pos);
  }
  return { dests, climbers, attackers, uncommitted };
}

interface Ctx {
  s: GameState;
  me: HunterState;
  T: Threats;
  quick: { any: number; thrashShare: number };
  /** Chance the Colossus locked Blasting Shell this round (public deduction). */
  shell: number;
  /** P(a Quick Attack is aimed at each hex), from a model of the Colossus. */
  aim: Map<HexKey, number>;
  team: TeamIntel;
  hpFactor: number;
  exposedBonus: number;
}

function damageCost(c: Ctx, dmg: number): number {
  const total = dmg + c.exposedBonus;
  return total * c.hpFactor + (c.me.hp - total <= 0 ? 14 : 0);
}

/** Chance a single-target Quick Attack lands on this hex. */
function quickTargetChance(c: Ctx, hex: HexKey): number {
  // The aim model runs low against the real Colossus bot (an estimate of 0.25 is hit ~40% of the time).
  return Math.min(0.95, 1.4 * (c.aim.get(hex) ?? 0));
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
  if (t.kind === 'long') return true;
  if (t.parrier === c.me.seat) return true;
  const parrier = t.parrier ? hunterBySeat(c.s, t.parrier) : undefined;
  if (!parrier?.pos || c.team.climbers.has(parrier.seat)) return false;
  if (dist(parrier.pos, hex) !== 1) return false;
  // Lower seats get the slot first; do not contest an ally who already committed to it.
  return ![...c.team.climbers].some((seat) => seat < c.me.seat);
}

function evalGround(c: Ctx, cards: string[], f: HexKey): number {
  const { s, me, T } = c;
  let score = positionPreference(s, me, f) * 0.9;
  score -= groundDanger(c, f);
  if (T.nextCubes.has(f)) score -= 1.2;
  if ([...c.team.dests.values()].includes(f)) score -= 4;
  if (revivableNear(s, me, f)) score += 3;

  const defs = cards.map(hunterDef);
  const pTarget = quickTargetChance(c, f);
  if (defs.some((d) => d.parry)) {
    // A deflected Quick Attack means no damage, a Tumble, a cancelled Charge and a climb window
    // worth a point or two (valued like the body-board strikes below); a whiff means Exposed.
    score += pTarget * PARRY_WIN - (1 - pTarget) * 2.4;
  } else if (defs.some((d) => d.ability === 'anchor') && T.adjacent.has(f)) {
    const alliesNear = [...c.team.dests.values()].filter((h) => dist(h, f) === 1).length;
    score += pTarget * (3 + 2 * alliesNear) - pTarget * 0;
  } else {
    score -= pTarget * damageCost(c, 3);
  }

  if (defs.some((d) => d.attack)) score -= shellRisk(c);
  const armorWeight = s.tumble?.kind === 'long' ? 0.15 : s.colossus.armor <= 6 ? 1.6 : s.colossus.armor <= 10 ? 1.25 : 1;
  const d2b = distToBody(s.colossus.center, f);
  for (const card of cards) {
    const d = hunterDef(card);
    if (d.attack) {
      if (d2b <= d.attack.range) score += expectedAttack(me, card) * armorWeight + (me.cls === 'slasher' ? 0.6 : 0);
      else score -= keepCost(card);
    } else if (d.climb) {
      score += canClimbAt(c, f) ? 16 + (s.tumble?.kind === 'short' ? 2 : 0) : -keepCost(card);
    } else if (d.ability === 'hymn') {
      let heal = 0;
      for (const a of s.hunters) {
        if (a.exhausted || a.down || !a.pos) continue;
        const at = a.seat === me.seat ? f : c.team.dests.get(a.seat) ?? a.pos;
        if (dist(at, f) <= 3) heal += Math.min(2, a.maxHp - a.hp) * (a.hp <= 5 ? 1.4 : 0.9);
      }
      score += heal > 0 ? heal : -keepCost(card);
    } else if (d.ability === 'anchor') {
      if (!T.adjacent.has(f)) score -= keepCost(card);
    } else if (d.move) {
      score -= keepCost(card);
    } else if (d.parry) {
      // valued above
    } else if (d.ability === 'beam') {
      score += beamValue(c).value || -keepCost(card);
    }
  }
  return score;
}

/** Blasting Shell punishes "all but one Hunter attacking": count committed allies and guess the rest. */
function shellRisk(c: Ctx): number {
  if (c.shell <= 0) return 0;
  const active = c.s.hunters.filter((h) => !h.down && !h.exhausted).length;
  const need = Math.max(1, active - 1);
  const expected = c.team.attackers + 1 + 0.65 * c.team.uncommitted;
  if (expected < need - 0.3) return 0;
  return c.shell * (damageCost(c, 2) + 2);
}

function blastingShellChance(s: GameState): number {
  const { base, hiddenRage } = deducedBossHand(s);
  if (!base.some((x) => cardType(x) === 'blastingShell')) return 0;
  const nonRest = base.filter((x) => !isRestCard(x)).length + hiddenRage;
  const k = s.lock ? s.lock.cardCount - (s.lock.cubes.length >= 3 ? 1 : 0) : s.colossus.enraged ? 3 : 2;
  return Math.min(0.75, (Math.max(0, k) / Math.max(1, nonRest)) * 1.6);
}

function revivableNear(s: GameState, me: HunterState, f: HexKey): boolean {
  return s.hunters.some((t) => t.seat !== me.seat && t.down && !t.revived && !t.exhausted && t.pos && dist(t.pos, f) === 1);
}

/** Pull an ally out of a detonating lane or the Charge path, if one is within 5. */
function beamValue(c: Ctx): { value: number; target?: number } {
  const { s, me } = c;
  if (!me.pos) return { value: 0 };
  let best = { value: 0, target: undefined as number | undefined };
  for (const a of s.hunters) {
    if (a.seat === me.seat || a.exhausted || !a.pos || dist(a.pos, me.pos) > 5) continue;
    const at = c.team.dests.get(a.seat) ?? a.pos;
    let v = 0;
    if (c.T.detonating.has(at) || c.T.charged.has(at)) v = a.down ? 1 : 6;
    else if (a.down && dist(a.pos, me.pos) > 1) v = 1.5;
    if (v > best.value) best = { value: v, target: a.seat };
  }
  return best;
}

function withParams(c: Ctx, card: string): HunterPlay {
  const d = hunterDef(card);
  if (d.ability === 'beam') {
    const target = beamValue(c).target ?? c.s.hunters.find((h) => h.seat !== c.me.seat && !h.exhausted)?.seat;
    return { card, target };
  }
  if (d.climb) return { card, node: LEGS[0] };
  return { card };
}

/** Every distinct final hex for a set of cards, with the plays that reach it. */
function groundPlans(c: Ctx, cards: string[]): Map<HexKey, HunterPlay[]> {
  const from = c.me.pos!;
  const out = new Map<HexKey, HunterPlay[]>();
  const moves = cards.filter((x) => hunterDef(x).move);
  const build = (dests: Map<string, HexKey>) =>
    cards.map((card) => {
      const p = withParams(c, card);
      const d = dests.get(card);
      return d ? { ...p, dest: d } : p;
    });
  if (moves.length === 0) out.set(from, build(new Map()));
  else if (moves.length === 1) {
    for (const f of reachable(c.s, moves[0], from)) out.set(f, build(f === from ? new Map() : new Map([[moves[0], f]])));
  } else {
    for (const mid of reachable(c.s, moves[0], from)) {
      for (const f of reachable(c.s, moves[1], mid)) {
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

function bodyPlans(c: Ctx, cards: string[]): Scored<HunterPlay[]>[] {
  const { s, me } = c;
  const out: Scored<HunterPlay[]>[] = [];
  const moves = cards.filter((x) => hunterDef(x).move);
  const strikes = cards.some((x) => hunterDef(x).attack || hunterDef(x).climb);
  const landing = bodyRing(s.colossus.center, 1)
    .filter((h) => isFree(s, h, me.seat))
    .sort((a, b) => groundDanger(c, a) - groundDanger(c, b))[0];

  type Step = { node?: NodeId; jump?: HexKey };
  const seqs: Step[][] = [[]];
  for (let i = 0; i < moves.length; i++) {
    const next: Step[][] = [];
    for (const seq of seqs) {
      const cur = seq.reduce<NodeId | null>((n, st) => (st.jump ? null : st.node ?? n), me.node);
      next.push([...seq, {}]);
      if (!cur) continue;
      for (const n of NODE_LINKS[cur]) next.push([...seq, { node: n }]);
      if (landing) next.push([...seq, { jump: landing }]);
    }
    seqs.splice(0, seqs.length, ...next);
  }

  const pThrash = c.quick.any * Math.max(0.35, c.quick.thrashShare) * 0.8;
  for (const seq of seqs) {
    let node: NodeId | null = me.node;
    let grip = me.grip;
    let pos: HexKey | null = null;
    for (const st of seq) {
      if (st.jump) {
        node = null;
        pos = st.jump;
      } else if (st.node && node) {
        node = st.node;
        grip--;
      }
    }
    let score = 0;
    if (pos) {
      score = 1.5 - groundDanger(c, pos) - quickTargetChance(c, pos) * damageCost(c, 3);
    } else if (node) {
      if (grip <= 0) score -= 12 + damageCost(c, 3);
      const pts = NODE_POINTS[node];
      if (strikes && pts > 0 && !s.spentNodes.includes(node)) {
        score += pts * (s.points + pts >= s.target ? 80 : 18);
      } else if (strikes) score -= 1.3;
      score -= pThrash * (damageCost(c, 3) + (grip - 3 <= 0 ? 8 : 3));
      const gripAfter = grip - (s.tumble ? 0 : 1);
      if (gripAfter <= 0) score -= 9;
      // Potential: unspent vital nodes still within reach of the Grip left.
      const ahead = (['B1', 'B2', 'H1', 'H2'] as NodeId[]).filter((n) => !s.spentNodes.includes(n) && n !== node);
      score += Math.min(gripAfter, ahead.length) * 1.5;
    }
    const plays: HunterPlay[] = [];
    let mi = 0;
    for (const card of cards) {
      if (hunterDef(card).move) {
        const st = seq[mi++];
        plays.push(st.jump ? { card, jump: st.jump } : st.node ? { card, node: st.node } : { card });
      } else plays.push(withParams(c, card));
    }
    out.push({ item: plays, score });
  }
  return out;
}

function restScore(c: Ctx): number {
  const { me } = c;
  if (me.discard.length === 0) return -Infinity;
  const deckAfter = me.hand.length + me.discard.length - 1;
  if (deckAfter < 4) return -100;
  const heal = Math.min(2, me.maxHp - me.hp);
  const urgency = me.hp <= 4 ? 3.2 : me.hp <= 7 ? 1.2 : 0.3;
  let score = heal * urgency - 4.5;
  if (me.pos) score -= groundDanger(c, me.pos) + quickTargetChance(c, me.pos) * damageCost(c, 3);
  return score;
}

export function hunterBotAction(view: GameState, seat: number, ctx: BotContext): Action {
  const s = view;
  const me = hunterBySeat(s, seat)!;
  const rest = (): Action => ({ type: 'Rest', seat, burn: chooseBurn(me) });
  const need = requiredHunterCount(me);
  if (need === 0) return rest();

  const c: Ctx = {
    s,
    me,
    T: analyzeThreats(s),
    quick: quickAttackChance(s),
    shell: blastingShellChance(s),
    aim: new Map(),
    team: teamIntel(s, seat),
    hpFactor: me.hp <= 5 ? 1.9 : me.hp <= 8 ? 1.3 : 1,
    exposedBonus: me.exposed ? 2 : 0,
  };

  c.aim = quickAimMap(s, c.quick.any, c.quick.thrashShare);
  const plans: Scored<Action>[] = [];
  if (me.discard.length && !validateRest(s, seat, chooseBurn(me))) plans.push({ item: rest(), score: restScore(c) });
  for (const target of revivableAllies(s, seat)) {
    const danger = me.pos ? groundDanger(c, me.pos) + quickTargetChance(c, me.pos) * damageCost(c, 3) : 0;
    plans.push({ item: { type: 'Revive', seat, target }, score: 15 - danger });
  }

  const nonRest = me.hand.filter((x) => !isRestCard(x));
  for (const cards of combos(nonRest, need)) {
    const defs = cards.map(hunterDef);
    if (cards.length === 2 && defs.some((d) => d.parry) && !defs.some((d) => d.move)) continue;
    if (me.node) {
      for (const p of bodyPlans(c, cards)) plans.push({ item: { type: 'CommitHunterCards', seat, plays: p.item }, score: p.score });
    } else if (me.pos) {
      const scored: Scored<Action>[] = [];
      for (const [f, plays] of groundPlans(c, cards)) {
        scored.push({ item: { type: 'CommitHunterCards', seat, plays }, score: evalGround(c, cards, f) });
      }
      plans.push(...topN(scored, 3));
    }
  }

  const finalists = topN(plans, ctx.difficulty === 'hard' ? 5 : 10);
  for (let attempt = 0; attempt < 4 && finalists.length; attempt++) {
    const pick = softmaxPick(finalists, TEMPERATURE[ctx.difficulty], ctx.rng);
    if (isLegal(s, pick)) return pick;
    finalists.splice(finalists.findIndex((f) => f.item === pick), 1);
  }
  return fallbackHunterAction(s, seat);
}

function isLegal(s: GameState, a: Action): boolean {
  if (a.type === 'CommitHunterCards') return validateHunterPlays(s, a.seat, a.plays) === null;
  if (a.type === 'Rest') return validateRest(s, a.seat, a.burn) === null;
  return true;
}

/** Always-legal action: play cards in place (Parry last), Rest only when nothing else is legal. */
export function fallbackHunterAction(s: GameState, seat: number): Action {
  const me = hunterBySeat(s, seat)!;
  const nonRest = me.hand.filter((x) => !isRestCard(x)).sort((a, b) => Number(cardType(a) === 'parry') - Number(cardType(b) === 'parry'));
  const need = Math.min(2, nonRest.length);
  const ally = s.hunters.find((h) => h.seat !== seat && !h.exhausted)?.seat;
  if (need > 0) {
    for (const cards of combos(nonRest, need)) {
      const plays = cards.map((card): HunterPlay => (hunterDef(card).ability === 'beam' ? { card, target: ally } : { card }));
      if (!validateHunterPlays(s, seat, plays)) return { type: 'CommitHunterCards', seat, plays };
    }
  }
  return { type: 'Rest', seat, burn: me.discard.length ? chooseBurn(me) : me.hand[0] };
}
