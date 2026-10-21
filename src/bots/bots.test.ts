import { describe, expect, it } from 'vitest';
import { Rng, applyAction, createGame, makeBossCommitment, projectView, validateBossPlays, validateHunterPlays } from '../engine';
import { simulateGame } from '../sim/simulate';
import { colossusBotPlays, fallbackBossPlays, fallbackHunterAction, hunterBotAction } from './index';

describe('bots', () => {
  it('play complete AI vs AI games in both modes without a single illegal action', () => {
    // applyAction throws on any illegal action, so finishing proves legality.
    for (let seed = 1; seed <= 4; seed++) {
      for (const mode of ['1v3', '1v4'] as const) {
        const s = simulateGame({ mode, seed, boss: seed % 3 === 0 ? 'hard' : 'normal', hunters: seed % 2 ? 'easy' : 'hard' });
        expect(s.phase).toBe('gameOver');
        expect(s.winner).not.toBeNull();
      }
    }
  }, 60_000);

  it('are deterministic for a given seed', () => {
    const a = simulateGame({ mode: '1v4', seed: 5 });
    const b = simulateGame({ mode: '1v4', seed: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('decide from the seat view alone (no hidden information needed)', () => {
    const s = createGame({ mode: '1v4', seed: 3 });
    const bossView = projectView(s, 0);
    const choice = colossusBotPlays(bossView, { rng: new Rng(1), difficulty: 'normal' });
    expect(validateBossPlays(s, choice.plays)).toBeNull();
    const locked = applyAction(s, makeBossCommitment(s, choice.plays, 'salt').lock);
    const hunterView = projectView(locked, 2);
    expect(hunterView.colossus.hand.every((c) => c === 'hidden')).toBe(true);
    const a = hunterBotAction(hunterView, 2, { rng: new Rng(2), difficulty: 'hard' });
    expect(a.type === 'CommitHunterCards' ? validateHunterPlays(locked, 2, a.plays) : null).toBeNull();
  });

  it('fallbacks are always legal', () => {
    const s = createGame({ mode: '1v3', seed: 8 });
    expect(validateBossPlays(s, fallbackBossPlays(s))).toBeNull();
    const locked = applyAction(s, makeBossCommitment(s, fallbackBossPlays(s), 'x').lock);
    for (const h of locked.hunters) {
      const a = fallbackHunterAction(locked, h.seat);
      expect(a.type === 'CommitHunterCards' ? validateHunterPlays(locked, h.seat, a.plays) : null).toBeNull();
    }
  });
});
