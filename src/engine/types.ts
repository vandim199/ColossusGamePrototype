import type { DieKind } from './dice';
import type { Dir, HexKey } from './hex';

export type HunterClass = 'slasher' | 'marksman' | 'vanguard' | 'bard';
export type Mode = '1v3' | '1v4';
export type Phase = 'bossLock' | 'hunterCommit' | 'bossReveal' | 'gameOver';
export type Winner = 'hunters' | 'colossus' | 'draw';

/** Seat 0 is always the Colossus; seats 1..n are Hunters in seating order from the boss's left. */
export const BOSS_SEAT = 0;

export interface GameConfig {
  mode: Mode;
  /** Hunter classes in seating order (seat 1 first). 3 for 1v3, 4 for 1v4. */
  classes: HunterClass[];
  seed: number;
  /** Safety valve: a game that reaches this round is a draw. */
  maxRounds: number;
}

// ---------------------------------------------------------------- actions

/** One Colossus card as locked behind the screen, with its targeting. */
export interface BossPlay {
  card: string;
  /** Aimed cards (Tri-Cone, Line Burst, Charge Forward, Stride): any hex; the attack points from the Colossus toward it. */
  aim?: HexKey;
  /** Quick Swipe (1), Body Thrash (1), Wild Thrash (2). Body Thrash may target a body hex to hit climbers. */
  targets?: HexKey[];
  /** Super Rest's free Red Cube. */
  hex?: HexKey;
}

/** One Hunter card committed face up, with its targeting. */
export interface HunterPlay {
  card: string;
  /** Movement destination. Climbers may pick a body hex (climb) or a ground hex (jump down). */
  dest?: HexKey;
  /** Ally seat (Rescue Beam). */
  target?: number;
}

export type HunterCommit =
  | { kind: 'cards'; plays: HunterPlay[] }
  | { kind: 'revive'; target: number }
  /** Only appears in redacted views: "committed, but you can't see what". */
  | { kind: 'hidden' };

export type Action =
  | {
      type: 'LockBossCards';
      seat: 0;
      /** sha256(canonicalJson(plays) + ':' + salt) */
      commitment: string;
      cardCount: number;
      /** New Red Cubes, placed face up now. */
      cubes: HexKey[];
      /** Enraged only: the one card locked face up. */
      faceUp: BossPlay | null;
    }
  /** 0, 1 or 2 cards (Rest included). Zero cards is a pass. */
  | { type: 'CommitHunterCards'; seat: number; plays: HunterPlay[] }
  | { type: 'Revive'; seat: number; target: number }
  | { type: 'RevealBossCards'; seat: 0; plays: BossPlay[]; salt: string }
  /** Host-only escape hatch when a remote Colossus can't (or won't validly) open its commitment. */
  | { type: 'ForfeitBossReveal'; seat: 0 };

// ---------------------------------------------------------------- state

export interface HunterState {
  seat: number;
  cls: HunterClass;
  hp: number;
  maxHp: number;
  /** Ground hex, or a Colossus body hex while climbing. */
  pos: HexKey;
  /** Standing on the Colossus (pos is one of its 7 hexes; the Hunter rides along when it moves). */
  climbing: boolean;
  /** Round this Hunter mounted; it is shaken off at the end of the following round. */
  mountedRound: number | null;
  hand: string[];
  discard: string[];
  /** Attack dice pool (Super Rest upgrades these). */
  dice: DieKind[];
  upgrades: number;
  /** Quick Slasher bonus dice (0-3). */
  momentum: number;
  exposed: boolean;
  exposedNext: boolean;
  shield: number;
  down: boolean;
  /** A Hunter can be revived once per game. */
  revived: boolean;
  attackedThisRound: boolean;
  damagedThisRound: boolean;
}

export interface ColossusState {
  center: HexKey;
  facing: Dir;
  armor: number;
  hand: string[];
  discard: string[];
  /** Rounds of Bleed left (Marksman). */
  bleed: number;
  enraged: boolean;
}

