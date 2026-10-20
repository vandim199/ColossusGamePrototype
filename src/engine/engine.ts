// The pure rules engine: applyAction(state, action) -> newState.
// Deterministic: every random draw comes from the seeded RNG stored in state.

import {
  CUBE_BUDGET,
  LEGS,
  NODE_LINKS,
  NODE_NAMES,
  NODE_POINTS,
  bodyHexes,
  bodyRing,
  bodySet,
  chargePath,
  chargeSweep,
  distToBody,
  isAdjacentToColossus,
  isFree,
  nearestFree,
  pullToward,
  pushAway,
  resolveMoveDest,
  tailSweepHexes,
} from './board';
import { BOSS_CARDS, CLASSES, bossDef, cardType, hunterDef, isRestCard, type HunterCardDef } from './cards';
import { verifyCommitment } from './commit';
import { DIE_FACES, UPGRADE, dieAverage, rollDie, type DieKind } from './dice';
import { DIR_NAMES, dist, hexLabel, inBoard, parse, type HexKey } from './hex';
import { nextRandom } from './rng';
import {
  activeHunters,
  bossCardsPerRound,
  cubesForPlays,
  cubesOnBoard,
  hunterBySeat,
  isActive,
  isSuperRestNow,
  validateBossPlays,
  validateHunterPlays,
  validateRest,
  validateRevive,
} from './rules';
import { HUNTER_MAX_HP_CAP, START_GRIP, fullArmor } from './setup';
import type { Action, BossPlay, GameState, HunterState, LogEvent, NodeId, Step } from './types';
import { canonicalJson } from './sha256';

export class RuleError extends Error {}

const HEX_RE = /^-?\d+,-?\d+$/;

