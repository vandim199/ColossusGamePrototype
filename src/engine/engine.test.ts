import { describe, expect, it } from 'vitest';
import {
  DIE_FACES,
  RuleError,
  applyAction,
  bodyHexes,
  createGame,
  dieAverage,
  fullArmor,
  makeBossCommitment,
  makeCommitment,
  projectView,
  requiredBossCount,
  rollDie,
  sha256Hex,
  validateHunterPlays,
  Rng,
  type BossPlay,
  type GameState,
} from './index';
import { emptyHex, fromCenter, hexAt, idleHunterAction, playRound } from './testkit';

const newGame = (seed = 1) => createGame({ mode: '1v4', seed });

/** Move a card from the Colossus discard (or nowhere, for Rage cards) into its hand. */
function giveBoss(s: GameState, card: string) {
  s.colossus.discard = s.colossus.discard.filter((c) => c !== card);
  if (!s.colossus.hand.includes(card)) s.colossus.hand.push(card);
}

const far = (s: GameState) => emptyHex(s, [hexAt(9, 0), hexAt(0, 0)]);
const S = 3 as const;

// ------------------------------------------------------------------ dice

describe('dice', () => {
  it('match the printed faces and averages', () => {
    expect(dieAverage('slasher')).toBe(0.5);
    expect(dieAverage('standard')).toBe(1);
    expect(dieAverage('upgraded')).toBe(1.5);
    expect(dieAverage('heavy')).toBe(2.25);
    expect(dieAverage('pull')).toBeCloseTo(2.667, 2);
    // class pools from the Hunter class table
    expect(6 * dieAverage('slasher')).toBe(3);
    expect(9 * dieAverage('slasher')).toBe(4.5); // with a +3 Momentum streak
    expect(4 * dieAverage('standard')).toBe(4);
    expect(2 * dieAverage('upgraded') + dieAverage('heavy')).toBe(5.25);
    expect(2 * dieAverage('standard')).toBe(2);
  });

  it('give the probabilities quoted in the changelog', () => {
    // Marksman Bleed: two or more 2s on 4 Standard d4 (26%)
    const p2 = DIE_FACES.standard.filter((f) => f === 2).length / 4;
    const bleed = 1 - (1 - p2) ** 4 - 4 * p2 * (1 - p2) ** 3;
    expect(bleed).toBeCloseTo(0.2617, 3);
    // Bard pull die: 50% chance of 3+
    expect(DIE_FACES.pull.filter((f) => f >= 3).length / 6).toBe(0.5);
  });

  it('roll deterministically from a seed and converge on the average', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const rollsA = Array.from({ length: 50 }, () => rollDie('heavy', () => a.next()));
    const rollsB = Array.from({ length: 50 }, () => rollDie('heavy', () => b.next()));
    expect(rollsA).toEqual(rollsB);
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
    const plays: BossPlay[] = [{ card: 'feint.1' }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }];
    const { lock, reveal } = makeBossCommitment(s, plays, 'salt-1');
    expect(lock.commitment).toBe(makeCommitment(plays, 'salt-1'));
    s = applyAction(s, lock);
    for (const h of s.hunters) s = applyAction(s, idleHunterAction(s, h.seat));
    expect(s.phase).toBe('bossReveal');
    // Swapped card
    expect(() => applyAction(s, { ...reveal, plays: [{ card: 'quickSwipe.1', targets: [{ hex: fromCenter(s, S, 2) }] }, plays[1]] })).toThrow(RuleError);
    // Wrong salt
    expect(() => applyAction(s, { ...reveal, salt: 'salt-2' })).toThrow(/does not match/);
    // The genuine reveal resolves the round
    const after = applyAction(s, reveal);
    expect(after.round).toBe(2);
    expect(after.lastReveal?.plays).toEqual(plays);
  });

  it('rejects a reveal whose cubes differ from the ones placed at lock', () => {
    let s = newGame();
    const plays: BossPlay[] = [{ card: 'lineBurst.1', dir: 0 }, { card: 'feint.1' }];
    const { lock, reveal } = makeBossCommitment(s, plays, 'x');
    s = applyAction(s, { ...lock, cubes: lock.cubes.slice(1) });
    for (const h of s.hunters) s = applyAction(s, idleHunterAction(s, h.seat));
    expect(() => applyAction(s, reveal)).toThrow(/cubes/);
  });
});

