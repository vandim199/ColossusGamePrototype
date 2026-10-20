// Colossus bot. Its one combo, per the GDD: Red Cubes herd Hunters toward the
// hexes that are still safe, and blind Quick Attacks punish the hexes they will
// flee to. It predicts a probability map of where each Hunter ends its move
// (Hunter hands are public by deduction), values every card and target from
// that map, and makes a weighted random choice so it is not fully predictable.

import {
  ALL_DIRS,
  CUBE_BUDGET,
  NODE_LINKS,
  NODE_POINTS,
  ALL_HEXES,
  bodyHexes,
  bodyRing,
  bossDef,
  cardType,
  chargePath,
  chargeSweep,
  cubesForPlays,
  cubesOnBoard,
  dist,
  distToBody,
  fullArmor,
  hunterDef,
  isRestCard,
  isSuperRestNow,
  lineBurstHexes,
  requiredBossCount,
  ringSlamHexes,
  tailSweepHexes,
  triConeHexes,
  validateBossPlays,
  type BossPlay,
  type BossTarget,
  type GameState,
  type HexKey,
  type HunterState,
  type NodeId,
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
  /** Probability of ending this round's movement on each ground hex. */
  hex: Map<HexKey, number>;
  /** Climbers: probability of ending on each node. */
  node: Map<NodeId, number>;
  parryChance: number;
  attackChance: number;
  expAttack: number;
  /** Movement cards left after this round (cubes are lethal to a Hunter who cannot move). */
  movesAfter: number;
}

const KEEP: Record<string, number> = {
  quickSwipe: 1.0,
  bodyThrash: 1.3,
  feint: 0.3,
  triCone: 0.5,
  lineBurst: 0.4,
  ringSlam: 0.6,
  chargeForward: 0.6,
  tailSweep: 0.3,
  blastingShell: 0.8,
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
  for (const h of s.hunters) {
    if (h.down || h.exhausted) continue;
    const attacks = h.hand.filter((c) => hunterDef(c).attack);
    const moves = h.hand.filter((c) => hunterDef(c).move).length;
    const maxRange = Math.max(0, ...attacks.map((c) => hunterDef(c).attack!.range));
    const hasParry = h.hand.some((c) => hunterDef(c).parry) && (moves > 0 || h.hand.filter((c) => !isRestCard(c)).length === 1);
    const hasClimb = h.hand.some((c) => hunterDef(c).climb);
    const pred: Prediction = {
      h,
      hex: new Map(),
      node: new Map(),
      parryChance: 0,
      attackChance: 0,
      expAttack: attacks.length ? Math.max(...attacks.map((c) => expectedAttack(h, c))) : 0,
      movesAfter: Math.max(0, moves - 1),
    };
    if (h.node) {
      const scores = new Map<NodeId, number>([[h.node, 0]]);
      if (moves > 0) {
        for (const n of NODE_LINKS[h.node]) scores.set(n, NODE_POINTS[n] > 0 && !s.spentNodes.includes(n) ? NODE_POINTS[n] * 3 : -0.5);
      }
      pred.node = softmaxMap(scores, 1);
      pred.attackChance = attacks.length ? 0.85 : 0;
    } else if (h.pos) {
      const scores = new Map<HexKey, number>();
      // Hunters who can already attack from where they stand tend to stay put (every
      // move card spent is one less attack), so the current hex gets extra weight.
      const canAttackHere = attacks.length > 0 && distToBody(s.colossus.center, h.pos) <= maxRange;
      for (const x of plausibleReach(s, h)) {
        let v = positionPreference(s, h, x) - 0.35 * dist(h.pos, x);
        if (x === h.pos && canAttackHere) v += 1.5;
        if (T.detonating.has(x)) v -= 8;
        if (T.charged.has(x)) v -= 6;
        if (attacks.length && distToBody(s.colossus.center, x) <= maxRange) v += 2;
        if (s.tumble && hasClimb && T.adjacent.has(x)) v += 5;
        scores.set(x, v);
      }
      pred.hex = softmaxMap(scores, 1.2);
      let inRange = 0;
      for (const [x, p] of pred.hex) if (distToBody(s.colossus.center, x) <= maxRange) inRange += p;
      pred.attackChance = attacks.length ? 0.8 * inRange : 0;
      let adj = 0;
      for (const [x, p] of pred.hex) if (T.adjacent.has(x)) adj += p;
      // Calibrated on simulated Hunters, who Parry on roughly 1 in 8 adjacent turns while holding the card.
      pred.parryChance = hasParry && careful ? 0.03 + 0.06 * adj : 0;
    }
    out.push(pred);
  }
  return out;
}