/** Why an action is illegal right now, or null if it is legal. */
export function validateAction(s: GameState, a: Action): string | null {
  if (s.phase === 'gameOver') return 'The game is over';
  switch (a.type) {
    case 'LockBossCards': {
      if (s.phase !== 'bossLock') return 'Not the Colossus lock step';
      if (typeof a.commitment !== 'string' || !/^[0-9a-f]{64}$/.test(a.commitment)) return 'Bad commitment hash';
      const k = bossCardsPerRound(s);
      if (!Number.isInteger(a.cardCount) || a.cardCount < 1 || a.cardCount > k || a.cardCount > s.colossus.hand.length)
        return 'Bad card count';
      if (!Array.isArray(a.cubes) || a.cubes.some((h) => typeof h !== 'string' || !HEX_RE.test(h))) return 'Bad cubes';
      if (new Set(a.cubes).size !== a.cubes.length) return 'Duplicate cubes';
      const body = bodySet(s);
      if (a.cubes.some((h) => !inBoard(parse(h)) || body.has(h))) return 'Cubes must go on ground hexes';
      if (cubesOnBoard(s) + a.cubes.length > CUBE_BUDGET) return 'Not enough Red Cubes';
      if (s.colossus.enraged) {
        if (!a.faceUp || !s.colossus.hand.includes(a.faceUp.card)) return 'Enraged: one locked card must be face up';
      } else if (a.faceUp) return 'Only an Enraged Colossus locks a card face up';
      return null;
    }
    case 'CommitHunterCards':
      if (s.phase !== 'hunterCommit') return 'Not the Hunter commit step';
      return validateHunterPlays(s, a.seat, a.plays);
    case 'Rest':
      if (s.phase !== 'hunterCommit') return 'Not the Hunter commit step';
      return validateRest(s, a.seat, a.burn);
    case 'Revive':
      if (s.phase !== 'hunterCommit') return 'Not the Hunter commit step';
      return validateRevive(s, a.seat, a.target);
    case 'RevealBossCards': {
      if (s.phase !== 'bossReveal' || !s.lock) return 'Not the reveal step';
      if (typeof a.salt !== 'string' || !Array.isArray(a.plays)) return 'Malformed reveal';
      if (!verifyCommitment(s.lock.commitment, a.plays, a.salt)) return 'Reveal does not match the locked commitment';
      if (a.plays.length !== s.lock.cardCount) return 'Revealed card count differs from the lock';
      const err = validateBossPlays(s, a.plays, true);
      if (err) return `Illegal lock: ${err}`;
      const placed = new Set(s.lock.cubes);
      const implied = cubesForPlays(s, a.plays);
      if (implied.length !== placed.size || implied.some((h) => !placed.has(h))) return 'Placed cubes do not match the revealed cards';
      if (s.lock.faceUp && !a.plays.some((p) => canonicalJson(p) === canonicalJson(s.lock!.faceUp)))
        return 'The face-up card is not among the revealed cards';
      return null;
    }
    case 'ForfeitBossReveal':
      return s.phase === 'bossReveal' ? null : 'Not the reveal step';
    default:
      return 'Unknown action';
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  const err = validateAction(state, action);
  if (err) throw new RuleError(err);
  const s = structuredClone(state);
  switch (action.type) {
    case 'LockBossCards': {
      s.lock = {
        commitment: action.commitment,
        cardCount: action.cardCount,
        cubes: [...action.cubes],
        faceUp: action.faceUp,
      };
      if (action.cubes.length) s.cubes.push({ round: s.round, hexes: [...action.cubes] });
      s.phase = 'hunterCommit';
      const faceUp = action.faceUp ? ` Face up: ${bossDef(action.faceUp.card).name}.` : '';
      log(s, 'lock', 'boss', `The Colossus locks ${action.cardCount} card${action.cardCount === 1 ? '' : 's'}${action.cubes.length ? ` and places ${action.cubes.length} Red Cubes` : ''}.${faceUp}`, { hexes: action.cubes });
      break;
    }
    case 'CommitHunterCards':
      s.commits[action.seat - 1] = { kind: 'cards', plays: action.plays.map((p) => ({ ...p })) };
      advanceIfAllCommitted(s);
      break;
    case 'Rest':
      s.commits[action.seat - 1] = { kind: 'rest', burn: action.burn };
      advanceIfAllCommitted(s);
      break;
    case 'Revive':
      s.commits[action.seat - 1] = { kind: 'revive', target: action.target };
      advanceIfAllCommitted(s);
      break;
    case 'RevealBossCards':
      resolveRound(s, action.plays, action.salt, false);
      break;
    case 'ForfeitBossReveal':
      resolveRound(s, [], '', true);
      break;
  }
  return s;
}

function advanceIfAllCommitted(s: GameState) {
  if (activeHunters(s).every((h) => s.commits[h.seat - 1])) s.phase = 'bossReveal';
}

// ---------------------------------------------------------------- helpers

function log(s: GameState, step: Step, tone: LogEvent['tone'], text: string, extra: Partial<LogEvent> = {}) {
  s.log.push({ round: s.round, step, tone, text, ...extra });
}

function rand(s: GameState): number {
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  return v;
}

export const hunterName = (h: HunterState) => CLASSES[h.cls].short;

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w === 'hex' ? 'hexes' : `${w}s`}`;

function gainArmor(s: GameState, n: number): number {
  const before = s.colossus.armor;
  s.colossus.armor = Math.min(fullArmor(s), s.colossus.armor + n);
  return s.colossus.armor - before;
}

function loseArmor(s: GameState, n: number): number {
  const before = s.colossus.armor;
  s.colossus.armor = Math.max(0, s.colossus.armor - n);
  return before - s.colossus.armor;
}

function checkBossWin(s: GameState) {
  if (!s.winner && s.hunters.every((h) => h.down || h.exhausted)) {
    s.winner = 'colossus';
    log(s, 'end', 'big', 'Every Hunter is Down. The Colossus wins.');
  }
}

/** Deal one hit to a Hunter: Exposed adds 2, Shield absorbs first. */
function hit(s: GameState, h: HunterState, base: number, source: string, step: Step): number {
  if (h.down || h.exhausted) return 0;
  let dmg = base + (h.exposed ? 2 : 0);
  const absorbed = Math.min(h.shield, dmg);
  h.shield -= absorbed;
  dmg -= absorbed;
  if (dmg > 0) {
    h.hp = Math.max(0, h.hp - dmg);
    h.damagedThisRound = true;
    h.momentum = 0;
    s.stats.damageToHunters += dmg;
  }
  const notes = [h.exposed ? 'Exposed +2' : '', absorbed ? `${absorbed} absorbed by Shield` : ''].filter(Boolean);
  log(s, step, 'damage', `${hunterName(h)} takes ${dmg} from ${source}${notes.length ? ` (${notes.join(', ')})` : ''}. HP ${h.hp}.`, {
    seat: h.seat,
    hexes: h.pos ? [h.pos] : undefined,
  });
  if (h.hp === 0) knockDown(s, h, step);
  return dmg;
}

function knockDown(s: GameState, h: HunterState, step: Step) {
  h.down = true;
  h.momentum = 0;
  s.stats.downs++;
  if (h.node) {
    endClimb(s, h);
    h.node = null;
    h.pos = landingHex(s, h);
  }
  log(s, step, 'big', `${hunterName(h)} is Down!${h.revived ? '' : ' An adjacent ally can spend a full turn to revive them.'}`, { seat: h.seat });
  checkBossWin(s);
}

function endClimb(s: GameState, h: HunterState) {
  if (h.mountedRound !== null) s.stats.climbLengths.push(s.round - h.mountedRound);
  h.mountedRound = null;
}

/** A random free hex adjacent to the Colossus (falls, knock-offs). */
function landingHex(s: GameState, h: HunterState): HexKey | null {
  const options = bodyRing(s.colossus.center, 1).filter((x) => isFree(s, x, h.seat));
  if (options.length) return options[Math.floor(rand(s) * options.length)];
  return nearestFree(s, s.colossus.center, bodySet(s), h.seat);
}

function fall(s: GameState, h: HunterState, step: Step) {
  if (!h.node) return;
  endClimb(s, h);
  const from = h.node;
  h.node = null;
  h.grip = 0;
  h.pos = landingHex(s, h);
  s.stats.falls++;
  log(s, step, 'big', `${hunterName(h)} loses their Grip and falls from the ${NODE_NAMES[from]}!`, { seat: h.seat, hexes: h.pos ? [h.pos] : [] });
  hit(s, h, 3, 'the fall', step);
}

function loseGrip(s: GameState, h: HunterState, n: number, step: Step) {
  if (!h.node || h.down) return;
  h.grip = Math.max(0, h.grip - n);
  log(s, step, 'damage', `${hunterName(h)} loses ${n} Grip (Grip ${h.grip}).`, { seat: h.seat });
  if (h.grip <= 0) fall(s, h, step);
}

function cancelCharged(s: GameState, step: Step) {
  const n = s.pendingCharged.length + s.chargedThisRound.length;
  if (n) log(s, step, 'parry', `The declared Charged Attack is cancelled.`);
  s.pendingCharged = [];
  s.chargedThisRound = [];
}

function startShortTumble(s: GameState, seat: number, step: Step) {
  if (s.tumble) return;
  s.tumble = { kind: 'short', endsRound: s.round + 1, climbsLeft: 1, parrier: seat };
  s.spentNodes = [];
  s.stats.shortTumbles++;
  log(s, step, 'big', `The Colossus takes a SHORT TUMBLE! It stands at the end of next round. One climber may mount.`);
  cancelCharged(s, step);
}

function startLongTumble(s: GameState, step: Step) {
  s.tumble = { kind: 'long', endsRound: s.round + 2, climbsLeft: 99, parrier: null };
  s.spentNodes = [];
  s.stats.shatters++;
  log(s, step, 'big', `ARMOR SHATTERED! The Colossus takes a LONG TUMBLE until the end of the round after next. Every adjacent Hunter may climb.`);
  cancelCharged(s, step);
}

const commitOf = (s: GameState, h: HunterState) => s.commits[h.seat - 1];

function playsOf(s: GameState, h: HunterState) {
  const c = commitOf(s, h);
  return c?.kind === 'cards' ? c.plays : [];
}

const isAttackPlay = (def: HunterCardDef, h: HunterState) => !!def.attack || (!!def.climb && !!h.node);

// ---------------------------------------------------------------- resolution

function resolveRound(s: GameState, revealed: BossPlay[], salt: string, forfeited: boolean) {
  const lock = s.lock!;
  s.lastReveal = { round: s.round, commitment: lock.commitment, plays: revealed, salt, forfeited };
  let plays = revealed;
  if (forfeited) {
    s.cubes = s.cubes.filter((w) => w.round !== s.round);
    log(s, 'reveal', 'boss', 'The Colossus failed to open its commitment: its locked cards are void this round and its new cubes are removed.');
    plays = [];
  } else {
    log(s, 'reveal', 'boss', `REVEAL: ${plays.map(describeBossPlay).join(' + ')}. Commitment verified.`);
  }

  // Cards leave the hands.
  const bossSuper = isSuperRestNow(s.colossus.hand);
  for (const p of plays) {
    if (isRestCard(p.card)) continue;
    s.colossus.hand.splice(s.colossus.hand.indexOf(p.card), 1);
    s.colossus.discard.push(p.card);
  }
  for (const h of s.hunters) {
    for (const p of playsOf(s, h)) {
      const i = h.hand.indexOf(p.card);
      if (i >= 0) h.hand.splice(i, 1);
      h.discard.push(p.card);
    }
  }
  s.chargedThisRound = plays.filter((p) => bossDef(p.card).kind === 'charged');

  // Colossus Rest resolves on reveal.
  const rest = plays.find((p) => isRestCard(p.card));
  if (rest) {
    s.colossus.hand.push(...s.colossus.discard);
    s.colossus.discard = [];
    const gained = gainArmor(s, bossSuper ? 4 : 2);
    s.stats.bossRests++;
    log(s, 'reveal', 'boss', `The Colossus ${bossSuper ? 'SUPER RESTS' : 'Rests'}: reclaims its cards and restores ${gained} Armor${rest.hex ? ' (plus one free Red Cube)' : ''}.`);
  }

  if (!s.tumble) s.stats.standingRounds++;
  step31Movement(s);
  if (!s.winner) step32Cubes(s);
  const ctx = { halve: false };
  if (!s.winner) step33Quick(s, plays, ctx);
  if (!s.winner) step34Hunters(s, plays, ctx);
  if (!s.winner) step35Charged(s);
  if (!s.winner) cleanup(s);
  if (s.winner) {
    s.phase = 'gameOver';
    s.lock = null;
  }
}

export function describeBossPlay(p: BossPlay): string {
  const def = bossDef(p.card);
  const bits: string[] = [];
  if (p.dir !== undefined) bits.push(DIR_NAMES[p.dir]);
  for (const t of p.targets ?? []) bits.push(t.node ? NODE_NAMES[t.node] : hexLabel(t.hex!));
  return bits.length ? `${def.name} (${bits.join(', ')})` : def.name;
}

// 3.1 Hunter movement, in seating order.
function step31Movement(s: GameState) {
  for (const h of s.hunters) {
    if (!isActive(h)) continue;
    for (const p of playsOf(s, h)) {
      const def = hunterDef(p.card);
      if (h.down) break;
      if (def.move) moveHunter(s, h, p.card, p.dest, p.node, p.jump);
      if (def.ability === 'beam') rescueBeam(s, h, p.target);
    }
  }
}

function moveHunter(s: GameState, h: HunterState, card: string, dest?: HexKey, node?: NodeId, jump?: HexKey) {
  const name = hunterDef(card).name;
  if (h.node) {
    if (jump !== undefined) {
      endClimb(s, h);
      h.node = null;
      h.pos = isFree(s, jump, h.seat) && isAdjacentToColossus(s, jump) ? jump : nearestFree(s, jump, bodySet(s), h.seat);
      log(s, '3.1', 'hunter', `${hunterName(h)} jumps down safely.`, { seat: h.seat, hexes: h.pos ? [h.pos] : [] });
    } else if (node && NODE_LINKS[h.node].includes(node)) {
      h.node = node;
      h.grip -= 1;
      log(s, '3.1', 'hunter', `${hunterName(h)} climbs to the ${NODE_NAMES[node]} (Grip ${h.grip}).`, { seat: h.seat });
      if (h.grip <= 0) fall(s, h, '3.1');
    }
    return;
  }
  if (!h.pos) return;
  const to = resolveMoveDest(s, h.seat, card, h.pos, dest);
  if (to !== h.pos) {
    const blocked = dest && to !== dest ? ' (their chosen hex was taken)' : '';
    log(s, '3.1', 'hunter', `${hunterName(h)} uses ${name}${blocked}.`, { seat: h.seat, hexes: [h.pos, to] });
    h.pos = to;
  }
}

function rescueBeam(s: GameState, h: HunterState, target?: number) {
  const t = target === undefined ? undefined : hunterBySeat(s, target);
  if (!h.pos || !t || t.exhausted || !t.pos) {
    log(s, '3.1', 'info', `${hunterName(h)}'s Rescue Beam finds no target on the ground.`, { seat: h.seat });
    return;
  }
  if (dist(h.pos, t.pos) > 5) {
    log(s, '3.1', 'info', `${hunterName(h)}'s Rescue Beam is out of range (5 hexes).`, { seat: h.seat });
    return;
  }
  const roll = rollDie('pull', () => rand(s));
  const from = t.pos;
  const moved = pullToward(s, t, h.pos, roll);
  log(s, '3.1', 'heal', `${hunterName(h)} fires Rescue Beam: Pull d6 rolls ${roll}, ${hunterName(t)} is pulled ${plural(moved, 'hex')}.`, {
    seat: h.seat,
    hexes: [from, t.pos],
  });
}

