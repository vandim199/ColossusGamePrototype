// Colossus bot. Its combo, per the GDD: Red Cubes herd Hunters toward the
// hexes that are still safe, and blind Quick Attacks punish the hexes they will
// flee to. It predicts a probability map of where each Hunter ends its move
// (Hunter hands are public by deduction), values every card and aim from that
// map, and makes a weighted random choice so it is not fully predictable.

import {
  ALL_DIRS,
  ALL_HEXES,
  BURST_TARGET,
  DIRS,
  add,
  bodyHexes,
  bodyRing,
  bossDef,
  cardType,
  chargePath,
  coneHexes,
  dist,
  distToBody,
  fullArmor,
  groundHexes,
  hunterDef,
  inBoard,
  isRestCard,
  isSuperRest,
  key,
  lineHexes,
  lockedWhileTumbled,
  maxBossCards,
  parse,
  ringSlamHexes,
  scale,
  stridePath,
  sweepOf,
  swipeHexes,
  tailSweepHexes,
  thrashHexes,
  validateBossPlays,
  type BossPlay,
  type GameState,
  type HexKey,
  type HunterState,
} from '../engine';
import {
  TEMPERATURE,
  analyzeThreats,
  expectedAttack,
  plausibleReach,
  positionPreference,
  softmaxPick,
  topN,
  type BotContext,
  type Scored,
} from './common';

interface Prediction {
  h: HunterState;
  /** Probability of ending this round's movement on each hex (body hexes for climbers). */
  hex: Map<HexKey, number>;
  parryChance: number;
  attackChance: number;
  expAttack: number;
  /** Movement cards left after this round (cubes are lethal to a Hunter who cannot move). */
  movesAfter: number;
}

/** Value of keeping a card for later instead of spending it now. */
const KEEP: Record<string, number> = {
  quickSwipe: 1.0,
  bodyThrash: 1.2,
  feint: 0.3,
  triCone: 0.6,
  lineBurst: 0.4,
  ringSlam: 0.6,
  chargeForward: 0.6,
  tailSweep: 0.3,
  stride: 0.2,
  blastingShell: 0.8,
  rest: 0.5,
  stompQuake: 1.0,
  roar: 1.0,
  wildThrash: 1.6,
  shellHarden: 1.4,
};

function softmaxMap<K>(scores: Map<K, number>, temp: number): Map<K, number> {
  const max = Math.max(...scores.values());
  let total = 0;
  const out = new Map<K, number>();
  for (const [k, v] of scores) {
    const w = Math.exp((v - max) / temp);
    out.set(k, w);
    total += w;
  }
  for (const [k, w] of out) out.set(k, w / total);
  return out;
}