function lethalWeight(h: HunterState, dmg: number): number {
  const total = dmg + (h.exposed ? 2 : 0);
  return h.hp - total <= 0 ? 2.2 : h.hp <= 6 ? 1.3 : 1;
}

/** Value of one single-target Quick Attack on a ground hex or body node. */
export function quickValue(preds: Prediction[], t: BossTarget, swipe: boolean): number {
  let v = 0;
  for (const p of preds) {
    if (t.node) {
      const pr = p.node.get(t.node) ?? 0;
      if (!pr) continue;
      const fallBonus = p.h.grip - 3 <= 0 ? 6 : 2;
      const denial = NODE_POINTS[t.node] > 0 ? NODE_POINTS[t.node] * 3 : 0;
      v += pr * ((3 + (p.h.exposed ? 2 : 0)) * lethalWeight(p.h, 3) + fallBonus + denial);
      continue;
    }
    const pr = p.hex.get(t.hex!) ?? 0;
    if (!pr) continue;
    const hitValue = (3 + (p.h.exposed ? 2 : 0)) * lethalWeight(p.h, 3) + (swipe ? p.expAttack * 0.4 : 0);
    v += pr * ((1 - p.parryChance) * hitValue - p.parryChance * 5);
  }
  return v;
}

function sumProb(preds: Prediction[], hexes: Iterable<HexKey>): number[] {
  const set = new Set(hexes);
  return preds.map((p) => {
    let t = 0;
    for (const [x, pr] of p.hex) if (set.has(x)) t += pr;
    return t;
  });
}