// ------------------------------------------------------------------ Parry / whiff

describe('Parry', () => {
  it('deflects a Quick Attack on your final hex: no damage, Short Tumble, Charged Attack cancelled', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    // Round 1: the Colossus locks a Charge Forward; it is declared at cleanup.
    s = playRound(s, [{ card: 'chargeForward.1', dir: 0 }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'dash.1' }, { card: 'dash.2' }],
    });
    expect(s.pendingCharged).toHaveLength(1);
    const center = s.colossus.center;
    // Round 2: Parry with a 0-hex move; the swipe lands on the parrier.
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [{ hex: spot }] }, { card: 'bodyThrash.2', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'parry.1' }, { card: 'sidestep.1' }],
    });
    expect(s.hunters[0].hp).toBe(12);
    expect(s.stats.parries).toBe(1);
    expect(s.tumble).toMatchObject({ kind: 'short', endsRound: 3, parrier: 1 });
    expect(s.colossus.center).toBe(center); // the charge never happened
    expect(s.hunters[0].exposed).toBe(false);
  });

  it('whiffs when nothing lands on your hex: Exposed (+2 to every hit) next round', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, [{ card: 'bodyThrash.1', targets: [{ hex: far(s) }] }, { card: 'quickSwipe.1', targets: [{ hex: fromCenter(s, 0, 2) }] }], {
      1: [{ card: 'parry.1' }, { card: 'dash.1' }],
    });
    expect(s.stats.whiffs).toBe(1);
    expect(s.hunters[0].exposed).toBe(true);
    s = playRound(s, [{ card: 'quickSwipe.2', targets: [{ hex: spot }] }, { card: 'bodyThrash.2', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'dash.2' }, { card: 'sidestep.1' }],
    });
    expect(s.hunters[0].hp).toBe(12 - 5); // 3 + Exposed 2
    expect(s.hunters[0].pos).not.toBe(spot); // knockback 2
    expect(s.hunters[0].exposed).toBe(false); // expired at cleanup
  });

  it('is punished by Feint and cancelled (without a whiff) by Roar', () => {
    let s = newGame();
    s.hunters[0].pos = fromCenter(s, S, 2);
    s = playRound(s, [{ card: 'feint.1' }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'parry.1' }, { card: 'dash.1' }],
    });
    expect(s.hunters[0].exposed).toBe(true);
    expect(s.stats.feintCatches).toBe(1);

    let r = newGame();
    const spot = fromCenter(r, S, 2);
    r.hunters[0].pos = spot;
    giveBoss(r, 'roar.r');
    r = playRound(r, [{ card: 'roar.r' }, { card: 'bodyThrash.1', targets: [{ hex: far(r) }] }], {
      1: [{ card: 'parry.1' }, { card: 'dash.1' }],
    });
    expect(r.hunters[0].exposed).toBe(false);
    expect(r.stats.whiffs).toBe(0);
    expect(r.hunters[0].pos).not.toBe(spot);
  });

  it('must be paired with a movement card', () => {
    const s = applyAction(newGame(), makeBossCommitment(newGame(), [{ card: 'feint.1' }, { card: 'blastingShell.1' }], 's').lock);
    expect(validateHunterPlays(s, 1, [{ card: 'parry.1' }, { card: 'slash.1' }])).toMatch(/movement/);
    expect(validateHunterPlays(s, 1, [{ card: 'parry.1' }, { card: 'vectorDash.1' }])).toBeNull();
  });
});

