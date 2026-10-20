// Card definitions. Card instances are ids like "slash.1": the part before the
// dot is the card type, the suffix just keeps copies distinct.

import type { DieKind } from './dice';
import type { HunterClass } from './types';

export const cardType = (id: string): string => id.slice(0, id.indexOf('.') === -1 ? id.length : id.indexOf('.'));

// ---------------------------------------------------------------- Colossus

export type BossCardKind = 'telegraph' | 'quick' | 'charged' | 'reaction' | 'rest';

export interface BossCardDef {
  type: string;
  name: string;
  kind: BossCardKind;
  text: string;
  /** What the card needs when locked. */
  needs: 'none' | 'dir' | 'adjacentHex' | 'hexOrNode' | 'twoTargets' | 'restCube';
  rage?: boolean;
}

const boss = (d: BossCardDef) => d;

export const BOSS_CARDS: Record<string, BossCardDef> = {
  triCone: boss({ type: 'triCone', name: 'Tri-Cone Blast', kind: 'telegraph', needs: 'dir', text: '3 cone lanes of 3 hexes. Red Cubes: 5 damage per hex next round.' }),
  lineBurst: boss({ type: 'lineBurst', name: 'Line Burst', kind: 'telegraph', needs: 'dir', text: 'One straight 5-hex line from the Colossus. Red Cubes: 5 damage next round.' }),
  ringSlam: boss({ type: 'ringSlam', name: 'Ring Slam', kind: 'telegraph', needs: 'none', text: 'Every hex at distance 2 from the Colossus. Red Cubes: 5 damage next round.' }),
  quickSwipe: boss({ type: 'quickSwipe', name: 'Quick Swipe', kind: 'quick', needs: 'adjacentHex', text: '1 adjacent ground hex: 3 damage, knockback 2.' }),
  bodyThrash: boss({ type: 'bodyThrash', name: 'Body Thrash', kind: 'quick', needs: 'hexOrNode', text: '1 ground hex or body node: 3 damage, -3 Grip.' }),
  feint: boss({ type: 'feint', name: 'Feint', kind: 'quick', needs: 'none', text: 'Looks like a Quick Attack; does nothing, but every Hunter who Parried is Exposed.' }),
  chargeForward: boss({ type: 'chargeForward', name: 'Charge Forward', kind: 'charged', needs: 'dir', text: 'Declared now, resolves next round: surge to the board edge, 4 damage and knockback in the path.' }),
  tailSweep: boss({ type: 'tailSweep', name: 'Tail Sweep', kind: 'charged', needs: 'none', text: 'Declared now, resolves next round: every hex on the back half of the ring takes 4 damage.' }),
  blastingShell: boss({ type: 'blastingShell', name: 'Blasting Shell', kind: 'reaction', needs: 'none', text: 'If all but one Hunter attack: reflect 2 to each attacker and gain 3 Armor. Otherwise lose 2 Armor.' }),
  rest: boss({ type: 'rest', name: 'Rest', kind: 'rest', needs: 'restCube', text: 'Played alone. Reclaim your discard, restore 2 Armor. Super Rest (last card): restore 4 Armor and place 1 free Red Cube.' }),
  stompQuake: boss({ type: 'stompQuake', name: 'Stomp Quake', kind: 'quick', needs: 'none', rage: true, text: 'Rage. Every hex adjacent to the Colossus takes 2 damage. Climbers lose 2 Grip.' }),
  roar: boss({ type: 'roar', name: 'Roar', kind: 'quick', needs: 'none', rage: true, text: 'Rage. All Hunters are pushed 2 hexes away. Cancels Parries this round (no whiff penalty).' }),
  wildThrash: boss({ type: 'wildThrash', name: 'Wild Thrash', kind: 'quick', needs: 'twoTargets', rage: true, text: 'Rage. Two Quick Attacks: 2 ground hexes or body nodes, 3 damage and -3 Grip each.' }),
  shellHarden: boss({ type: 'shellHarden', name: 'Shell Harden', kind: 'quick', needs: 'none', rage: true, text: 'Rage. Gain 4 Armor; Hunter attacks this round deal half damage, rounded down.' }),
};