function telegraphValue(s: GameState, preds: Prediction[], hexes: HexKey[]): number {
  if (!hexes.length) return -5;
  const probs = sumProb(preds, hexes);
  let v = 0;
  preds.forEach((p, i) => {
    v += probs[i] * 2.5;
    if (p.movesAfter === 0) v += probs[i] * 5 * lethalWeight(p.h, 5);
  });
  const near = hexes.filter((x) => preds.some((p) => p.h.pos && dist(p.h.pos, x) <= 2)).length;
  v += near * 0.25;
  return v - hexes.length * 0.02 * (cubesOnBoard(s) / CUBE_BUDGET) * 10;
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

/**
 * Theory of mind for Hunter bots: from public information, how likely is each
 * ground hex to be aimed at by a single-target Quick Attack this round?
 */
export function quickAimMap(s: GameState, quickChance: number, thrashShare: number): Map<HexKey, number> {
  const out = new Map<HexKey, number>();
  if (quickChance <= 0) return out;
  // Hunters read where the Colossus *wants* to hit, ignoring its fear of their Parry (that is the bluff).
  const preds = predict(s, false);
  const ring = bodyRing(s.colossus.center, 1);
  const body = new Set(bodyHexes(s.colossus.center));
  const add = (pool: HexKey[], weight: number, swipe: boolean) => {
    const scores = new Map<HexKey, number>();
    for (const hex of pool) scores.set(hex, quickValue(preds, { hex }, swipe));
    if (!scores.size) return;
    const max = Math.max(...scores.values());
    let total = 0;
    const w = new Map<HexKey, number>();
    for (const [h, v] of scores) {
      const e = Math.exp((v - max) / 0.5);
      w.set(h, e);
      total += e;
    }
    for (const [h, e] of w) out.set(h, (out.get(h) ?? 0) + (quickChance * weight * e) / total);
  };
  add(ring, 1 - thrashShare, true);
  add(ALL_HEXES.filter((h) => !body.has(h)), thrashShare, false);
  return out;
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
  const hand = s.colossus.hand;
  const restCard = hand.find(isRestCard);
  const need = requiredBossCount(s);
  const full = fullArmor(s);
  const armorUrgency = s.colossus.armor <= full * 0.3 ? 2.2 : s.colossus.armor <= full * 0.55 ? 1.3 : 0.8;

  const restPlay = (): BossPlay => {
    const play: BossPlay = { card: restCard! };
    if (isSuperRestNow(hand)) {
      const scores = new Map<HexKey, number>();
      for (const x of ALL_HEXES) if (!bodyHexes(s.colossus.center).includes(x)) scores.set(x, sumProb(preds, [x]).reduce((a, b) => a + b, 0));
      const best = [...scores].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0 && cubesOnBoard(s) < CUBE_BUDGET) play.hex = best[0];
    }
    return play;
  };
  if (need === 0 && restCard) return { plays: [restPlay()], faceUpIndex: 0 };

  // ---- value every card with its best (randomised) targeting
  const usedTargets = new Set<string>();
  const targetKey = (t: BossTarget) => t.node ?? t.hex!;
  const groundTargets = ALL_HEXES.filter((x) => !bodyHexes(s.colossus.center).includes(x));
  const quickOptions = (swipe: boolean): Scored<BossTarget>[] => {
    const opts: Scored<BossTarget>[] = [];
    const hexes = swipe ? bodyRing(s.colossus.center, 1) : groundTargets;
    for (const hex of hexes) opts.push({ item: { hex }, score: quickValue(preds, { hex }, swipe) });
    if (!swipe) for (const n of ['L1', 'L2', 'B1', 'B2', 'H1', 'H2'] as NodeId[]) opts.push({ item: { node: n }, score: quickValue(preds, { node: n }, false) });
    return opts;
  };
  const pickTarget = (swipe: boolean): { t: BossTarget; v: number } | null => {
    const opts = topN(quickOptions(swipe).filter((o) => !usedTargets.has(targetKey(o.item))), 6);
    if (!opts.length) return null;
    // Readable, not robotic: it usually aims at the best-predicted hex, so a good read can Parry it.
    const t = softmaxPick(opts, temp * 0.5, ctx.rng);
    usedTargets.add(targetKey(t));
    return { t, v: opts.find((o) => o.item === t)!.score };
  };

  const active = preds.length;
  const shellNeed = Math.max(1, active - 1);
  const pShell = atLeast(preds.map((p) => p.attackChance), shellNeed);
  const expIncoming = preds.reduce((a, p) => a + p.attackChance * p.expAttack, 0);
  const adjacentMass = sumProb(preds, bodyRing(s.colossus.center, 1));

  const options: CardOption[] = [];
  for (const card of hand) {
    if (isRestCard(card)) continue;
    const def = bossDef(card);
    if (def.kind === 'charged' && s.tumble) continue;
    const type = cardType(card);
    const keep = KEEP[type] ?? 1;
    let best: CardOption | null = null;
    const consider = (play: BossPlay, value: number) => {
      if (!best || value > best.value) best = { play, value };
    };
    switch (type) {
      case 'triCone':
      case 'lineBurst': {
        const opts: Scored<BossPlay>[] = ALL_DIRS.map((dir) => {
          const hexes = type === 'triCone' ? triConeHexes(s.colossus.center, dir) : lineBurstHexes(s.colossus.center, dir);
          return { item: { card, dir }, score: telegraphValue(s, preds, hexes) };
        });
        const play = softmaxPick(topN(opts, 3), temp * 0.6, ctx.rng);
        consider(play, opts.find((o) => o.item === play)!.score);
        break;
      }
      case 'ringSlam':
        consider({ card }, telegraphValue(s, preds, ringSlamHexes(s.colossus.center)));
        break;
      case 'quickSwipe':
      case 'bodyThrash': {
        const r = pickTarget(type === 'quickSwipe');
        if (r) consider({ card, targets: [r.t] }, r.v);
        break;
      }
      case 'wildThrash': {
        const a = pickTarget(false);
        const b = pickTarget(false);
        if (a && b) consider({ card, targets: [a.t, b.t] }, a.v + b.v);
        break;
      }
      case 'feint': {
        const v = preds.reduce((acc, p) => acc + p.parryChance * 3.2, 0) + 0.4;
        consider({ card }, v);
        break;
      }
      case 'chargeForward':
        for (const dir of ALL_DIRS) {
          if (!chargePath(s.colossus.center, dir).length) continue;
          const probs = sumProb(preds, chargeSweep(s.colossus.center, dir));
          const v = 0.5 + preds.reduce((acc, p, i) => acc + probs[i] * (p.movesAfter === 0 ? 4 : 0.7), 0);
          consider({ card, dir }, v + ctx.rng.next() * 0.3);
        }
        break;
      case 'tailSweep': {
        const probs = sumProb(preds, tailSweepHexes(s.colossus.center, s.colossus.facing));
        consider({ card }, 0.3 + preds.reduce((acc, p, i) => acc + probs[i] * (p.movesAfter === 0 ? 4 : 0.7), 0));
        break;
      }
      case 'blastingShell':
        consider({ card }, pShell * (3 + 2 * shellNeed) * Math.max(1, armorUrgency * 0.8) - (1 - pShell) * 2);
        break;
      case 'stompQuake': {
        const climbers = preds.filter((p) => p.h.node).length;
        consider({ card }, preds.reduce((acc, p, i) => acc + adjacentMass[i] * 2 * lethalWeight(p.h, 2), 0) + climbers * 1.5);
        break;
      }
      case 'roar':
        consider({ card }, preds.reduce((acc, p, i) => acc + adjacentMass[i] * p.expAttack * 0.6 + p.parryChance * 2, 0));
        break;
      case 'shellHarden': {
        const gained = Math.min(4, full - s.colossus.armor);
        consider({ card }, gained * 0.7 * armorUrgency + expIncoming * 0.5 * armorUrgency);
        break;
      }
    }
    if (best) {
      const b = best as CardOption;
      options.push({ play: b.play, value: b.value - keep });
    }
  }

  // ---- choose the best set of `need` cards, then a weighted random pick
  const combos: Scored<BossPlay[]>[] = [];
  const pick = (start: number, acc: CardOption[]) => {
    if (acc.length === need) {
      const plays = acc.map((o) => o.play);
      if (plays.filter((p) => bossDef(p.card).kind === 'charged').length > 1) return;
      if (cubesOnBoard(s) + cubesForPlays(s, plays).length > CUBE_BUDGET) return;
      combos.push({ item: plays, score: acc.reduce((a, o) => a + o.value, 0) });
      return;
    }
    for (let i = start; i < options.length; i++) pick(i + 1, [...acc, options[i]]);
  };
  pick(0, []);

  if (restCard && hand.filter((c) => !isRestCard(c)).length <= 4) {
    const restValue = Math.min(2, full - s.colossus.armor) * armorUrgency + 1 - 3.5;
    combos.push({ item: [restPlay()], score: restValue });
  }

  const finalists = topN(combos, ctx.difficulty === 'hard' ? 4 : 8);
  for (let attempt = 0; attempt < 4 && finalists.length; attempt++) {
    const plays = softmaxPick(finalists, temp, ctx.rng);
    if (!validateBossPlays(s, plays)) return { plays, faceUpIndex: faceUpChoice(plays) };
    finalists.splice(finalists.findIndex((f) => f.item === plays), 1);
  }
  return { plays: fallbackBossPlays(s), faceUpIndex: 0 };
}