// ------------------------------------------------------------------ Tumbles and climbing

describe('Tumble and climbing', () => {
  it('Short Tumble: the parrier climbs, the Colossus stands at the end of next round with Armor unchanged', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [{ hex: spot }] }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'parry.1' }, { card: 'dash.1' }],
    });
    const armor = s.colossus.armor;
    expect(s.tumble?.endsRound).toBe(2);
    s = playRound(s, [{ card: 'feint.1' }, { card: 'bodyThrash.2', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'dash.2' }, { card: 'climb.1' }],
    });
    expect(s.hunters[0]).toMatchObject({ node: 'L1', grip: 6, pos: null });
    expect(s.tumble).toBeNull(); // stood up at cleanup of round 2
    expect(s.colossus.armor).toBe(armor);
  });

  it('Short Tumble allows one climber; Long Tumble lets every adjacent Hunter climb', () => {
    let s = newGame();
    s.hunters[0].pos = fromCenter(s, S, 2);
    s.hunters[2].pos = fromCenter(s, 2, 2);
    s.colossus.armor = 3;
    // Sledge Shatter always does at least 3: Armor hits 0 -> Long Tumble at cleanup.
    s = playRound(s, [{ card: 'feint.1' }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }], {
      1: [{ card: 'dash.1' }, { card: 'dash.2' }],
      3: [{ card: 'sledge.1' }, { card: 'march.1' }],
    });
    expect(s.tumble).toMatchObject({ kind: 'long', endsRound: 3 });
    expect(s.stats.shatters).toBe(1);
    s = playRound(s, null, {
      1: [{ card: 'climb.1' }, { card: 'sidestep.1' }],
      3: [{ card: 'climb.1' }, { card: 'march.2' }],
    });
    expect(s.hunters[0].node).toBe('L1');
    expect(s.hunters[2].node).toBe('L1');
    expect(s.tumble?.kind).toBe('long');
    s = playRound(s, null, { 1: [{ card: 'vault.1' }, { card: 'slash.1' }], 3: [{ card: 'advance.1' }, { card: 'hammer.1' }] });
    expect(s.tumble).toBeNull(); // stood at the end of round 3 (the round after next)
    expect(s.colossus.armor).toBe(fullArmor(s));
  });

  it('climbing costs Grip, strikes score once per node, and Escalation follows', () => {
    let s = newGame();
    const h = s.hunters[0];
    h.pos = null;
    h.node = 'L1';
    h.grip = 6;
    h.mountedRound = 1;
    const handBefore = s.colossus.hand.length;
    s = playRound(s, null, { 1: [{ card: 'sidestep.1', node: 'B1' }, { card: 'slash.1' }] });
    expect(s.points).toBe(1);
    expect(s.spentNodes).toEqual(['B1']);
    expect(s.hunters[0].grip).toBe(6 - 1 - 1); // move -1, standing at cleanup -1
    expect(fullArmor(s)).toBe(16 + 2);
    expect(s.colossus.hand.length).toBe(handBefore - 2 + 1); // played 2, gained a Rage card
    // Striking the spent node again does nothing.
    s = playRound(s, null, { 1: [{ card: 'dash.1' }, { card: 'slash.2' }] });
    expect(s.points).toBe(1);
  });

  it('Body Thrash on a node: 3 damage and -3 Grip; Grip 0 means a fall for 3 more', () => {
    let s = newGame();
    const h = s.hunters[0];
    h.pos = null;
    h.node = 'B1';
    h.grip = 3;
    h.mountedRound = 1;
    s = playRound(s, [{ card: 'bodyThrash.1', targets: [{ node: 'B1' }] }, { card: 'feint.1' }], { 1: [{ card: 'dash.1' }, { card: 'dash.2' }] });
    const after = s.hunters[0];
    expect(after.node).toBeNull();
    expect(after.hp).toBe(12 - 3 - 3);
    expect(s.stats.falls).toBe(1);
    expect(bodyHexes(s.colossus.center)).not.toContain(after.pos);
    expect(after.pos).not.toBeNull();
  });

  it('climbers lose 1 Grip per standing cleanup and fall at 0', () => {
    let s = newGame();
    const h = s.hunters[0];
    h.pos = null;
    h.node = 'L2';
    h.grip = 1;
    h.mountedRound = 1;
    s = playRound(s, null, { 1: [{ card: 'slash.1' }, { card: 'slash.2' }] });
    expect(s.hunters[0].node).toBeNull();
    expect(s.hunters[0].hp).toBe(9);
  });
});

