import { describe, expect, it } from 'vitest';
import {
  BURST_TARGET,
  DIE_FACES,
  RuleError,
  SHAKE_DAMAGE,
  angleBetween,
  angleDiff,
  applyAction,
  bodyHexes,
  coneHexes,
  createGame,
  dieAverage,
  fullArmor,
  groundHexes,
  inBoard,
  lineHexes,
  makeBossCommitment,
  makeCommitment,
  neighbors,
  parse,
  projectView,
  rollDie,
  sha256Hex,
  validateBossPlays,
  validateHunterPlays,
  Rng,
  type BossPlay,
  type GameState,
} from './index';
import { emptyHex, fromCenter, hexAt, playRound } from './testkit';

const newGame = (seed = 1) => createGame({ mode: '1v4', seed });

/** Move a card from the Colossus discard (or nowhere, for Rage cards) into its hand. */
function giveBoss(s: GameState, card: string) {
  s.colossus.discard = s.colossus.discard.filter((c) => c !== card);
  if (!s.colossus.hand.includes(card)) s.colossus.hand.push(card);
}

const far = (s: GameState) => emptyHex(s, [hexAt(9, 0), hexAt(0, 0)]);
const S = 3 as const;

function climbOn(s: GameState, i: number, hex: string, mountedRound = s.round) {
  const h = s.hunters[i];
  h.pos = hex;
  h.climbing = true;
  h.mountedRound = mountedRound;
}

// ------------------------------------------------------------------ dice

describe('dice', () => {
  it('match the printed faces and averages', () => {
    expect(dieAverage('slasher')).toBe(0.5);
    expect(dieAverage('standard')).toBe(1);
    expect(dieAverage('upgraded')).toBe(1.5);
    expect(dieAverage('heavy')).toBe(2.25);
    expect(dieAverage('pull')).toBeCloseTo(2.667, 2);
    expect(6 * dieAverage('slasher')).toBe(3);
    expect(4 * dieAverage('standard')).toBe(4);
    expect(2 * dieAverage('upgraded') + dieAverage('heavy')).toBe(5.25);
  });

  it('give the probabilities quoted in the changelog', () => {
    const p2 = DIE_FACES.standard.filter((f) => f === 2).length / 4;
    expect(1 - (1 - p2) ** 4 - 4 * p2 * (1 - p2) ** 3).toBeCloseTo(0.2617, 3);
    expect(DIE_FACES.pull.filter((f) => f >= 3).length / 6).toBe(0.5);
  });

  it('roll deterministically from a seed and converge on the average', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect(Array.from({ length: 50 }, () => rollDie('heavy', () => a.next()))).toEqual(Array.from({ length: 50 }, () => rollDie('heavy', () => b.next())));
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += rollDie('heavy', () => r.next());
    expect(sum / 100000).toBeCloseTo(2.25, 1);
  });
});

// ------------------------------------------------------------------ commit-reveal

describe('commit-reveal', () => {
  it('sha256 matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts the matching reveal and rejects tampering', () => {
    let s = newGame();
    const plays: BossPlay[] = [{ card: 'feint.1' }, { card: 'bodyThrash.1', targets: [far(s)] }];
    const { lock, reveal } = makeBossCommitment(s, plays, 'salt-1');
    expect(lock.commitment).toBe(makeCommitment(plays, 'salt-1'));
    s = applyAction(s, lock);
    for (const h of s.hunters) s = applyAction(s, { type: 'CommitHunterCards', seat: h.seat, plays: [] });
    expect(s.phase).toBe('bossReveal');
    expect(() => applyAction(s, { ...reveal, plays: [{ card: 'quickSwipe.1', targets: [fromCenter(s, S, 2)] }, plays[1]] })).toThrow(RuleError);
    expect(() => applyAction(s, { ...reveal, salt: 'salt-2' })).toThrow(/does not match/);
    const after = applyAction(s, reveal);
    expect(after.round).toBe(2);
    expect(after.lastReveal?.plays).toEqual(plays);
  });

  it('rejects a reveal whose cubes differ from the ones placed at lock', () => {
    let s = newGame();
    const plays: BossPlay[] = [{ card: 'lineBurst.1', aim: hexAt(4, 0) }];
    const { lock, reveal } = makeBossCommitment(s, plays, 'x');
    s = applyAction(s, { ...lock, cubes: lock.cubes.slice(1) });
    for (const h of s.hunters) s = applyAction(s, { type: 'CommitHunterCards', seat: h.seat, plays: [] });
    expect(() => applyAction(s, reveal)).toThrow(/cubes/);
  });
});