export function predict(s: GameState, careful: boolean): Prediction[] {
  const T = analyzeThreats(s);
  const out: Prediction[] = [];
  const core = s.colossus.center;
  for (const h of s.hunters) {
    if (h.down) continue;
    const attacks = h.hand.filter((c) => hunterDef(c).attack);
    const moves = h.hand.filter((c) => hunterDef(c).move).length;
    const maxRange = Math.max(0, ...attacks.map((c) => hunterDef(c).attack!.range));
    const hasParry = h.hand.some((c) => hunterDef(c).parry);
    const hasClimb = h.hand.some((c) => hunterDef(c).climb);
    const pred: Prediction = {
      h,
      hex: new Map(),
      parryChance: 0,
      attackChance: 0,
      expAttack: attacks.length ? Math.max(...attacks.map((c) => expectedAttack(h, c))) : 0,
      movesAfter: Math.max(0, moves - 1),
    };
    if (h.climbing) {
      // Climbers race for the core.
      const toCore = moves > 0 || h.pos === core;
      pred.hex = new Map(toCore && h.pos !== core ? [[core, 0.85], [h.pos, 0.15]] : [[h.pos, 1]]);
      pred.attackChance = attacks.length ? 0.85 : 0;
    } else {
      const scores = new Map<HexKey, number>();
      // Hunters who can already attack from where they stand tend to stay put.
      const canAttackHere = attacks.length > 0 && distToBody(core, h.pos) <= maxRange;
      for (const x of plausibleReach(s, h)) {
        let v = positionPreference(s, h, x) - 0.35 * dist(h.pos, x);
        if (x === h.pos && canAttackHere) v += 1.5;
        if (T.detonating.has(x)) v -= 8;
        if (T.charged.has(x)) v -= 6;
        if (attacks.length && distToBody(core, x) <= maxRange) v += 2;
        if (s.tumble && hasClimb && T.adjacent.has(x)) v += 5;
        scores.set(x, v);
      }
      pred.hex = softmaxMap(scores, 1.2);
      let inRange = 0;
      let adj = 0;
      for (const [x, p] of pred.hex) {
        if (distToBody(core, x) <= maxRange) inRange += p;
        if (T.adjacent.has(x)) adj += p;
      }
      pred.attackChance = attacks.length ? 0.8 * inRange : 0;
      // Calibrated on simulated Hunters, who rarely Parry unless they read that they are the target.
      pred.parryChance = hasParry && careful ? 0.04 + 0.08 * adj : 0;
    }
    out.push(pred);
  }
  return out;
}

function lethalWeight(h: HunterState, dmg: number): number {
  const total = dmg + (h.exposed ? 2 : 0);
  return h.hp - total <= 0 ? 2.2 : h.hp <= 6 ? 1.3 : 1;
}

function sumProb(preds: Prediction[], hexes: Iterable<HexKey>): number[] {
  const set = new Set(hexes);
  return preds.map((p) => {
    let t = 0;
    for (const [x, pr] of p.hex) if (set.has(x)) t += pr;
    return t;
  });
}

/** Value of a Quick Attack covering these hexes (3 damage each; parries backfire). */
function areaValue(preds: Prediction[], hexes: HexKey[], knockback: boolean): number {
  const probs = sumProb(preds, hexes);
  let v = 0;
  preds.forEach((p, i) => {
    if (!probs[i]) return;
    const hitValue = (3 + (p.h.exposed ? 2 : 0)) * lethalWeight(p.h, 3) + (knockback ? p.expAttack * 0.4 : 0) + (p.h.climbing ? 1 : 0);
    v += probs[i] * ((1 - p.parryChance) * hitValue - p.parryChance * 5);
  });
  return v;
}

/**
 * Theory of mind for Hunter bots: from public information, how likely is each hex to be hit
 * by a Quick Attack this round (target choice spread over the attack's area)?
 */
export function quickAimMap(s: GameState, quickChance: number, thrashShare: number): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  if (quickChance <= 0) return out;
  const preds = predict(s, false);
  const c = s.colossus.center;
  const add = (targets: HexKey[], area: (t: HexKey) => HexKey[], weight: number, knockback: boolean) => {
    const scores = new Map<HexKey, number>();
    for (const t of targets) scores.set(t, areaValue(preds, area(t), knockback));
    if (!scores.size) return;
    for (const [t, p] of softmaxMap(scores, 0.5)) {
      for (const h of area(t)) out.set(h, Math.min(0.95, (out.get(h) ?? 0) + quickChance * weight * p));
    }
  };
  add(bodyRing(c, 1), (t) => swipeHexes(c, t), 1 - thrashShare, true);
  add(ALL_HEXES.filter(inBoardKey), (t) => thrashHexes(c, t), thrashShare, false);
  return out;
}

const inBoardKey = (h: HexKey) => inBoard(parse(h));