// 3.2 Last round's Red Cubes detonate.
function step32Cubes(s: GameState) {
  const waves = s.cubes.filter((w) => w.round < s.round);
  if (!waves.length) return;
  const hexes = new Set(waves.flatMap((w) => w.hexes));
  s.cubes = s.cubes.filter((w) => w.round >= s.round);
  log(s, '3.2', 'boss', `${plural(hexes.size, 'Red Cube')} detonate${hexes.size === 1 ? 's' : ''}!`, { hexes: [...hexes] });
  for (const h of s.hunters) {
    if (h.pos && hexes.has(h.pos) && isActive(h)) hit(s, h, 5, 'Red Cubes', '3.2');
    if (s.winner) return;
  }
}

// 3.3 Boss Quick Attacks; Parries are checked here.
function step33Quick(s: GameState, plays: BossPlay[], ctx: { halve: boolean }) {
  const quick = plays.filter((p) => bossDef(p.card).kind === 'quick');
  const parriers = new Set(
    s.hunters.filter((h) => isActive(h) && h.pos && playsOf(s, h).some((p) => hunterDef(p.card).parry)).map((h) => h.seat),
  );
  const anchors = new Set(
    s.hunters.filter((h) => isActive(h) && h.pos && playsOf(s, h).some((p) => hunterDef(p.card).ability === 'anchor')).map((h) => h.seat),
  );
  const cancelled = quick.some((p) => cardType(p.card) === 'roar');
  const targetedParriers = new Set<number>();

  if (cancelled) {
    log(s, '3.3', 'boss', 'ROAR! Every Hunter is pushed 2 hexes away and all Parries are cancelled.');
    for (const h of s.hunters) if (isActive(h) && h.pos) pushAway(s, h, 2);
  }

  for (const p of quick) {
    if (s.winner) return;
    switch (cardType(p.card)) {
      case 'roar':
        break;
      case 'shellHarden': {
        const g = gainArmor(s, 4);
        ctx.halve = true;
        log(s, '3.3', 'boss', `Shell Harden: the Colossus gains ${g} Armor and Hunter attacks deal half damage this round.`);
        break;
      }
      case 'stompQuake': {
        const ring = new Set(bodyRing(s.colossus.center, 1));
        log(s, '3.3', 'boss', 'Stomp Quake shakes every adjacent hex!', { hexes: [...ring] });
        for (const h of s.hunters) {
          if (h.pos && ring.has(h.pos) && isActive(h)) hit(s, h, 2, 'Stomp Quake', '3.3');
          else if (h.node && isActive(h)) loseGrip(s, h, 2, '3.3');
        }
        break;
      }
      case 'feint':
        if (cancelled) break;
        log(s, '3.3', 'boss', `Feint! ${parriers.size ? 'Every Hunter who Parried is Exposed.' : 'Nobody Parried.'}`);
        for (const seat of parriers) {
          hunterBySeat(s, seat)!.exposedNext = true;
          s.stats.feintCatches++;
        }
        break;
      default:
        for (const t of p.targets ?? []) {
          quickAttack(s, p, t, parriers, anchors, cancelled, targetedParriers);
          if (s.winner) return;
        }
    }
  }

  if (!cancelled) {
    for (const seat of parriers) {
      if (targetedParriers.has(seat)) continue;
      const h = hunterBySeat(s, seat)!;
      h.exposedNext = true;
      s.stats.whiffs++;
      log(s, '3.3', 'info', `${hunterName(h)}'s Parry whiffs: Exposed next round (+2 to every hit).`, { seat });
    }
  }
}