// ------------------------------------------------------------------ choices

describe('choosing cards', () => {
  it('Hunters may commit 0, 1 or 2 cards, in any combination', () => {
    const s = applyAction(newGame(), makeBossCommitment(newGame(), [{ card: 'feint.1' }], 's').lock);
    expect(validateHunterPlays(s, 1, [])).toBeNull();
    expect(validateHunterPlays(s, 1, [{ card: 'parry.1' }])).toBeNull();
    expect(validateHunterPlays(s, 1, [{ card: 'parry.1' }, { card: 'slash.1' }])).toBeNull();
    expect(validateHunterPlays(s, 1, [{ card: 'rest.1' }, { card: 'slash.1' }])).toBeNull();
    expect(validateHunterPlays(s, 1, [{ card: 'rest.1' }, { card: 'slash.1' }, { card: 'dash.1' }])).toMatch(/at most 2/);
  });

  it('the Colossus may lock any 1 or 2 cards together, even two Charged attacks or a move with an attack', () => {
    const s = newGame();
    expect(validateBossPlays(s, [{ card: 'chargeForward.1', aim: hexAt(0, 9) }, { card: 'tailSweep.1' }])).toBeNull();
    expect(validateBossPlays(s, [{ card: 'stride.1', aim: hexAt(9, 9) }, { card: 'triCone.1', aim: hexAt(4, 9) }])).toBeNull();
    expect(validateBossPlays(s, [{ card: 'rest.1' }, { card: 'feint.1' }])).toBeNull();
    expect(validateBossPlays(s, [{ card: 'ringSlam.1' }])).toBeNull();
    expect(validateBossPlays(s, [{ card: 'feint.1' }, { card: 'ringSlam.1' }, { card: 'tailSweep.1' }])).toMatch(/at most 2/);
    expect(validateBossPlays({ ...s, tumble: { kind: 'long', endsRound: 3, climbsLeft: 9, parrier: null } }, [{ card: 'stride.1', aim: hexAt(9, 9) }])).toMatch(/Tumbled/);
  });
});

// ------------------------------------------------------------------ Rest

describe('Rest', () => {
  it('is just a card: play it with another, take every card back, heal 2, lose nothing', () => {
    let s = newGame();
    const h = s.hunters[0];
    h.hp = 5;
    h.hand = ['rest.1', 'slash.1', 'slash.2', 'dash.1'];
    h.discard = ['dash.2', 'parry.1', 'sidestep.1', 'vault.1', 'vectorDash.1', 'climb.1'];
    s = playRound(s, null, { 1: [{ card: 'rest.1' }, { card: 'dash.1', dest: hexAt(2, 8) }] });
    const after = s.hunters[0];
    expect(after.hp).toBe(7);
    expect(after.pos).toBe(hexAt(2, 8)); // the other card still resolved
    expect(after.discard).toEqual([]);
    expect(after.hand.sort()).toEqual(['climb.1', 'dash.1', 'dash.2', 'parry.1', 'rest.1', 'sidestep.1', 'slash.1', 'slash.2', 'vault.1', 'vectorDash.1']);
  });

  it('Super Rest (Rest is your last card) heals 4 and upgrades a die, max 2, then +1 max HP', () => {
    let s = newGame();
    const superRest = (st: GameState) => {
      const h = st.hunters[0];
      h.discard = h.hand.filter((c) => c !== 'rest.1');
      h.hand = ['rest.1'];
      h.hp = 3;
      return playRound(st, null, { 1: [{ card: 'rest.1' }] });
    };
    s = superRest(s);
    expect(s.hunters[0].hp).toBe(7);
    expect(s.hunters[0].dice.filter((d) => d === 'standard')).toHaveLength(1);
    s = superRest(superRest(s));
    expect(s.hunters[0].upgrades).toBe(2);
    expect(s.hunters[0].maxHp).toBe(13);
    expect(s.hunters[0].hand).toHaveLength(10);
  });
});