function telegraphValue(preds: Prediction[], hexes: HexKey[]): number {
  if (!hexes.length) return -5;
  const probs = sumProb(preds, hexes);
  let v = 0;
  preds.forEach((p, i) => {
    if (p.h.climbing) return;
    v += probs[i] * 2.5;
    if (p.movesAfter === 0) v += probs[i] * 5 * lethalWeight(p.h, 5);
  });
  // Space denial near the Hunters.
  const near = hexes.filter((x) => preds.some((p) => !p.h.climbing && dist(p.h.pos, x) <= 2)).length;
  return v + near * 0.15;
}

/** P(at least `need` of the independent attack chances come true). */
function atLeast(chances: number[], need: number): number {
  let dp = [1];
  for (const c of chances) {
    const next = Array(dp.length + 1).fill(0);
    dp.forEach((p, k) => {
      next[k] += p * (1 - c);
      next[k + 1] += p * c;
    });
    dp = next;
  }
  return dp.slice(need).reduce((a, b) => a + b, 0);
}

/** Candidate aim points: one ground hex per direction around the Colossus (every 30 degrees), plus every Hunter. */
function aimCandidates(s: GameState): HexKey[] {
  const c = s.colossus.center;
  const out = new Set<HexKey>();
  for (const d of ALL_DIRS) {
    const p = parse(c);
    for (const k of [3, 4]) out.add(key(add(p, scale(DIRS[d], k))));
    out.add(key(add(add(p, scale(DIRS[d], 2)), scale(DIRS[(d + 1) % 6], 2))));
  }
  for (const h of s.hunters) if (!h.down && !h.climbing) out.add(h.pos);
  const body = new Set(bodyHexes(c));
  return [...out].filter((h) => inBoardKey(h) && !body.has(h));
}

interface CardOption {
  play: BossPlay;
  value: number;
}

export interface ColossusChoice {
  plays: BossPlay[];
  /** Enraged only: which locked card goes face up. */
  faceUpIndex: number;
}

