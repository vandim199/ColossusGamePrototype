// Headless AI vs AI games through the exact same action path the UI and the
// network use: per-seat views, commit-reveal for the Colossus, applyAction.

import { botBossCommitment, botHunterAction, type Difficulty } from '../bots';
import {
  Rng,
  applyAction,
  createGame,
  projectView,
  seatsToAct,
  seedFrom,
  type Action,
  type GameState,
  type HunterClass,
  type Mode,
} from '../engine';

export interface SimOptions {
  mode: Mode;
  seed: number;
  classes?: HunterClass[];
  boss?: Difficulty;
  hunters?: Difficulty;
}

export function simulateGame(o: SimOptions): GameState {
  let s = createGame({ mode: o.mode, seed: o.seed, classes: o.classes });
  const rng = new Rng(seedFrom(`bots:${o.seed}`));
  let reveal: Action | null = null;
  for (let guard = 0; s.phase !== 'gameOver'; guard++) {
    if (guard > 10000) throw new Error(`Game ${o.seed} did not finish`);
    if (s.phase === 'bossLock') {
      const c = botBossCommitment(projectView(s, 0), o.boss ?? 'normal', rng, true);
      s = applyAction(s, c.lock);
      reveal = c.reveal;
    } else if (s.phase === 'hunterCommit') {
      for (const seat of seatsToAct(s)) s = applyAction(s, botHunterAction(projectView(s, seat), seat, o.hunters ?? 'normal', rng));
    } else if (s.phase === 'bossReveal') {
      s = applyAction(s, reveal!);
    }
  }
  return s;
}

export interface Report {
  games: number;
  mode: Mode;
  hunterWins: number;
  colossusWins: number;
  draws: number;
  rounds: number[];
  points: number[];
  parries: number[];
  whiffs: number[];
  feintCatches: number[];
  climbs: number[];
  bursts: number[];
  shakeOffs: number[];
  downs: number[];
  revives: number[];
  bossMoves: number[];
  shatters: number[];
  shortTumbles: number[];
  climbLengths: number[];
  /** Rounds between consecutive Vital Strike points (first gap counts from round 0). */
  strikeGaps: number[];
  armorPerRound: number[];
  hunterRests: number[];
  bossRests: number[];
}

export function runBatch(opts: Omit<SimOptions, 'seed'> & { games: number; seed: number }): Report {
  const r: Report = {
    games: opts.games,
    mode: opts.mode,
    hunterWins: 0,
    colossusWins: 0,
    draws: 0,
    rounds: [],
    points: [],
    parries: [],
    whiffs: [],
    feintCatches: [],
    climbs: [],
    bursts: [],
    shakeOffs: [],
    downs: [],
    revives: [],
    bossMoves: [],
    shatters: [],
    shortTumbles: [],
    climbLengths: [],
    strikeGaps: [],
    armorPerRound: [],
    hunterRests: [],
    bossRests: [],
  };
  for (let i = 0; i < opts.games; i++) {
    const s = simulateGame({ ...opts, seed: opts.seed + i });
    if (s.winner === 'hunters') r.hunterWins++;
    else if (s.winner === 'colossus') r.colossusWins++;
    else r.draws++;
    const st = s.stats;
    r.rounds.push(s.round);
    r.points.push(s.points);
    r.parries.push(st.parries);
    r.whiffs.push(st.whiffs);
    r.feintCatches.push(st.feintCatches);
    r.climbs.push(st.climbs);
    r.bursts.push(st.bursts);
    r.shakeOffs.push(st.shakeOffs);
    r.downs.push(st.downs);
    r.revives.push(st.revives);
    r.bossMoves.push(st.bossMoves);
    r.shatters.push(st.shatters);
    r.shortTumbles.push(st.shortTumbles);
    r.climbLengths.push(...st.climbLengths);
    r.armorPerRound.push(st.armorDamage / Math.max(1, st.standingRounds));
    r.hunterRests.push(st.hunterRests);
    r.bossRests.push(st.bossRests);
    let prev = 0;
    for (const round of st.pointRounds) {
      r.strikeGaps.push(round - prev);
      prev = round;
    }
  }
  return r;
}