// ------------------------------------------------------------------ Parry

describe('Parry', () => {
  it('can be played alone to stand still and deflect: no damage, Short Tumble, Charged Attack cancelled', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, [{ card: 'chargeForward.1', aim: hexAt(4, 0) }]);
    expect(s.pendingCharged).toHaveLength(1);
    const center = s.colossus.center;
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [spot] }], { 1: [{ card: 'parry.1' }] });
    expect(s.hunters[0].hp).toBe(12);
    expect(s.hunters[0].pos).toBe(spot);
    expect(s.stats.parries).toBe(1);
    expect(s.tumble).toMatchObject({ kind: 'short', endsRound: 3, parrier: 1 });
    expect(s.colossus.center).toBe(center);
  });

  it('whiffs when nothing lands on your hex: Exposed (+2 to every hit) next round', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, [{ card: 'bodyThrash.1', targets: [far(s)] }], { 1: [{ card: 'parry.1' }] });
    expect(s.stats.whiffs).toBe(1);
    expect(s.hunters[0].exposed).toBe(true);
    s = playRound(s, [{ card: 'quickSwipe.2', targets: [spot] }], { 1: [] });
    expect(s.hunters[0].hp).toBe(12 - 5);
    expect(s.hunters[0].pos).not.toBe(spot); // knockback 2
    expect(s.hunters[0].exposed).toBe(false);
  });

  it('is punished by Feint and cancelled (without a whiff) by Roar', () => {
    let s = newGame();
    s.hunters[0].pos = fromCenter(s, S, 2);
    s = playRound(s, [{ card: 'feint.1' }], { 1: [{ card: 'parry.1' }] });
    expect(s.hunters[0].exposed).toBe(true);
    let r = newGame();
    const spot = fromCenter(r, S, 2);
    r.hunters[0].pos = spot;
    giveBoss(r, 'roar.r');
    r = playRound(r, [{ card: 'roar.r' }], { 1: [{ card: 'parry.1' }] });
    expect(r.hunters[0].exposed).toBe(false);
    expect(r.stats.whiffs).toBe(0);
    expect(r.hunters[0].pos).not.toBe(spot);
  });
});

// ------------------------------------------------------------------ bigger attacks