function quickAttack(
  s: GameState,
  p: BossPlay,
  t: { hex?: HexKey; node?: NodeId },
  parriers: Set<number>,
  anchors: Set<number>,
  cancelled: boolean,
  targetedParriers: Set<number>,
) {
  const name = BOSS_CARDS[cardType(p.card)].name;
  if (t.node) {
    const victims = s.hunters.filter((h) => h.node === t.node && isActive(h));
    log(s, '3.3', 'boss', `${name} lashes the ${NODE_NAMES[t.node]}${victims.length ? '!' : ', but nobody is there.'}`);
    for (const v of victims) {
      hit(s, v, 3, name, '3.3');
      loseGrip(s, v, 3, '3.3');
      if (s.winner) return;
    }
    return;
  }
  if (!t.hex) return;
  const v = s.hunters.find((h) => h.pos === t.hex && isActive(h));
  if (!v) {
    log(s, '3.3', 'boss', `${name} smashes empty ground.`, { hexes: [t.hex] });
    return;
  }
  if (parriers.has(v.seat) && !cancelled) {
    targetedParriers.add(v.seat);
    s.stats.parries++;
    log(s, '3.3', 'parry', `PARRY! ${hunterName(v)} deflects the ${name}!`, { seat: v.seat, hexes: [t.hex] });
    startShortTumble(s, v.seat, '3.3');
    return;
  }
  if (anchors.has(v.seat)) {
    log(s, '3.3', 'parry', `${hunterName(v)} holds Anchor Stance and blocks the ${name}! Adjacent allies gain 3 Shield.`, { seat: v.seat, hexes: [t.hex] });
    for (const a of s.hunters) if (a !== v && isActive(a) && a.pos && dist(a.pos, v.pos!) === 1) a.shield += 3;
    return;
  }
  log(s, '3.3', 'boss', `${name} hits ${hunterName(v)}!`, { seat: v.seat, hexes: [t.hex] });
  hit(s, v, 3, name, '3.3');
  if (cardType(p.card) === 'quickSwipe' && isActive(v) && v.pos) {
    const n = pushAway(s, v, 2);
    if (n) log(s, '3.3', 'info', `${hunterName(v)} is knocked back ${plural(n, 'hex')}.`, { seat: v.seat, hexes: [v.pos] });
  }
}