export function colossusBotPlays(view: GameState, ctx: BotContext): ColossusChoice {
  const s = view;
  const temp = TEMPERATURE[ctx.difficulty];
  const careful = ctx.difficulty !== 'easy';
  const preds = predict(s, careful);
  const c = s.colossus.center;
  const hand = s.colossus.hand;
  const full = fullArmor(s);
  const armorUrgency = s.colossus.armor <= full * 0.3 ? 2.2 : s.colossus.armor <= full * 0.55 ? 1.3 : 0.8;
  const aims = aimCandidates(s);
  const ground = groundHexes(c);

  const usedTargets = new Set<HexKey>();
  const pickTarget = (targets: HexKey[], area: (t: HexKey) => HexKey[], knockback: boolean) => {
    const opts = topN(
      targets.filter((t) => !usedTargets.has(t)).map((t) => ({ item: t, score: areaValue(preds, area(t), knockback) })),
      6,
    );
    if (!opts.length) return null;
    const t = softmaxPick(opts, temp * 0.5, ctx.rng);
    usedTargets.add(t);
    return { t, v: opts.find((o) => o.item === t)!.score };
  };
  const pickAim = (score: (aim: HexKey) => number, pool = aims) => {
    const opts = topN(pool.map((a) => ({ item: a, score: score(a) })), 4);
    const a = softmaxPick(opts, temp * 0.5, ctx.rng);
    return { a, v: opts.find((o) => o.item === a)!.score };
  };

  const active = preds.length;
  const shellNeed = Math.max(1, active - 1);
  const pShell = atLeast(preds.map((p) => p.attackChance), shellNeed);
  const expIncoming = preds.reduce((a, p) => a + p.attackChance * p.expAttack, 0);
  const adjacentMass = sumProb(preds, bodyRing(c, 1));
  const climbers = preds.filter((p) => p.h.climbing);
  // Escape value: a Burst about to land is worth shaking up.
  const burstThreat = climbers.length ? Math.min(1, (s.burst + climbers.reduce((a, p) => a + p.expAttack, 0)) / BURST_TARGET) : 0;

  const options: CardOption[] = [];
  for (const card of hand) {
    if (s.tumble && lockedWhileTumbled(card)) continue;
    const type = cardType(card);
    const keep = KEEP[type] ?? 1;
    let opt: CardOption | null = null;
    switch (type) {
      case 'triCone': {
        const r = pickAim((a) => telegraphValue(preds, coneHexes(c, a)) - 0.5);
        opt = { play: { card, aim: r.a }, value: r.v };
        break;
      }
      case 'lineBurst': {
        const r = pickAim((a) => telegraphValue(preds, lineHexes(c, a)));
        opt = { play: { card, aim: r.a }, value: r.v };
        break;
      }
      case 'ringSlam':
        opt = { play: { card }, value: telegraphValue(preds, ringSlamHexes(c)) - 0.5 };
        break;
      case 'quickSwipe': {
        const r = pickTarget(bodyRing(c, 1), (t) => swipeHexes(c, t), true);
        if (r) opt = { play: { card, targets: [r.t] }, value: r.v };
        break;
      }
      case 'bodyThrash': {
        const r = pickTarget([...ground, ...bodyHexes(c)], (t) => thrashHexes(c, t), false);
        if (r) opt = { play: { card, targets: [r.t] }, value: r.v };
        break;
      }
      case 'wildThrash': {
        const a = pickTarget([...ground, ...bodyHexes(c)], (t) => thrashHexes(c, t), false);
        const b = pickTarget([...ground, ...bodyHexes(c)], (t) => thrashHexes(c, t), false);
        if (a && b) opt = { play: { card, targets: [a.t, b.t] }, value: a.v + b.v };
        break;
      }
      case 'feint':
        opt = { play: { card }, value: preds.reduce((acc, p) => acc + p.parryChance * 3.2, 0) + 0.4 };
        break;
      case 'chargeForward': {
        const r = pickAim((a) => {
          const sweep = sweepOf(c, chargePath(c, a));
          if (!sweep.length) return -3;
          const probs = sumProb(preds, sweep);
          return 0.4 + preds.reduce((acc, p, i) => acc + probs[i] * (p.movesAfter === 0 ? 4 : 0.7), 0) + burstThreat;
        });
        opt = { play: { card, aim: r.a }, value: r.v };
        break;
      }
      case 'tailSweep': {
        const probs = sumProb(preds, tailSweepHexes(c, s.colossus.facing));
        opt = { play: { card }, value: 0.3 + preds.reduce((acc, p, i) => acc + probs[i] * (p.movesAfter === 0 ? 4 : 0.7), 0) };
        break;
      }
      case 'stride': {
        const r = pickAim((a) => {
          const path = stridePath(c, a, 2);
          if (!path.length) return -3;
          const probs = sumProb(preds, sweepOf(c, path));
          const trample = preds.reduce((acc, p, i) => acc + probs[i] * 2 * lethalWeight(p.h, 2), 0);
          // Walk toward the Hunters it cannot reach, away from the edge of the arena.
          const to = path[path.length - 1];
          const ranged = preds.filter((p) => !p.h.climbing && distToBody(c, p.h.pos) >= 3);
          const approach = ranged.reduce((acc, p) => acc + (dist(c, p.h.pos) - dist(to, p.h.pos)), 0) * 0.25;
          const edge = bodyRing(to, 1).length < 12 ? -0.4 : 0;
          return trample + approach + edge + 0.6 * burstThreat;
        });
        opt = { play: { card, aim: r.a }, value: r.v };
        break;
      }
      case 'blastingShell':
        opt = { play: { card }, value: pShell * (3 + 2 * shellNeed) * Math.max(1, armorUrgency * 0.8) - (1 - pShell) * 2 };
        break;
      case 'rest': {
        const restore = Math.min(2, full - s.colossus.armor);
        opt = { play: { card }, value: restore * armorUrgency + s.colossus.discard.length * 0.25 - 1.5 };
        break;
      }
      case 'stompQuake':
        opt = { play: { card }, value: preds.reduce((acc, p, i) => acc + (p.h.climbing ? 2.5 : adjacentMass[i] * 2 * lethalWeight(p.h, 2)), 0) };
        break;
      case 'roar':
        opt = { play: { card }, value: preds.reduce((acc, p, i) => acc + adjacentMass[i] * p.expAttack * 0.6 + p.parryChance * 2, 0) };
        break;
      case 'shellHarden': {
        const gained = Math.min(4, full - s.colossus.armor);
        opt = { play: { card }, value: gained * 0.7 * armorUrgency + expIncoming * 0.5 * armorUrgency + burstThreat * 3 };
        break;
      }
    }
    if (opt) options.push({ play: opt.play, value: opt.value - keep });
  }

  // ---- choose the best set of 1..max cards, then a weighted random pick
  const max = maxBossCards(s);
  const combos: Scored<BossPlay[]>[] = [];
  const pick = (start: number, acc: CardOption[]) => {
    if (acc.length) {
      const plays = acc.map((o) => {
        const p = { ...o.play };
        // A Super Rest also places its free cube where a Hunter is likely to stand.
        if (isRestCard(p.card) && isSuperRest(hand, acc.map((x) => x.play.card))) p.hex = bestCubeHex(preds, c);
        return p;
      });
      combos.push({ item: plays, score: acc.reduce((a, o) => a + o.value, 0) });
    }
    if (acc.length === max) return;
    for (let i = start; i < options.length; i++) pick(i + 1, [...acc, options[i]]);
  };
  pick(0, []);

  const finalists = topN(combos, ctx.difficulty === 'hard' ? 4 : 8);
  for (let attempt = 0; attempt < 4 && finalists.length; attempt++) {
    const plays = softmaxPick(finalists, temp, ctx.rng);
    if (!validateBossPlays(s, plays)) return { plays, faceUpIndex: faceUpChoice(plays) };
    finalists.splice(finalists.findIndex((f) => f.item === plays), 1);
  }
  return { plays: fallbackBossPlays(s), faceUpIndex: 0 };
}