// ------------------------------------------------------------------ Rest, burn, fatigue

describe('Rest and the fatigue clock', () => {
  it('Standard Rest reclaims the discard, burns the chosen card and heals 2', () => {
    let s = newGame();
    const h = s.hunters[0];
    h.hp = 5;
    h.hand = ['rest.1', 'slash.1', 'slash.2'];
    h.discard = ['dash.1', 'dash.2', 'parry.1', 'sidestep.1', 'vault.1', 'vectorDash.1', 'climb.1'];
    s = playRound(s, null, { 1: { type: 'Rest', seat: 1, burn: 'parry.1' } });
    const after = s.hunters[0];
    expect(after.hp).toBe(7);
    expect(after.burned).toEqual(['parry.1']);
    expect(after.discard).toEqual([]);
    expect(after.hand).toHaveLength(9);
    expect(after.hand).not.toContain('parry.1');
    expect(after.dice.filter((d) => d === 'standard')).toHaveLength(0); // not a Super Rest
  });

  it('Super Rest heals 4 and upgrades a die, max 2 upgrades, then +1 max HP (cap 14)', () => {
    let s = newGame();
    const superRest = (st: GameState, burn: string) => {
      const h = st.hunters[0];
      h.discard = h.hand.filter((c) => c !== 'rest.1');
      h.hand = ['rest.1'];
      h.hp = 3;
      return playRound(st, null, { 1: { type: 'Rest', seat: 1, burn } });
    };
    s = superRest(s, 'parry.1');
    expect(s.hunters[0].hp).toBe(7);
    expect(s.hunters[0].dice.filter((d) => d === 'standard')).toHaveLength(1);
    s = superRest(s, 'climb.1');
    expect(s.hunters[0].upgrades).toBe(2);
    expect(s.hunters[0].dice.filter((d) => d === 'standard')).toHaveLength(2);
    s = superRest(s, 'vault.1');
    expect(s.hunters[0].upgrades).toBe(2);
    expect(s.hunters[0].maxHp).toBe(13);
    expect(s.stats.superRests).toBe(3);

    // The Vanguard has nothing to upgrade, so its Super Rest raises max HP straight away.
    let v = newGame();
    const g = v.hunters[2];
    g.discard = g.hand.filter((c) => c !== 'rest.1');
    g.hand = ['rest.1'];
    v = playRound(v, null, { 3: { type: 'Rest', seat: 3, burn: 'parry.1' } });
    expect(v.hunters[2].maxHp).toBe(13);
  });

  it('Exhausts a Hunter whose deck drops below 4 cards', () => {
    let s = newGame();
    const h = s.hunters[1];
    h.hand = ['rest.1'];
    h.discard = ['volley.1', 'volley.2', 'step.1'];
    h.burned = ['parry.1', 'climb.1', 'grapple.1', 'step.2', 'stride.1', 'volley.3'];
    s = playRound(s, null, { 2: { type: 'Rest', seat: 2, burn: 'step.1' } });
    expect(s.hunters[1].exhausted).toBe(true);
    expect(s.hunters[1].pos).toBeNull();
    expect(s.stats.exhaustions).toBe(1);
  });

  it('a Hunter who plays every card and Rests each cycle is Exhausted after 7 Rests, on round 30', () => {
    let s = newGame(3);
    while (!s.winner) s = playRound(s, null);
    expect(s.winner).toBe('colossus');
    expect(s.round).toBe(30);
    expect(s.stats.exhaustions).toBe(4);
    for (const h of s.hunters) expect(h.burned).toHaveLength(7);
  });
});