export interface CubeWave {
  /** Round the cubes were placed; they detonate at step 3.2 of the next round. */
  round: number;
  hexes: HexKey[];
}

export interface Tumble {
  kind: 'short' | 'long';
  /** The Colossus stands at cleanup of this round. */
  endsRound: number;
  /** Mounts still allowed (1 for a Short Tumble, effectively unlimited for Long). */
  climbsLeft: number;
  /** Seat of the Hunter whose Parry caused a Short Tumble. */
  parrier: number | null;
}

export interface BossLockInfo {
  commitment: string;
  cardCount: number;
  cubes: HexKey[];
  faceUp: BossPlay | null;
}

export interface RevealRecord {
  round: number;
  commitment: string;
  plays: BossPlay[];
  salt: string;
  forfeited: boolean;
}

export type Step = 'setup' | 'lock' | 'reveal' | '3.1' | '3.2' | '3.3' | '3.4' | '3.5' | 'cleanup' | 'end';

/** A visible dice roll, so every client can animate the same result. */
export interface DiceRoll {
  /** Seat that rolled. */
  seat: number;
  /** What was rolled for ("Arrow Volley", "Rescue Beam"). */
  label: string;
  kinds: DieKind[];
  faces: number[];
  /** Flat amount added to the dice (Sledge Shatter's +3). */
  bonus: number;
  /** Final result after halving, if any. */
  total: number;
  halved: boolean;
}

/** Where everything stands right after a log event, so the UI can replay a round step by step. */
export interface Snapshot {
  center: HexKey;
  /** Hunter positions by index (seat - 1). */
  pos: HexKey[];
  down: boolean[];
}

export interface LogEvent {
  round: number;
  step: Step;
  text: string;
  /** Rough category for UI styling and animation. */
  tone: 'info' | 'boss' | 'hunter' | 'damage' | 'heal' | 'parry' | 'strike' | 'big';
  seat?: number;
  hexes?: HexKey[];
  /** The Colossus took a hit (the UI shakes it). */
  bossHit?: boolean;
  /** Present when this event is a dice roll. */
  dice?: DiceRoll;
  snap?: Snapshot;
}

export interface GameStats {
  parries: number;
  whiffs: number;
  feintCatches: number;
  shortTumbles: number;
  shatters: number;
  downs: number;
  revives: number;
  climbs: number;
  /** Climbers shaken off because the Burst fell short. */
  shakeOffs: number;
  /** Bursts that landed a Vital Strike. */
  bursts: number;
  hunterRests: number;
  superRests: number;
  bossRests: number;
  bossMoves: number;
  /** Round of each Vital Strike. */
  pointRounds: number[];
  /** Rounds each climb lasted (mount to dismount). */
  climbLengths: number[];
  armorDamage: number;
  /** Rounds the Colossus spent standing (Armor damage only matters then). */
  standingRounds: number;
  damageToHunters: number;
}

export interface GameState {
  config: GameConfig;
  round: number;
  phase: Phase;
  /** RNG state. Redacted to 0 in client views. */
  rng: number;
  colossus: ColossusState;
  /** Index i is seat i + 1. */
  hunters: HunterState[];
  cubes: CubeWave[];
  points: number;
  target: number;
  /** Damage dealt to the Colossus's core by climbers on its central hex in the current climb. */
  burst: number;
  ragePile: string[];
  tumble: Tumble | null;
  /** Declared last round (arrow token); resolves at step 3.5 this round. */
  pendingCharged: BossPlay[];
  /** Locked this round; becomes the arrow token at cleanup. */
  chargedThisRound: BossPlay[];
  lock: BossLockInfo | null;
  /** Index i is seat i + 1. */
  commits: (HunterCommit | null)[];
  lastReveal: RevealRecord | null;
  winner: Winner | null;
  log: LogEvent[];
  stats: GameStats;
}