/** Enraged: reveal the card that gives away the least (telegraphs are already public through their cubes). */
function faceUpChoice(plays: BossPlay[]): number {
  const rank = (p: BossPlay) => {
    const k = bossDef(p.card).kind;
    return k === 'telegraph' ? 0 : k === 'rest' ? 1 : k === 'charged' ? 2 : k === 'reaction' ? 3 : cardType(p.card) === 'feint' ? 4 : 5;
  };
  let best = 0;
  plays.forEach((p, i) => {
    if (rank(p) < rank(plays[best])) best = i;
  });
  return best;
}

/** Always-legal lock: first legal cards aimed at the first Hunter's hex. */
export function fallbackBossPlays(s: GameState): BossPlay[] {
  const need = requiredBossCount(s);
  const rest = s.colossus.hand.find(isRestCard)!;
  if (need === 0) return [{ card: rest }];
  const target = s.hunters.find((h) => h.pos && !h.down && !h.exhausted)?.pos;
  const ring = bodyRing(s.colossus.center, 1);
  const plays: BossPlay[] = [];
  for (const card of s.colossus.hand) {
    if (plays.length === need || isRestCard(card)) continue;
    const def = bossDef(card);
    if (def.kind === 'charged' && (s.tumble || plays.some((p) => bossDef(p.card).kind === 'charged'))) continue;
    if (def.kind === 'telegraph') continue;
    const play: BossPlay = { card };
    if (def.needs === 'dir') play.dir = 0;
    if (def.needs === 'adjacentHex') play.targets = [{ hex: ring[0] }];
    if (def.needs === 'hexOrNode') play.targets = [{ hex: target ?? ring[0] }];
    if (def.needs === 'twoTargets') play.targets = [{ hex: ring[0] }, { hex: ring[1] }];
    plays.push(play);
  }
  if (plays.length < need || validateBossPlays(s, plays)) return [{ card: rest }];
  return plays;
}