// ------------------------------------------------------------------ escalation, charges, cubes

describe('escalation and the Colossus deck', () => {
  it('at one point from defeat the Colossus is Enraged: 3 cards, one face up', () => {
    let s = newGame();
    s.points = 2;
    const h = s.hunters[0];
    h.pos = null;
    h.node = 'B1';
    h.grip = 6;
    h.mountedRound = 1;
    s = playRound(s, null, { 1: [{ card: 'sidestep.1', node: 'H1' }, { card: 'slash.1' }] });
    expect(s.points).toBe(4);
    expect(fullArmor(s)).toBe(16 + 8);
    expect(s.colossus.hand.filter((c) => c.endsWith('.r'))).toHaveLength(2);
    expect(s.colossus.enraged).toBe(true);
    expect(requiredBossCount(s)).toBe(3);
    const plays: BossPlay[] = [{ card: 'feint.1' }, { card: 'blastingShell.1' }, { card: 'quickSwipe.2', targets: [{ hex: fromCenter(s, 0, 2) }] }];
    const { lock } = makeBossCommitment(s, plays, 'z', 1);
    expect(lock.faceUp).toEqual(plays[1]);
    expect(() => applyAction(s, { ...lock, faceUp: null })).toThrow(/face up/);
    expect(applyAction(s, lock).phase).toBe('hunterCommit');
  });

  it('the Hunters win on the final Vital Strike', () => {
    let s = newGame();
    s.points = 4;
    const h = s.hunters[0];
    h.pos = null;
    h.node = 'B2';
    h.grip = 4;
    s = playRound(s, null, { 1: [{ card: 'slash.1' }, { card: 'dash.1' }] });
    expect(s.winner).toBe('hunters');
    expect(s.phase).toBe('gameOver');
  });

  it('Charge Forward is declared a round early, then surges to the edge through Hunters', () => {
    let s = newGame();
    const victim = hexAt(4, 7);
    s.hunters[1].pos = victim;
    s = playRound(s, [{ card: 'chargeForward.1', dir: S }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }], {
      2: [{ card: 'step.1' }, { card: 'step.2' }],
    });
    expect(s.colossus.center).toBe(hexAt(4, 4));
    expect(s.pendingCharged).toEqual([{ card: 'chargeForward.1', dir: S }]);
    s = playRound(s, [{ card: 'feint.1' }, { card: 'bodyThrash.2', targets: [{ hex: far(s) }] }], {
      2: [{ card: 'stride.1' }, { card: 'grapple.1' }],
    });
    expect(s.colossus.center).toBe(hexAt(4, 8));
    expect(s.colossus.facing).toBe(S);
    expect(s.hunters[1].hp).toBe(8);
    expect(bodyHexes(s.colossus.center)).not.toContain(s.hunters[1].pos);
  });

  it('Red Cubes detonate next round, so moving out of the lane is safe', () => {
    let s = newGame();
    const lane = [fromCenter(s, S, 3), fromCenter(s, S, 4)];
    s.hunters[0].pos = lane[0];
    s.hunters[1].pos = lane[1];
    s = playRound(s, [{ card: 'lineBurst.1', dir: S }, { card: 'feint.1' }], {
      1: [{ card: 'dash.1' }, { card: 'dash.2' }],
      2: [{ card: 'step.1' }, { card: 'step.2' }],
    });
    expect(s.cubes[0].hexes).toEqual(expect.arrayContaining(lane));
    expect(s.hunters[0].hp).toBe(12);
    s = playRound(s, [{ card: 'bodyThrash.1', targets: [{ hex: far(s) }] }, { card: 'blastingShell.1' }], {
      1: [{ card: 'sidestep.1', dest: hexAt(2, 7) }, { card: 'vault.1' }],
      2: [{ card: 'stride.1' }, { card: 'grapple.1' }],
    });
    expect(s.hunters[0].hp).toBe(12);
    expect(s.hunters[1].hp).toBe(7);
    expect(s.cubes).toHaveLength(0);
  });

  it('Blasting Shell reflects 2 when all but one Hunter attack', () => {
    let s = newGame();
    for (const [i, d] of [[0, 3], [1, 2], [2, 4]] as const) s.hunters[i].pos = fromCenter(s, d, 2);
    s.colossus.armor = 10;
    s = playRound(s, [{ card: 'blastingShell.1' }, { card: 'feint.1' }], {
      1: [{ card: 'slash.1' }, { card: 'dash.1' }],
      2: [{ card: 'volley.1' }, { card: 'step.1' }],
      3: [{ card: 'hammer.1' }, { card: 'march.1' }],
      4: [{ card: 'stride.1' }, { card: 'stride.2' }],
    });
    expect(s.hunters[0].hp).toBe(10);
    expect(s.hunters[1].hp).toBe(10);
    expect(s.hunters[2].hp).toBe(10);
    expect(s.hunters[3].hp).toBe(12);
  });
});