// 3.4 Hunter attacks and abilities, in seating order.
function step34Hunters(s: GameState, plays: BossPlay[], ctx: { halve: boolean }) {
  if (plays.some((p) => cardType(p.card) === 'blastingShell')) {
    const active = activeHunters(s);
    const attackers = active.filter((h) => playsOf(s, h).some((p) => isAttackPlay(hunterDef(p.card), h)));
    const need = Math.max(1, active.length - 1);
    if (attackers.length >= need) {
      const g = gainArmor(s, 3);
      log(s, '3.4', 'boss', `BLASTING SHELL! ${plural(attackers.length, 'attacker')} take 2 reflected damage; the Colossus gains ${g} Armor.`);
      for (const a of attackers) {
        hit(s, a, 2, 'Blasting Shell', '3.4');
        if (s.winner) return;
      }
    } else {
      const l = loseArmor(s, 2);
      log(s, '3.4', 'hunter', `Blasting Shell misfires (only ${attackers.length} attacked): the Colossus loses ${l} Armor.`);
    }
  }

  const grants = climbGrants(s);
  for (const h of s.hunters) {
    if (!isActive(h)) continue;
    const c = commitOf(s, h);
    if (!c) continue;
    if (c.kind === 'rest') hunterRest(s, h, c.burn);
    else if (c.kind === 'revive') revive(s, h, c.target);
    else if (c.kind === 'cards') {
      for (const p of c.plays) {
        if (!isActive(h)) break;
        const def = hunterDef(p.card);
        if (def.climb && !h.node) {
          if (grants.has(h.seat)) mount(s, h, p.node);
          else log(s, '3.4', 'info', `${hunterName(h)} cannot climb now (Climb & Strike needs a Tumble, adjacency${s.tumble?.kind === 'short' ? ', and the Short Tumble window' : ''}).`, { seat: h.seat });
        } else if (isAttackPlay(def, h)) {
          attack(s, h, def, ctx);
        } else if (def.ability === 'hymn') {
          hymn(s, h);
        }
        if (s.winner) return;
      }
    }
    if (s.winner) return;
  }
}