describe('Colossus attacks', () => {
  it('Tri-Cone is a 120-degree V (a third of the arena around the Colossus), aimed at any hex', () => {
    const s = newGame();
    const c = s.colossus.center;
    for (const aim of [hexAt(4, 9), hexAt(9, 7), hexAt(0, 0), hexAt(7, 2)]) {
      const cone = coneHexes(c, aim);
      const a = angleBetween(parse(c), parse(aim));
      expect(cone.every((h) => angleDiff(angleBetween(parse(c), parse(h)), a) <= Math.PI / 3 + 1e-6)).toBe(true);
      // A third of the directions; the share of hexes depends on where the Colossus stands.
      expect(cone.length / groundHexes(c).length).toBeGreaterThan(0.2);
      expect(cone.length / groundHexes(c).length).toBeLessThan(0.55);
    }
  });

  it('Line Burst runs from the body to the edge of the arena toward the clicked hex', () => {
    const s = newGame();
    const c = s.colossus.center;
    const line = lineHexes(c, hexAt(9, 9));
    expect(line.length).toBeGreaterThanOrEqual(4);
    const body = new Set(bodyHexes(c));
    expect(line.some((h) => body.has(h))).toBe(false);
    const last = line[line.length - 1];
    expect(neighbors(last).some((n) => !inBoard(parse(n)))).toBe(true);
    expect(lineHexes(c, hexAt(4, 0)).length).toBeGreaterThanOrEqual(2);
  });

  it('Quick Swipe hits a 3-hex arc and Body Thrash a hex with its neighbours', () => {
    let s = newGame();
    s.hunters[0].pos = fromCenter(s, S, 2);
    s.hunters[1].pos = fromCenter(s, 2, 2);
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [hexAt(4, 6)] }]);
    expect(s.hunters[0].hp).toBe(9);
    let t = newGame();
    t.hunters[2].pos = hexAt(5, 8);
    t = playRound(t, [{ card: 'bodyThrash.1', targets: [hexAt(5, 7)] }]);
    expect(t.hunters[2].hp).toBe(9);
  });

  it('Charge Forward is declared a round early, then surges toward the clicked hex to the edge', () => {
    let s = newGame();
    s.hunters[1].pos = hexAt(4, 7);
    s = playRound(s, [{ card: 'chargeForward.1', aim: hexAt(4, 9) }]);
    expect(s.colossus.center).toBe(hexAt(4, 4));
    s = playRound(s, null);
    expect(s.colossus.center).toBe(hexAt(4, 8));
    expect(s.hunters[1].hp).toBe(8);
    expect(bodyHexes(s.colossus.center)).not.toContain(s.hunters[1].pos);
  });

  it('Stride walks the Colossus up to 2 hexes toward the clicked hex at the end of the round', () => {
    let s = newGame();
    const before = s.colossus.center;
    s = playRound(s, [{ card: 'stride.1', aim: hexAt(9, 4) }]);
    expect(s.colossus.center).not.toBe(before);
    expect(s.stats.bossMoves).toBe(1);
  });

  it('Red Cubes detonate next round, so moving out of the lane is safe', () => {
    let s = newGame();
    const lane = lineHexes(s.colossus.center, hexAt(4, 9));
    s.hunters[0].pos = lane[1];
    s.hunters[1].pos = lane[2];
    s = playRound(s, [{ card: 'lineBurst.1', aim: hexAt(4, 9) }]);
    expect(s.hunters[0].hp).toBe(12);
    s = playRound(s, null, { 1: [{ card: 'sidestep.1', dest: hexAt(2, 7) }] });
    expect(s.hunters[0].hp).toBe(12);
    expect(s.hunters[1].hp).toBe(7);
  });

  it('Blasting Shell reflects 2 when all but one Hunter attack', () => {
    let s = newGame();
    for (const [i, d] of [[0, 3], [1, 2], [2, 4]] as const) s.hunters[i].pos = fromCenter(s, d, 2);
    s.colossus.armor = 10;
    s = playRound(s, [{ card: 'blastingShell.1' }], { 1: [{ card: 'slash.1' }], 2: [{ card: 'volley.1' }], 3: [{ card: 'hammer.1' }] });
    expect(s.hunters.map((h) => h.hp)).toEqual([10, 10, 10, 12]);
  });
});

// ------------------------------------------------------------------ Tumbles and climbing