// ------------------------------------------------------------------ misc rules

describe('Hunter details', () => {
  it('Slasher Momentum builds per consecutive attacking round and resets when hurt', () => {
    let s = newGame();
    const spot = fromCenter(s, S, 2);
    s.hunters[0].pos = spot;
    s.colossus.armor = 16;
    s = playRound(s, null, { 1: [{ card: 'slash.1' }, { card: 'dash.1' }] });
    expect(s.hunters[0].momentum).toBe(1);
    s = playRound(s, null, { 1: [{ card: 'slash.2' }, { card: 'dash.2' }] });
    expect(s.hunters[0].momentum).toBe(2);
    s = playRound(s, [{ card: 'quickSwipe.2', targets: [{ hex: spot }] }, { card: 'blastingShell.1' }], {
      1: [{ card: 'vectorDash.1' }, { card: 'sidestep.1' }],
    });
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
    expect(s.hunters[0].hand).toHaveLength(10); // no cards spent
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
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [{ hex: spot }] }, { card: 'feint.1' }], { 1: [{ card: 'dash.1' }, { card: 'dash.2' }] });
    expect(s.winner).toBe('colossus');
  });

  it('Bleed removes 1 Armor at each of the next 2 cleanups', () => {
    let s = newGame();
    s.colossus.bleed = 2;
    s = playRound(s, [{ card: 'feint.1' }, { card: 'bodyThrash.1', targets: [{ hex: far(s) }] }]);
    expect(s.colossus.armor).toBe(15);
    s = playRound(s, [{ card: 'quickSwipe.1', targets: [{ hex: fromCenter(s, 0, 2) }] }, { card: 'bodyThrash.2', targets: [{ hex: far(s) }] }]);
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
    s = applyAction(s, makeBossCommitment(s, [{ card: 'feint.1' }, { card: 'blastingShell.1' }], 's').lock);
    s = applyAction(s, idleHunterAction(s, 1));
    const hunterView = projectView(s, 2);
    expect(hunterView.colossus.hand.every((c) => c === 'hidden')).toBe(true);
    expect(hunterView.commits[0]?.kind).toBe('cards');
    expect(hunterView.rng).toBe(0);
    const bossView = projectView(s, 0);
    expect(bossView.colossus.hand).toEqual(s.colossus.hand);
    expect(bossView.commits[0]).toEqual({ kind: 'hidden' });
    expect(projectView(s, 'spectator').commits[0]).toEqual({ kind: 'hidden' });
  });
});
