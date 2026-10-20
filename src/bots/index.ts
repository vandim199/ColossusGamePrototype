import { makeBossCommitment, randomSalt, type Action, type BossCommitment, type GameState, type Rng } from '../engine';
import { colossusBotPlays } from './colossusBot';
import type { Difficulty } from './common';
import { hunterBotAction } from './hunterBot';

export * from './common';
export { colossusBotPlays, fallbackBossPlays } from './colossusBot';
export { hunterBotAction, fallbackHunterAction, chooseBurn } from './hunterBot';

/**
 * Colossus bot turn: choose plays from the Colossus's own view and wrap them in
 * a commit-reveal pair. `deterministicSalt` keeps the headless simulator reproducible.
 */
export function botBossCommitment(view: GameState, difficulty: Difficulty, rng: Rng, deterministicSalt = false): BossCommitment {
  const choice = colossusBotPlays(view, { rng, difficulty });
  const salt = randomSalt(deterministicSalt ? () => rng.next() : undefined);
  return makeBossCommitment(view, choice.plays, salt, choice.faceUpIndex);
}

export function botHunterAction(view: GameState, seat: number, difficulty: Difficulty, rng: Rng): Action {
  return hunterBotAction(view, seat, { rng, difficulty });
}