/** Who may mount this round. Long Tumble: every adjacent climber. Short: one, the parrier first, else an ally adjacent to them. */
function climbGrants(s: GameState): Set<number> {
  const out = new Set<number>();
  const t = s.tumble;
  if (!t || t.climbsLeft <= 0) return out;
  const candidates = s.hunters.filter(
    (h) => isActive(h) && h.pos && isAdjacentToColossus(s, h.pos) && playsOf(s, h).some((p) => hunterDef(p.card).climb),
  );
  if (t.kind === 'long') {
    for (const h of candidates) out.add(h.seat);
    return out;
  }
  const parrier = t.parrier ? hunterBySeat(s, t.parrier) : undefined;
  const eligible = candidates
    .filter((h) => h === parrier || (parrier?.pos && h.pos && dist(h.pos, parrier.pos) === 1))
    .sort((a, b) => (a === parrier ? -1 : b === parrier ? 1 : a.seat - b.seat));
  for (const h of eligible.slice(0, t.climbsLeft)) out.add(h.seat);
  return out;
}

function mount(s: GameState, h: HunterState, node?: NodeId) {
  h.node = node && LEGS.includes(node) ? node : 'L1';
  h.pos = null;
  h.grip = START_GRIP;
  h.mountedRound = s.round;
  if (s.tumble) s.tumble.climbsLeft--;
  log(s, '3.4', 'big', `${hunterName(h)} CLIMBS onto the ${NODE_NAMES[h.node]}! (Grip ${START_GRIP})`, { seat: h.seat });
}

function attackDice(h: HunterState, roll: 'pool' | 'vector'): DieKind[] {
  const base = roll === 'vector' ? [...h.dice].sort((a, b) => dieAverage(b) - dieAverage(a)).slice(0, 4) : [...h.dice];
  if (h.cls === 'slasher') for (let i = 0; i < h.momentum; i++) base.push('slasher');
  return base;
}

function attack(s: GameState, h: HunterState, def: HunterCardDef, ctx: { halve: boolean }) {
  if (h.node) {
    h.attackedThisRound = true;
    const pts = NODE_POINTS[h.node];
    if (pts === 0) {
      log(s, '3.4', 'info', `${hunterName(h)} strikes the ${NODE_NAMES[h.node]}, but there is no vital point there.`, { seat: h.seat });
    } else if (s.spentNodes.includes(h.node)) {
      log(s, '3.4', 'info', `${hunterName(h)} strikes the ${NODE_NAMES[h.node]}, but it is already spent.`, { seat: h.seat });
    } else {
      scorePoints(s, h, h.node, pts);
    }
    return;
  }
  if (!h.pos) return;
  const range = def.attack?.range ?? 1;
  const d = distToBody(s.colossus.center, h.pos);
  if (d > range) {
    log(s, '3.4', 'info', `${hunterName(h)}'s ${def.name} is out of range (needs ${range}, is ${d} away).`, { seat: h.seat });
    return;
  }
  h.attackedThisRound = true;
  let faces: number[];
  let total: number;
  let detail: string;
  if (def.attack?.roll === 'sledge') {
    const f = rollDie('heavy', () => rand(s));
    faces = [f];
    total = 3 + f;
    detail = `3 + Heavy d8 [${f}]`;
  } else {
    const dice = attackDice(h, def.attack?.roll === 'vector' ? 'vector' : 'pool');
    faces = dice.map((k) => rollDie(k, () => rand(s)));
    total = faces.reduce((a, b) => a + b, 0);
    detail = `[${faces.join(' ')}]`;
  }
  const dmg = ctx.halve ? Math.floor(total / 2) : total;
  const dealt = loseArmor(s, dmg);
  s.stats.armorDamage += dealt;
  log(s, '3.4', 'hunter', `${hunterName(h)}'s ${def.name} rolls ${detail} = ${total}${ctx.halve ? `, halved to ${dmg}` : ''}. Armor ${s.colossus.armor}.`, { seat: h.seat });
  if (def.attack?.bleed && faces.filter((f) => f === 2).length >= 2) {
    s.colossus.bleed = 2;
    log(s, '3.4', 'hunter', `Two 2s: the Colossus BLEEDS (1 Armor at each cleanup for 2 rounds).`, { seat: h.seat });
  }
}