export const bossDef = (id: string): BossCardDef => {
  const d = BOSS_CARDS[cardType(id)];
  if (!d) throw new Error(`Unknown Colossus card ${id}`);
  return d;
};

/** The 14-card Colossus deck. */
export const BOSS_DECK: readonly string[] = [
  'triCone.1', 'triCone.2',
  'lineBurst.1', 'lineBurst.2',
  'ringSlam.1',
  'quickSwipe.1', 'quickSwipe.2',
  'bodyThrash.1', 'bodyThrash.2',
  'feint.1',
  'chargeForward.1',
  'tailSweep.1',
  'blastingShell.1',
  'rest.1',
];

export const RAGE_DECK: readonly string[] = ['stompQuake.r', 'roar.r', 'wildThrash.r', 'shellHarden.r'];



// ---------------------------------------------------------------- Hunters

export interface HunterCardDef {
  type: string;
  name: string;
  text: string;
  move?: { kind: 'walk' | 'grapple' | 'vault'; range: number };
  attack?: { range: number; roll: 'pool' | 'vector' | 'sledge'; bleed?: boolean };
  parry?: boolean;
  climb?: boolean;
  rest?: boolean;
  ability?: 'anchor' | 'beam' | 'hymn';
}

const hc = (d: HunterCardDef) => d;

export const HUNTER_CARDS: Record<string, HunterCardDef> = {
  rest: hc({ type: 'rest', name: 'Rest', rest: true, text: 'Played alone. Reclaim your discard, burn 1 card, recover 2 HP. Super Rest (last card): recover 4 HP and upgrade a die.' }),
  parry: hc({ type: 'parry', name: 'Parry', parry: true, text: 'Play with a move. If a Quick Attack targets your final hex: no damage, Short Tumble, Charged Attack cancelled. Whiff: Exposed next round.' }),
  climb: hc({ type: 'climb', name: 'Climb & Strike', climb: true, text: 'During a Tumble, if adjacent: mount a Legs node at Grip 6. On the body it strikes like an attack.' }),
  // Quick Slasher
  slash: hc({ type: 'slash', name: 'Slash', attack: { range: 1, roll: 'pool' }, text: 'Melee. Roll your 6 Slasher dice + Momentum.' }),
  vectorDash: hc({ type: 'vectorDash', name: 'Infinite Vector Dash', move: { kind: 'walk', range: 3 }, attack: { range: 1, roll: 'vector' }, text: 'Move up to 3, then melee: roll 4 dice + Momentum.' }),
  vault: hc({ type: 'vault', name: 'Vault Over Colossus', move: { kind: 'vault', range: 0 }, text: 'From within 2 hexes of the Colossus, leap to any hex adjacent to it.' }),
  dash: hc({ type: 'dash', name: 'Dash', move: { kind: 'walk', range: 3 }, text: 'Move up to 3.' }),
  sidestep: hc({ type: 'sidestep', name: 'Sidestep', move: { kind: 'walk', range: 2 }, text: 'Move up to 2.' }),
  // Range Marksman
  volley: hc({ type: 'volley', name: 'Arrow Volley', attack: { range: 4, roll: 'pool', bleed: true }, text: 'Range 4. Roll 4 Standard dice. Two or more 2s: Bleed (1 Armor at each cleanup for 2 rounds).' }),
  grapple: hc({ type: 'grapple', name: 'Grapple Reposition', move: { kind: 'grapple', range: 4 }, text: 'Move to any hex within 4, over anything in the way.' }),
  step: hc({ type: 'step', name: 'Step', move: { kind: 'walk', range: 2 }, text: 'Move up to 2.' }),
  stride: hc({ type: 'stride', name: 'Stride', move: { kind: 'walk', range: 3 }, text: 'Move up to 3.' }),
  // Heavy Vanguard
  hammer: hc({ type: 'hammer', name: 'Hammer Blow', attack: { range: 1, roll: 'pool' }, text: 'Melee. Roll 2 Upgraded d4 + Heavy d8.' }),
  sledge: hc({ type: 'sledge', name: 'Sledge Shatter', attack: { range: 1, roll: 'sledge' }, text: 'Melee. 3 + Heavy d8 to Armor.' }),
  anchor: hc({ type: 'anchor', name: 'Anchor Stance', ability: 'anchor', text: 'If a Quick Attack targets you, block it and give +3 Shield to every adjacent ally. No Tumble.' }),
  march: hc({ type: 'march', name: 'March', move: { kind: 'walk', range: 2 }, text: 'Move up to 2.' }),
  advance: hc({ type: 'advance', name: 'Advance', move: { kind: 'walk', range: 3 }, text: 'Move up to 3.' }),
  // The Bard
  chord: hc({ type: 'chord', name: 'Chord Strike', attack: { range: 3, roll: 'pool' }, text: 'Range 3. Roll 2 Standard dice.' }),
  beam: hc({ type: 'beam', name: 'Rescue Beam', ability: 'beam', text: 'During movement: an ally within 5 hexes is pulled up to Pull d6 hexes toward you.' }),
  hymn: hc({ type: 'hymn', name: 'Harmonic Hymn', ability: 'hymn', text: 'You and every ally within 3 hexes recover 2 HP.' }),
};

