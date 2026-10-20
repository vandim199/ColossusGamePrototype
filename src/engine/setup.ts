import { BOSS_DECK, CLASSES, RAGE_DECK } from './cards';
import { fromOffset, key, type HexKey } from './hex';
import { nextRandom } from './rng';
import type { GameConfig, GameState, HunterClass, HunterState, Mode } from './types';

export const HUNTER_HP = 12;
export const HUNTER_MAX_HP_CAP = 14;
export const ARMOR_PER_HUNTER = 4;
export const ARMOR_PER_POINT = 2;
export const START_GRIP = 6;

export const COLOSSUS_START: HexKey = key(fromOffset(4, 4));
/** Hunters start along the bottom edge, facing the Colossus. */
const HUNTER_START_COLS: Record<number, number[]> = { 3: [2, 4, 7], 4: [1, 3, 6, 8] };

export const strikesToWin = (mode: Mode) => (mode === '1v3' ? 4 : 5);
export const fullArmor = (s: Pick<GameState, 'hunters' | 'points'>) =>
  ARMOR_PER_HUNTER * s.hunters.length + ARMOR_PER_POINT * s.points;

export interface NewGameOptions {
  mode: Mode;
  classes?: HunterClass[];
  seed: number;
  maxRounds?: number;
}

export function defaultClasses(mode: Mode): HunterClass[] {
  return mode === '1v4' ? ['slasher', 'marksman', 'vanguard', 'bard'] : ['slasher', 'marksman', 'vanguard'];
}

export function createGame(opts: NewGameOptions): GameState {
  const classes = opts.classes ?? defaultClasses(opts.mode);
  const n = opts.mode === '1v4' ? 4 : 3;
  if (classes.length !== n) throw new Error(`${opts.mode} needs ${n} Hunter classes`);
  if (new Set(classes).size !== n) throw new Error('Each Hunter class can be taken once');
  const config: GameConfig = { mode: opts.mode, classes, seed: opts.seed | 0, maxRounds: opts.maxRounds ?? 80 };

  let rng = config.seed;
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const rage = [...RAGE_DECK];
  for (let i = rage.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rage[i], rage[j]] = [rage[j], rage[i]];
  }

  const hunters: HunterState[] = classes.map((cls, i) => ({
    seat: i + 1,
    cls,
    hp: HUNTER_HP,
    maxHp: HUNTER_HP,
    pos: key(fromOffset(HUNTER_START_COLS[n][i], 9)),
    node: null,
    grip: 0,
    hand: [...CLASSES[cls].deck],
    discard: [],
    burned: [],
    dice: [...CLASSES[cls].dice],
    upgrades: 0,
    momentum: 0,
    exposed: false,
    exposedNext: false,
    shield: 0,
    down: false,
    revived: false,
    exhausted: false,
    attackedThisRound: false,
    damagedThisRound: false,
    mountedRound: null,
  }));

  const state: GameState = {
    config,
    round: 1,
    phase: 'bossLock',
    rng,
    colossus: {
      center: COLOSSUS_START,
      facing: 3,
      armor: ARMOR_PER_HUNTER * n,
      hand: [...BOSS_DECK],
      discard: [],
      bleed: 0,
      enraged: false,
    },
    hunters,
    cubes: [],
    points: 0,
    target: strikesToWin(opts.mode),
    spentNodes: [],
    ragePile: rage,
    tumble: null,
    pendingCharged: [],
    chargedThisRound: [],
    lock: null,
    commits: hunters.map(() => null),
    lastReveal: null,
    winner: null,
    log: [
      {
        round: 1,
        step: 'setup',
        tone: 'info',
        text: `${opts.mode}: the Colossus (Armor ${ARMOR_PER_HUNTER * n}) faces ${hunters.length} Hunters. ${strikesToWin(opts.mode)} Vital Strike points win.`,
      },
    ],
    stats: {
      parries: 0,
      whiffs: 0,
      feintCatches: 0,
      shortTumbles: 0,
      shatters: 0,
      exhaustions: 0,
      downs: 0,
      revives: 0,
      falls: 0,
      hunterRests: 0,
      superRests: 0,
      bossRests: 0,
      pointRounds: [],
      climbLengths: [],
      armorDamage: 0,
      damageToHunters: 0,
    },
  };
  return state;
}