function scorePoints(s: GameState, h: HunterState, node: NodeId, pts: number) {
  s.points += pts;
  s.spentNodes.push(node);
  for (let i = 0; i < pts; i++) s.stats.pointRounds.push(s.round);
  log(s, '3.4', 'strike', `VITAL STRIKE! ${hunterName(h)} strikes the ${NODE_NAMES[node]} for ${plural(pts, 'point')} (${s.points}/${s.target}).`, { seat: h.seat });
  if (s.points >= s.target) {
    s.winner = 'hunters';
    log(s, 'end', 'big', 'The Colossus falls. The Hunters win!');
    return;
  }
  let added = 0;
  for (let i = 0; i < pts && s.ragePile.length; i++) {
    s.colossus.hand.push(s.ragePile.shift()!);
    added++;
  }
  log(s, '3.4', 'boss', `Escalation: full Armor rises to ${fullArmor(s)}${added ? ` and ${plural(added, 'Rage card')} join${added === 1 ? 's' : ''} the Colossus's hand` : ''}.`);
}

function hymn(s: GameState, h: HunterState) {
  if (!h.pos) return;
  const healed: string[] = [];
  for (const a of s.hunters) {
    if (!isActive(a) || !a.pos || dist(a.pos, h.pos) > 3) continue;
    const before = a.hp;
    a.hp = Math.min(a.maxHp, a.hp + 2);
    if (a.hp > before) healed.push(`${hunterName(a)} +${a.hp - before}`);
  }
  log(s, '3.4', 'heal', `${hunterName(h)} sings Harmonic Hymn${healed.length ? `: ${healed.join(', ')}` : ', but nobody nearby is hurt'}.`, { seat: h.seat });
}

function revive(s: GameState, h: HunterState, target: number) {
  const t = hunterBySeat(s, target);
  if (!t || !h.pos || !t.pos || !t.down || t.revived || t.exhausted || dist(h.pos, t.pos) !== 1) {
    log(s, '3.4', 'info', `${hunterName(h)}'s revive fails (no longer adjacent to a revivable ally).`, { seat: h.seat });
    return;
  }
  t.down = false;
  t.revived = true;
  t.hp = 4;
  s.stats.revives++;
  log(s, '3.4', 'heal', `${hunterName(h)} revives ${hunterName(t)} at 4 HP!`, { seat: h.seat, hexes: [t.pos] });
}

function upgradeDie(h: HunterState): DieKind | null {
  let best = -1;
  for (let i = 0; i < h.dice.length; i++) {
    if (!UPGRADE[h.dice[i]]) continue;
    if (best < 0 || dieAverage(h.dice[i]) < dieAverage(h.dice[best])) best = i;
  }
  if (best < 0) return null;
  h.dice[best] = UPGRADE[h.dice[best]]!;
  return h.dice[best];
}

function hunterRest(s: GameState, h: HunterState, burn: string) {
  const superRest = isSuperRestNow(h.hand);
  h.hand.push(...h.discard);
  h.discard = [];
  const i = h.hand.indexOf(burn);
  const j = i >= 0 && !isRestCard(burn) ? i : h.hand.findIndex((c) => !isRestCard(c));
  const burned = h.hand.splice(j, 1)[0];
  h.burned.push(burned);
  s.stats.hunterRests++;
  let extra = '';
  if (superRest) {
    s.stats.superRests++;
    const up = h.upgrades < 2 ? upgradeDie(h) : null;
    if (up) {
      h.upgrades++;
      extra = `, upgrades a die to ${up === 'standard' ? 'Standard' : 'Upgraded'} d4`;
    } else if (h.maxHp < HUNTER_MAX_HP_CAP) {
      h.maxHp++;
      extra = `, max HP rises to ${h.maxHp}`;
    }
  }
  const before = h.hp;
  h.hp = Math.min(h.maxHp, h.hp + (superRest ? 4 : 2));
  log(s, '3.4', 'heal', `${hunterName(h)} ${superRest ? 'SUPER RESTS' : 'Rests'}: reclaims, burns ${hunterDef(burned).name}, +${h.hp - before} HP${extra}. Deck ${h.hand.length}.`, { seat: h.seat });
  if (h.hand.length < 4) {
    h.exhausted = true;
    h.pos = null;
    h.node = null;
    s.stats.exhaustions++;
    log(s, '3.4', 'big', `${hunterName(h)} is EXHAUSTED: fewer than 4 cards remain. They are out of the fight.`, { seat: h.seat });
    checkBossWin(s);
  }
}

// 3.5 Boss Charged Attacks (declared last round) and movement.
function step35Charged(s: GameState) {
  const charged = s.pendingCharged;
  s.pendingCharged = [];
  for (const p of charged) {
    if (s.winner) return;
    if (cardType(p.card) === 'chargeForward' && p.dir !== undefined) {
      const from = s.colossus.center;
      s.colossus.facing = p.dir;
      const path = chargePath(from, p.dir);
      if (!path.length) {
        log(s, '3.5', 'boss', `Charge Forward ${DIR_NAMES[p.dir]}: the Colossus is already at the edge.`);
        continue;
      }
      const swept = new Set(chargeSweep(from, p.dir));
      s.colossus.center = path[path.length - 1];
      const finalBody = new Set(bodyHexes(s.colossus.center));
      log(s, '3.5', 'boss', `CHARGE FORWARD! The Colossus surges ${DIR_NAMES[p.dir]} to the edge.`, { hexes: [...swept] });
      const victims = s.hunters.filter((h) => !h.exhausted && h.pos && swept.has(h.pos));
      for (const v of victims) {
        if (v.pos && finalBody.has(v.pos)) v.pos = nearestFree(s, v.pos, new Set(), v.seat);
      }
      for (const v of victims) {
        if (isActive(v)) hit(s, v, 4, 'Charge Forward', '3.5');
        if (s.winner) return;
      }
    } else if (cardType(p.card) === 'tailSweep') {
      const hexes = new Set(tailSweepHexes(s.colossus.center, s.colossus.facing));
      log(s, '3.5', 'boss', 'TAIL SWEEP across the back half of the ring!', { hexes: [...hexes] });
      for (const h of s.hunters) {
        if (h.pos && hexes.has(h.pos) && isActive(h)) hit(s, h, 4, 'Tail Sweep', '3.5');
        if (s.winner) return;
      }
    }
  }
}

// 4. Cleanup.
function cleanup(s: GameState) {
  const c = s.colossus;
  const wasStanding = !s.tumble;
  if (c.bleed > 0) {
    const l = loseArmor(s, 1);
    c.bleed--;
    log(s, 'cleanup', 'hunter', `Bleed: the Colossus loses ${l} Armor (Armor ${c.armor}).`);
  }
  if (c.armor <= 0 && s.tumble?.kind !== 'long') startLongTumble(s, 'cleanup');

  if (wasStanding) {
    for (const h of s.hunters) {
      if (h.node && isActive(h)) {
        loseGrip(s, h, 1, 'cleanup');
        if (s.winner) return;
      }
    }
  }

  if (s.tumble && s.tumble.endsRound <= s.round) {
    if (s.tumble.kind === 'long') c.armor = fullArmor(s);
    log(s, 'cleanup', 'boss', `The Colossus stands up${s.tumble.kind === 'long' ? ` with full Armor ${c.armor}` : ''}.`);
    s.tumble = null;
  }

  for (const h of s.hunters) {
    h.exposed = h.exposedNext;
    h.exposedNext = false;
    h.shield = 0;
    if (h.cls === 'slasher') {
      h.momentum = h.attackedThisRound && !h.damagedThisRound ? Math.min(3, h.momentum + 1) : 0;
    }
    h.attackedThisRound = false;
    h.damagedThisRound = false;
  }

  s.pendingCharged = s.tumble ? [] : s.chargedThisRound;
  s.chargedThisRound = [];
  for (const p of s.pendingCharged) {
    const hexes =
      cardType(p.card) === 'chargeForward' && p.dir !== undefined
        ? chargeSweep(c.center, p.dir)
        : tailSweepHexes(c.center, c.facing);
    log(s, 'cleanup', 'boss', `The Colossus declares ${describeBossPlay(p)} for next round (arrow token).`, { hexes });
  }

  const wasEnraged = c.enraged;
  c.enraged = s.points >= s.target - 1;
  if (c.enraged && !wasEnraged)
    log(s, 'cleanup', 'big', 'The Colossus is ENRAGED: it now locks 3 cards per round, one of them face up.');

  checkBossWin(s);
  if (s.winner) return;
  if (s.round >= s.config.maxRounds) {
    s.winner = 'draw';
    log(s, 'end', 'big', `Round limit (${s.config.maxRounds}) reached: the game is a draw.`);
    return;
  }
  s.round++;
  s.phase = 'bossLock';
  s.lock = null;
  s.commits = s.hunters.map(() => null);
}

/** Expected damage of a die pool, for bots and UI hints. */
export const poolAverage = (dice: DieKind[]) => dice.reduce((a, d) => a + dieAverage(d), 0);
export const heavyAverage = DIE_FACES.heavy.reduce((a, b) => a + b, 0) / DIE_FACES.heavy.length;
export { attackDice };
