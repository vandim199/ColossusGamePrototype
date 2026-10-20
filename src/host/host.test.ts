import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackBossPlays } from '../bots';
import { createGame } from '../engine';
import { GameHost } from './gameHost';
import { LocalSession, seatsFor } from './session';

afterEach(() => {
  vi.useRealTimers();
});

async function runUntil(done: () => boolean, maxMs = 3_000_000) {
  for (let t = 0; t < maxMs && !done(); t += 100) await vi.advanceTimersByTimeAsync(100);
}

describe('GameHost', () => {
  it('drives an all-bot game to the end', async () => {
    vi.useFakeTimers();
    const state = createGame({ mode: '1v3', seed: 4 });
    const host = new GameHost(state, seatsFor(state.config.classes, 'spectator', 'normal'), { timer: 0, botDelayMs: 100, revealPauseMs: 200 });
    await runUntil(() => host.state.phase === 'gameOver');
    expect(host.state.phase).toBe('gameOver');
    expect(host.state.round).toBeGreaterThan(3);
  });

  it('a human Colossus locks through SeatClient, which reveals on its own', async () => {
    vi.useFakeTimers();
    const state = createGame({ mode: '1v4', seed: 9 });
    const host = new GameHost(state, seatsFor(state.config.classes, 0, 'normal'), { timer: 0, botDelayMs: 100, revealPauseMs: 100 });
    const session = new LocalSession(host, 0);
    let locks = 0;
    session.subscribe(() => {
      const v = session.view()!;
      if (v.state.phase === 'bossLock' && v.state.round > locks) {
        locks = v.state.round;
        void session.lockBoss(fallbackBossPlays(v.state), 0);
      }
    });
    await runUntil(() => host.state.round >= 4 || host.state.phase === 'gameOver');
    expect(host.state.round).toBeGreaterThanOrEqual(4);
    expect(host.state.lastReveal?.forfeited).toBe(false);
  });

  it('when the turn timer runs out, a bot plays for the silent human', async () => {
    vi.useFakeTimers();
    const state = createGame({ mode: '1v3', seed: 2 });
    const host = new GameHost(state, seatsFor(state.config.classes, 2, 'normal'), { timer: 60, botDelayMs: 100, revealPauseMs: 100 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.state.phase).toBe('hunterCommit');
    expect(host.state.commits[1]).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.state.round).toBe(2);
    expect(host.clientView(2).notices.join(' ')).toMatch(/Time ran out/);
  });
});