function bestCubeHex(preds: Prediction[], center: HexKey): HexKey | undefined {
  const body = new Set(bodyHexes(center));
  let best: HexKey | undefined;
  let bestP = 0;
  for (const p of preds) for (const [x, pr] of p.hex) if (!body.has(x) && pr > bestP) [best, bestP] = [x, pr];
  return best;
}

/** Enraged: reveal the card that gives away the least (telegraphs are already public through their cubes). */
function faceUpChoice(plays: BossPlay[]): number {
  const rank = (p: BossPlay) => {
    const k = bossDef(p.card).kind;
    return k === 'telegraph' ? 0 : k === 'rest' ? 1 : k === 'move' ? 2 : k === 'charged' ? 3 : k === 'reaction' ? 4 : cardType(p.card) === 'feint' ? 5 : 6;
  };
  let best = 0;
  plays.forEach((p, i) => {
    if (rank(p) < rank(plays[best])) best = i;
  });
  return best;
}

/** Always-legal lock: a single simple card. */
export function fallbackBossPlays(s: GameState): BossPlay[] {
  const target = s.hunters.find((h) => !h.down)?.pos ?? bodyRing(s.colossus.center, 1)[0];
  for (const card of s.colossus.hand) {
    const def = bossDef(card);
    const play: BossPlay = { card };
    if (def.needs === 'aim') play.aim = groundHexes(s.colossus.center)[0];
    if (def.needs === 'adjacentHex') play.targets = [bodyRing(s.colossus.center, 1)[0]];
    if (def.needs === 'anyHex') play.targets = [target];
    if (def.needs === 'twoHexes') play.targets = [target, target];
    if (!validateBossPlays(s, [play])) return [play];
  }
  return [{ card: s.colossus.hand[0] }];
}
