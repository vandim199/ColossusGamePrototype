// The authority. Runs the engine and the bots, validates every submitted
// action, and hands out per-seat views. Used in-page for local play and by the
// host peer for online play; humans, bots and remote peers all submit the same
// serializable actions.

import { botBossCommitment, botHunterAction, fallbackBossPlays, fallbackHunterAction } from '../bots';
import {
  Rng,
  applyAction,
  makeBossCommitment,
  projectView,
  randomSalt,
  seatsToAct,
  seedFrom,
  type Action,
  type GameState,
} from '../engine';
import { roleName, type ClientView, type SeatInfo, type TimerSetting } from './types';

export interface HostOptions {
  timer: TimerSetting;
  /** Pause before a bot acts, so humans can follow along. */
  botDelayMs: number;
  /** Extra pause after a reveal so clients can play the reveal animation. */
  revealPauseMs: number;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

export class GameHost {
  state: GameState;
  seats: SeatInfo[];
  readonly opts: HostOptions;
  private listeners = new Set<() => void>();
  /** A reveal produced on the host (bot Colossus, or a timer substitute) waiting for the reveal step. */
  private hostReveal: Extract<Action, { type: 'RevealBossCards' }> | null = null;
  private botTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  private pauseUntil = 0;
  private stepKey = '';
  private rng: Rng;
  private notices: string[] = [];
  private disposed = false;

  constructor(state: GameState, seats: SeatInfo[], opts: HostOptions) {
    this.state = state;
    this.seats = seats;
    this.opts = opts;
    this.rng = new Rng(seedFrom(`host:${state.config.seed}:${Date.now()}`));
    queueMicrotask(() => this.tick());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.disposed = true;
    for (const t of this.botTimers.values()) clearTimeout(t);
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.listeners.clear();
  }

  seat(seat: number): SeatInfo {
    return this.seats[seat];
  }

  /** Swap who drives a seat (drop to bot, reclaim, host toggles). */
  setController(seat: number, patch: Partial<SeatInfo>) {
    this.seats[seat] = { ...this.seats[seat], ...patch };
    this.tick();
  }

  notice(text: string) {
    this.notices = [...this.notices.slice(-4), text];
  }

  clientView(viewer: number | 'spectator'): ClientView {
    const timer =
      this.deadline && this.opts.timer
        ? { remainingMs: Math.max(0, this.deadline - Date.now()), totalMs: this.opts.timer * 1000 }
        : null;
    return { you: viewer, state: projectView(this.state, viewer), seats: this.seats.map((x) => ({ ...x })), timer, notices: [...this.notices] };
  }

  /** Apply an action for a seat. The caller has already checked that the submitter controls the seat. */
  submit(action: Action): SubmitResult {
    if (this.disposed) return { ok: false, error: 'Game closed' };
    try {
      this.state = applyAction(this.state, action);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (action.type === 'RevealBossCards' || action.type === 'ForfeitBossReveal') {
      this.hostReveal = null;
      this.pauseUntil = Date.now() + this.opts.revealPauseMs;
    }
    this.tick();
    return { ok: true };
  }

  /** The Colossus seat's lock+reveal pair built on the host (bot or timer substitute). */
  private lockForHost(plays: ReturnType<typeof fallbackBossPlays>, faceUpIndex = 0) {
    const c = makeBossCommitment(projectView(this.state, 0), plays, randomSalt(), faceUpIndex);
    const r = this.submit(c.lock);
    if (r.ok) this.hostReveal = c.reveal;
    return r;
  }

  /** Re-evaluate who must act: start timers, schedule bots, open the reveal, notify listeners. */
  private tick() {
    if (this.disposed) return;
    const s = this.state;
    const key = `${s.round}:${s.phase}`;
    if (key !== this.stepKey) {
      // Every pending bot timer belongs to the step that just ended.
      for (const t of this.botTimers.values()) clearTimeout(t);
      this.botTimers.clear();
      this.stepKey = key;
      this.resetStepTimer();
    }
    if (s.phase === 'bossReveal' && this.hostReveal) {
      const reveal = this.hostReveal;
      this.schedule(0, Math.max(250, this.opts.botDelayMs / 2), () => {
        if (this.state.phase === 'bossReveal' && this.hostReveal === reveal) this.submit(reveal);
      });
    }
    if (s.phase !== 'bossReveal') {
      for (const seat of seatsToAct(s)) if (this.seats[seat].controller === 'bot') this.scheduleBot(seat);
    }
    for (const fn of this.listeners) fn();
  }

  private resetStepTimer() {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = null;
    this.deadline = null;
    const s = this.state;
    if (!this.opts.timer || (s.phase !== 'bossLock' && s.phase !== 'hunterCommit')) return;
    const start = Math.max(Date.now(), this.pauseUntil);
    this.deadline = start + this.opts.timer * 1000;
    const key = this.stepKey;
    this.stepTimer = setTimeout(() => {
      if (this.stepKey === key) this.onTimeout();
    }, this.deadline - Date.now());
  }

  /** Time ran out: a bot plays for every seat that still has to act. */
  private onTimeout() {
    const s = this.state;
    for (const seat of seatsToAct(s)) {
      if (this.seats[seat].controller === 'bot') continue;
      this.notice(`Time ran out: a bot played for the ${roleName(this.seats[seat].role)}.`);
      this.botAct(seat);
    }
  }

  private schedule(seat: number, delay: number, fn: () => void) {
    if (this.botTimers.has(seat)) return;
    const wait = Math.max(delay, this.pauseUntil - Date.now());
    this.botTimers.set(
      seat,
      setTimeout(() => {
        this.botTimers.delete(seat);
        if (!this.disposed) fn();
      }, wait),
    );
  }

  private scheduleBot(seat: number) {
    const key = this.stepKey;
    this.schedule(seat + 100, this.opts.botDelayMs * (0.7 + 0.6 * this.rng.next()), () => {
      if (this.stepKey === key && seatsToAct(this.state).includes(seat) && this.seats[seat].controller === 'bot') this.botAct(seat);
    });
  }

  private botAct(seat: number) {
    const s = this.state;
    const info = this.seats[seat];
    if (seat === 0) {
      if (s.phase !== 'bossLock') return;
      let c;
      try {
        c = botBossCommitment(projectView(s, 0), info.difficulty, this.rng);
      } catch {
        c = null;
      }
      const r = c ? this.submit(c.lock) : { ok: false as const, error: 'bot failed' };
      if (r.ok && c) this.hostReveal = c.reveal;
      else this.lockForHost(fallbackBossPlays(s));
      return;
    }
    let a: Action;
    try {
      a = botHunterAction(projectView(s, seat), seat, info.difficulty, this.rng);
    } catch {
      a = fallbackHunterAction(s, seat);
    }
    if (!this.submit(a).ok) this.submit(fallbackHunterAction(this.state, seat));
  }

  /** The remote Colossus left after locking: its cards can never be opened. */
  forfeitReveal() {
    if (this.state.phase === 'bossReveal' && !this.hostReveal) {
      this.notice('The Colossus player left before revealing: its locked cards are void this round.');
      this.submit({ type: 'ForfeitBossReveal', seat: 0 });
    }
  }

  /** True when the host holds the secret for the current lock (so a dropped Colossus does not void it). */
  get holdsReveal() {
    return this.hostReveal !== null;
  }
}