describe('Tumbles and climbing on the body', () => {
  it('Short Tumble: the parrier climbs onto the nearest body hex; it stands at the end of next round', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [spot] }], { 1: [{ card: 'parry.1' }] });
    const armor = s.colossus.armor;
    s = playRound(s, null, { 1: [{ card: 'climb.1' }] });
    expect(s.hunters[0].climbing).toBe(true);
    expect(bodyHexes(s.colossus.center)).toContain(s.hunters[0].pos);
    expect(s.hunters[0].pos).toBe(fromCenter(s, S, 1)); // the body hex next to them
    expect(s.tumble).toBeNull();
    expect(s.colossus.armor).toBe(armor);
  });

  it('Long Tumble lets every adjacent Hunter climb', () => {
    let s = newGame();
    s.hunters[0].pos = fromCenter(s, S, 2);
    s.hunters[2].pos = fromCenter(s, 2, 2);
    s.colossus.armor = 3;
    s = playRound(s, null, { 3: [{ card: 'sledge.1' }] });
    expect(s.tumble).toMatchObject({ kind: 'long', endsRound: 3 });
    s = playRound(s, null, { 1: [{ card: 'climb.1' }], 3: [{ card: 'climb.1' }] });
    expect(s.hunters[0].climbing && s.hunters[2].climbing).toBe(true);
  });

  it(`a Burst of ${BURST_TARGET} on the core lands a Vital Strike and throws the climbers clear unharmed`, () => {
    let s = newGame();
    climbOn(s, 2, fromCenter(s, S, 1));
    climbOn(s, 0, s.colossus.center);
    s.burst = BURST_TARGET - 3;
    // Vanguard steps onto the core, Sledge Shatter always deals 3+.
    s = playRound(s, null, { 3: [{ card: 'march.1', dest: s.colossus.center }, { card: 'sledge.1' }] });
    expect(s.points).toBe(1);
    expect(s.burst).toBe(0);
    expect(s.stats.bursts).toBe(1);
    expect(s.hunters.every((h) => !h.climbing)).toBe(true);
    expect(s.hunters[2].hp).toBe(12);
    expect(fullArmor(s)).toBe(18);
    expect(s.colossus.hand.some((c) => c.endsWith('.r'))).toBe(true);
  });

  it('attacks off the core do nothing; a climber who falls short is shaken off and hurt', () => {
    let s = newGame();
    climbOn(s, 0, fromCenter(s, S, 1), 0);
    s = playRound(s, null, { 1: [{ card: 'slash.1' }] });
    expect(s.burst).toBe(0);
    expect(s.hunters[0].climbing).toBe(false);
    expect(s.hunters[0].hp).toBe(12 - SHAKE_DAMAGE);
    expect(s.stats.shakeOffs).toBe(1);
  });

  it('climbers ride along when the Colossus moves, and Body Thrash on a body hex hits them', () => {
    let s = newGame();
    climbOn(s, 0, s.colossus.center);
    s = playRound(s, [{ card: 'stride.1', aim: hexAt(4, 0) }, { card: 'bodyThrash.1', targets: [hexAt(4, 4)] }], { 1: [] });
    expect(s.hunters[0].hp).toBe(9);
    expect(s.hunters[0].climbing).toBe(true);
    expect(s.hunters[0].pos).toBe(s.colossus.center);
    expect(s.colossus.center).not.toBe(hexAt(4, 4));
  });

  it('a climber can jump down with a move card', () => {
    let s = newGame();
    climbOn(s, 0, fromCenter(s, S, 1));
    s = playRound(s, null, { 1: [{ card: 'sidestep.1', dest: hexAt(4, 7) }] });
    expect(s.hunters[0].climbing).toBe(false);
    expect(s.hunters[0].pos).toBe(hexAt(4, 7));
  });
});

// ------------------------------------------------------------------ escalation & endings