export const hunterDef = (id: string): HunterCardDef => {
  const d = HUNTER_CARDS[cardType(id)];
  if (!d) throw new Error(`Unknown Hunter card ${id}`);
  return d;
};

export const isRestCard = (id: string) => cardType(id) === 'rest';

export interface ClassDef {
  cls: HunterClass;
  name: string;
  short: string;
  dice: DieKind[];
  deck: string[];
  blurb: string;
}

const deck = (...entries: [string, number][]) =>
  entries.flatMap(([t, n]) => Array.from({ length: n }, (_, i) => `${t}.${i + 1}`));

export const CLASSES: Record<HunterClass, ClassDef> = {
  slasher: {
    cls: 'slasher',
    name: 'Quick Slasher',
    short: 'Slasher',
    dice: Array(6).fill('slasher'),
    deck: deck(['rest', 1], ['parry', 1], ['climb', 1], ['slash', 2], ['vectorDash', 1], ['vault', 1], ['dash', 2], ['sidestep', 1]),
    blurb: 'Momentum: +1 die per consecutive attacking round (max +3). Resets when hurt.',
  },
  marksman: {
    cls: 'marksman',
    name: 'Range Marksman',
    short: 'Marksman',
    dice: Array(4).fill('standard'),
    deck: deck(['rest', 1], ['parry', 1], ['climb', 1], ['volley', 3], ['grapple', 1], ['step', 2], ['stride', 1]),
    blurb: 'Safe range vs moving into position. Volleys can Bleed the Armor.',
  },
  vanguard: {
    cls: 'vanguard',
    name: 'Heavy Vanguard',
    short: 'Vanguard',
    dice: ['upgraded', 'upgraded', 'heavy'],
    deck: deck(['rest', 1], ['parry', 1], ['climb', 1], ['hammer', 2], ['sledge', 1], ['anchor', 1], ['march', 2], ['advance', 1]),
    blurb: 'Stance (safe) vs Sledge (damage). Hits hardest, moves slowest.',
  },
  bard: {
    cls: 'bard',
    name: 'The Bard',
    short: 'Bard',
    dice: ['standard', 'standard'],
    deck: deck(['rest', 1], ['parry', 1], ['climb', 1], ['chord', 2], ['beam', 1], ['hymn', 1], ['stride', 2], ['step', 1]),
    blurb: 'Save an ally vs heal the group.',
  },
};

export const ALL_CLASSES: readonly HunterClass[] = ['slasher', 'marksman', 'vanguard', 'bard'];
