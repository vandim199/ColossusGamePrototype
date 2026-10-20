// The UI talks to a Session, whether the game runs in this tab (LocalSession)
// or on another peer (the online client session). Either way the UI only ever
// sees a ClientView for its own seat and only ever sends actions.

import { makeBossCommitment, randomSalt, verifyCommitment, type Action, type BossPlay, type GameState } from '../engine';
import { GameHost, type SubmitResult } from './gameHost';
import type { ClientView, SeatInfo } from './types';

export interface Session {
  readonly kind: 'local' | 'online';
  view(): ClientView | null;
  subscribe(fn: () => void): () => void;
  /** Hunter actions (CommitHunterCards, Rest, Revive). */
  act(action: Action): Promise<SubmitResult>;
  /** Colossus lock: hashes the plays, sends only the commitment + public parts, keeps the secret for the reveal. */
  lockBoss(plays: BossPlay[], faceUpIndex: number): Promise<SubmitResult>;
  /** A short status line for problems ("Host left the game"). */
  problem(): string | null;
  leave(): void;
}

/**
 * The client half of one seat. Holds the Colossus's secret between lock and
 * reveal and opens it automatically at the reveal step; verifies every reveal.
 */
export class SeatClient {
  private secret: { round: number; reveal: Extract<Action, { type: 'RevealBossCards' }> } | null = null;
  /** Rounds whose reveal this client has checked against the commitment. */
  readonly verified = new Map<number, boolean>();

  constructor(private send: (a: Action) => Promise<SubmitResult>) {}

  async lockBoss(state: GameState, plays: BossPlay[], faceUpIndex: number): Promise<SubmitResult> {
    if (state.phase !== 'bossLock') return { ok: false, error: 'Not the lock step' };
    const c = makeBossCommitment(state, plays, randomSalt(), faceUpIndex);
    // Keep the secret before sending (the reveal may be requested as soon as the lock lands),
    // but a rejected attempt must never clobber the secret of a lock that did land.
    const previous = this.secret;
    this.secret = { round: state.round, reveal: c.reveal };
    const r = await this.send(c.lock);
    if (!r.ok) this.secret = previous;
    return r;
  }

  /** Call on every new view. */
  onView(v: ClientView) {
    const s = v.state;
    if (this.secret && s.phase === 'bossReveal' && s.round === this.secret.round) {
      const reveal = this.secret.reveal;
      this.secret = null;
      void this.send(reveal);
    } else if (this.secret && s.round !== this.secret.round) {
      this.secret = null;
    }
    const r = s.lastReveal;
    if (r && !this.verified.has(r.round)) this.verified.set(r.round, r.forfeited ? false : verifyCommitment(r.commitment, r.plays, r.salt));
  }
}

/** Single-tab play: the authority runs here; one seat is yours, bots fill the rest. */
export class LocalSession implements Session {
  readonly kind = 'local';
  readonly seatClient: SeatClient;
  private current: ClientView | null = null;
  private listeners = new Set<() => void>();
  private unsub: () => void;

  constructor(
    readonly host: GameHost,
    readonly you: number | 'spectator',
  ) {
    this.seatClient = new SeatClient(async (a) => this.host.submit(a));
    this.unsub = host.subscribe(() => this.refresh());
    this.refresh();
  }

  private refresh() {
    this.current = this.host.clientView(this.you);
    this.seatClient.onView(this.current);
    for (const fn of this.listeners) fn();
  }

  view() {
    return this.current;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async act(action: Action) {
    if (action.seat !== this.you) return { ok: false as const, error: 'Not your seat' };
    return this.host.submit(action);
  }
  async lockBoss(plays: BossPlay[], faceUpIndex: number) {
    if (this.you !== 0) return { ok: false as const, error: 'Not your seat' };
    return this.seatClient.lockBoss(this.host.state, plays, faceUpIndex);
  }
  problem() {
    return null;
  }
  leave() {
    this.unsub();
    this.host.dispose();
  }
}

export function seatsFor(classes: GameState['config']['classes'], you: number | 'spectator', difficulty: SeatInfo['difficulty'], youName = 'You'): SeatInfo[] {
  return [
    { seat: 0, role: 'colossus' as const, controller: you === 0 ? ('local' as const) : ('bot' as const), name: you === 0 ? youName : 'Colossus bot', difficulty, dropped: false },
    ...classes.map((cls, i) => ({
      seat: i + 1,
      role: cls,
      controller: you === i + 1 ? ('local' as const) : ('bot' as const),
      name: you === i + 1 ? youName : 'Bot',
      difficulty,
      dropped: false,
    })),
  ];
}