describe('escalation and endings', () => {
  it('at one strike from defeat the Colossus is Enraged: up to 3 cards, one face up', () => {
    let s = newGame();
    s.points = 3;
    climbOn(s, 2, s.colossus.center);
    s.burst = BURST_TARGET - 3;
    s = playRound(s, null, { 3: [{ card: 'sledge.1' }] });
    expect(s.points).toBe(4);
    expect(s.colossus.enraged).toBe(true);
    const plays: BossPlay[] = [{ card: 'feint.1' }, { card: 'blastingShell.1' }, { card: 'quickSwipe.2', targets: [fromCenter(s, 0, 2)] }];
    const { lock } = makeBossCommitment(s, plays, 'z', 1);
    expect(lock.faceUp).toEqual(plays[1]);
    expect(() => applyAction(s, { ...lock, faceUp: null })).toThrow(/face up/);
    expect(applyAction(s, lock).phase).toBe('hunterCommit');
  });

  it('the Hunters win on the final Vital Strike', () => {
    let s = newGame();
    s.points = 4;
    climbOn(s, 2, s.colossus.center);
    s.burst = BURST_TARGET - 3;
    s = playRound(s, null, { 3: [{ card: 'sledge.1' }] });
    expect(s.winner).toBe('hunters');
  });

  it('the Colossus wins when every Hunter is Down', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters.forEach((h, i) => {
      if (i > 0) {
        h.down = true;
        h.hp = 0;
      }
    });
    s.hunters[0].pos = spot;
    s.hunters[0].hp = 3;
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [spot] }]);
    expect(s.winner).toBe('colossus');
  });
});

describe('Hunter details', () => {
  it('Slasher Momentum builds per consecutive attacking round and resets when hurt', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, null, { 1: [{ card: 'slash.1' }] });
    expect(s.hunters[0].momentum).toBe(1);
    s = playRound(s, null, { 1: [{ card: 'slash.2' }] });
    expect(s.hunters[0].momentum).toBe(2);
    s = playRound(s, [{ card: 'quickSwipe.2', targets: [spot] }], { 1: [{ card: 'vectorDash.1' }] });
    expect(s.hunters[0].momentum).toBe(0);
  });

  it('a Downed ally can be revived once by an adjacent Hunter spending their turn', () => {
    let s = newGame();
    s.hunters[0].pos = hexAt(3, 9);
    s.hunters[1].pos = hexAt(4, 9);
    s.hunters[1].hp = 0;
    s.hunters[1].down = true;
    s = playRound(s, null, { 1: { type: 'Revive', seat: 1, target: 2 } });
    expect(s.hunters[1]).toMatchObject({ down: false, hp: 4, revived: true });
  });

  it('Bleed removes 1 Armor at each of the next 2 cleanups', () => {
    let s = newGame();
    s.colossus.bleed = 2;
    s = playRound(s, null);
    expect(s.colossus.armor).toBe(15);
    s = playRound(s, null);
    expect(s.colossus.armor).toBe(14);
    expect(s.colossus.bleed).toBe(0);
  });
});

describe('determinism and hidden information', () => {
  it('the same seed and actions give byte-identical states', () => {
    const run = () => {
      let s = newGame(99);
      for (let i = 0; i < 8; i++) s = playRound(s, null);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('views hide the Colossus hand from Hunters and Hunter commits from the Colossus', () => {
    let s = newGame();
    s = applyAction(s, makeBossCommitment(s, [{ card: 'feint.1' }], 's').lock);
    s = applyAction(s, { type: 'CommitHunterCards', seat: 1, plays: [{ card: 'dash.1' }] });
    const hunterView = projectView(s, 2);
    expect(hunterView.colossus.hand.every((c) => c === 'hidden')).toBe(true);
    expect(hunterView.commits[0]?.kind).toBe('cards');
    expect(hunterView.rng).toBe(0);
    const bossView = projectView(s, 0);
    expect(bossView.colossus.hand).toEqual(s.colossus.hand);
    expect(bossView.commits[0]).toEqual({ kind: 'hidden' });
  });

  it('every resolution event carries a position snapshot for the replay', () => {
    let s = newGame();
    s = playRound(s, null, { 1: [{ card: 'dash.1', dest: hexAt(1, 7) }] });
    const move = s.log.find((e) => e.step === '3.1')!;
    expect(move.snap?.pos[0]).toBe(hexAt(1, 7));
  });
});
