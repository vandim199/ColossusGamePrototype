// The host peer: runs the lobby, then the authoritative GameHost (engine +
// bots). Clients only ever send actions; each receives only its own seat's
// view. Dropped players are covered by a bot at once and can reclaim.

import type { Difficulty } from '../bots';
import { ALL_CLASSES, createGame, defaultClasses, type HunterClass, type Mode } from '../engine';
import { GameHost } from '../host/gameHost';
import { LocalSession } from '../host/session';
import { roleName, type SeatInfo, type TimerSetting } from '../host/types';
import { HEARTBEAT_MS, SILENCE_MS, parse, type ClientMsg, type HostMsg, type LobbySeat, type LobbyState } from './protocol';
import type { Transport } from './transport';

/** Seconds a connected remote Colossus gets to open its commitment before its cards are voided. */
const REVEAL_GRACE_MS = 15_000;

export class NetHost {
  lobby: LobbyState;
  game: GameHost | null = null;
  hostSession: LocalSession | null = null;
  readonly clientId: string;
  /** peerId -> clientId */
  private peers = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeen = new Map<string, number>();
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval>;
  private onPageHide = () => this.broadcast({ t: 'bye' });

  constructor(
    readonly transport: Transport,
    code: string,
    hostName: string,
  ) {
    // Fresh id: a tab opened from the host's tab may inherit its sessionStorage.
    this.clientId = `h-${Math.random().toString(36).slice(2, 10)}`;
    this.lobby = {
      code,
      transport: transport.label.startsWith('Local') ? 'local' : 'trystero',
      mode: '1v4',
      benched: 'bard',
      timer: 0,
      botDifficulty: 'normal',
      seats: [],
      players: [{ clientId: this.clientId, name: hostName, connected: true }],
      hostClientId: this.clientId,
      started: false,
      dropped: [],
    };
    this.lobby.seats = this.buildSeats([]);
    // If the Colossus is human, the host plays it by default (the host machine runs the engine).
    this.lobby.seats[0].occupant = { kind: 'human', clientId: this.clientId };
    transport.onPeerJoin((peer) => this.sendTo(peer, { t: 'lobby', lobby: this.lobby }));
    transport.onPeerLeave((peer) => this.dropPeer(peer));
    transport.onMessage((data, from) => {
      const msg = parse<ClientMsg>(data);
      if (!msg || this.closed) return;
      this.lastSeen.set(from, Date.now());
      this.handle(msg, from);
    });
    this.heartbeat = setInterval(() => {
      this.broadcast({ t: 'beat' });
      const now = Date.now();
      for (const [peer, t] of this.lastSeen) if (now - t > SILENCE_MS && this.peers.has(peer)) this.dropPeer(peer);
    }, HEARTBEAT_MS);
    globalThis.addEventListener?.('pagehide', this.onPageHide);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.broadcast({ t: 'lobby', lobby: this.lobby });
    for (const fn of this.listeners) fn();
  }

  private sendTo(peer: string, msg: HostMsg) {
    this.transport.send(JSON.stringify(msg), peer);
  }

  private broadcast(msg: HostMsg) {
    this.transport.send(JSON.stringify(msg));
  }

  // ---------------------------------------------------------------- lobby

  private classes(mode = this.lobby.mode, benched = this.lobby.benched): HunterClass[] {
    return mode === '1v4' ? defaultClasses('1v4') : ALL_CLASSES.filter((c) => c !== benched);
  }

  /** Rebuild seats for the current mode, keeping each occupant on the same role where it still exists. */
  private buildSeats(previous: LobbySeat[], mode = this.lobby.mode, benched = this.lobby.benched): LobbySeat[] {
    const roles: LobbySeat['role'][] = ['colossus', ...this.classes(mode, benched)];
    return roles.map((role, seat) => ({ seat, role, occupant: previous.find((p) => p.role === role)?.occupant ?? { kind: 'empty' } }));
  }

  seatOf(clientId: string): number | null {
    const s = this.lobby.seats.find((x) => x.occupant.kind === 'human' && x.occupant.clientId === clientId);
    return s ? s.seat : null;
  }

  playerName(clientId: string) {
    return this.lobby.players.find((p) => p.clientId === clientId)?.name ?? 'Player';
  }

  setMode(mode: Mode) {
    if (this.lobby.started) return;
    this.lobby = { ...this.lobby, mode, seats: this.buildSeats(this.lobby.seats, mode) };
    this.changed();
  }

  setBenched(benched: HunterClass) {
    if (this.lobby.started) return;
    this.lobby = { ...this.lobby, benched, seats: this.buildSeats(this.lobby.seats, this.lobby.mode, benched) };
    this.changed();
  }

  setTimer(timer: TimerSetting) {
    if (this.lobby.started) return;
    this.lobby = { ...this.lobby, timer };
    this.changed();
  }

  setBotDifficulty(botDifficulty: Difficulty) {
    if (this.lobby.started) return;
    this.lobby = { ...this.lobby, botDifficulty };
    this.changed();
  }

  /** Host toggles an empty seat to Bot and back, or changes a bot's difficulty. */
  setSeatOccupant(seat: number, occupant: Occupant) {
    if (this.lobby.started) return;
    const cur = this.lobby.seats[seat];
    if (!cur || cur.occupant.kind === 'human') return;
    this.lobby = { ...this.lobby, seats: this.lobby.seats.map((s) => (s.seat === seat ? { ...s, occupant } : s)) };
    this.changed();
  }

  claim(clientId: string, seat: number): string | null {
    const target = this.lobby.seats[seat];
    if (!target) return 'No such seat';
    if (this.lobby.started) {
      if (!this.lobby.dropped.includes(seat)) return 'That seat is taken';
      if (this.seatOf(clientId) !== null) return 'You already have a seat';
      this.assign(clientId, seat);
      return null;
    }
    if (target.occupant.kind === 'human' && target.occupant.clientId !== clientId) return 'That seat is taken';
    const seats = this.lobby.seats.map((s) => {
      if (s.occupant.kind === 'human' && s.occupant.clientId === clientId) return { ...s, occupant: { kind: 'empty' } as Occupant };
      return s;
    });
    seats[seat] = { ...seats[seat], occupant: { kind: 'human', clientId } };
    this.lobby = { ...this.lobby, seats };
    this.changed();
    return null;
  }

  release(clientId: string) {
    if (this.lobby.started) return;
    this.lobby = {
      ...this.lobby,
      seats: this.lobby.seats.map((s) => (s.occupant.kind === 'human' && s.occupant.clientId === clientId ? { ...s, occupant: { kind: 'empty' } } : s)),
    };
    this.changed();
  }

  /** Mid-game: hand a dropped seat back to a human. */
  private assign(clientId: string, seat: number) {
    this.lobby = {
      ...this.lobby,
      seats: this.lobby.seats.map((s) => (s.seat === seat ? { ...s, occupant: { kind: 'human', clientId } } : s)),
      dropped: this.lobby.dropped.filter((x) => x !== seat),
    };
    this.game?.setController(seat, { controller: clientId === this.clientId ? 'local' : 'remote', dropped: false, name: this.playerName(clientId) });
    this.game?.notice(`${this.playerName(clientId)} took over the ${roleName(this.lobby.seats[seat].role)}.`);
    this.changed();
  }

  start(): string | null {
    if (this.lobby.started) return 'Already started';
    const seats = this.lobby.seats.map((s) => (s.occupant.kind === 'empty' ? { ...s, occupant: { kind: 'bot', difficulty: this.lobby.botDifficulty } as Occupant } : s));
    const classes = this.classes();
    const state = createGame({ mode: this.lobby.mode, classes, seed: Math.floor(Math.random() * 2 ** 31) });
    const infos: SeatInfo[] = seats.map((s) => {
      const o = s.occupant;
      if (o.kind === 'human')
        return { seat: s.seat, role: s.role, controller: o.clientId === this.clientId ? 'local' : 'remote', name: this.playerName(o.clientId), difficulty: this.lobby.botDifficulty, dropped: false };
      return { seat: s.seat, role: s.role, controller: 'bot', name: 'Bot', difficulty: o.kind === 'bot' ? o.difficulty : this.lobby.botDifficulty, dropped: false };
    });
    this.game = new GameHost(state, infos, { timer: this.lobby.timer, botDelayMs: 700, revealPauseMs: 1500 });
    this.hostSession = new LocalSession(this.game, this.seatOf(this.clientId) ?? 'spectator');
    this.game.subscribe(() => this.onGameChange());
    this.lobby = { ...this.lobby, seats, started: true };
    this.changed();
    this.onGameChange();
    return null;
  }

  // ---------------------------------------------------------------- messages

  private handle(msg: ClientMsg, peer: string) {
    const clientId = this.peers.get(peer);
    switch (msg.t) {
      case 'hello': {
        if (typeof msg.clientId !== 'string' || msg.clientId === this.clientId) return;
        this.peers.set(peer, msg.clientId);
        const name = String(msg.name || 'Player').slice(0, 24);
        const players = this.lobby.players.filter((p) => p.clientId !== msg.clientId);
        this.lobby = { ...this.lobby, players: [...players, { clientId: msg.clientId, name, connected: true }] };
        // Reconnect: a returning player gets their seat back straight away.
        const seat = this.seatOf(msg.clientId);
        if (this.lobby.started && seat !== null && this.lobby.dropped.includes(seat)) this.assign(msg.clientId, seat);
        else this.changed();
        this.sendView(peer);
        return;
      }
      case 'claim': {
        if (!clientId || !Number.isInteger(msg.seat)) return;
        this.claim(clientId, msg.seat);
        if (this.lobby.started) this.sendView(peer);
        return;
      }
      case 'release':
        if (clientId) this.release(clientId);
        return;
      case 'beat':
        return;
      case 'bye':
        this.dropPeer(peer);
        return;
      case 'action': {
        const reply = (ok: boolean, error?: string) => this.sendTo(peer, { t: 'ack', seq: msg.seq, ok, error });
        const seat = clientId ? this.seatOf(clientId) : null;
        if (!this.game || seat === null) return reply(false, 'You do not hold a seat');
        if (this.game.seat(seat).controller !== 'remote') return reply(false, 'A bot is playing this seat');
        const action = msg.action;
        if (!action || typeof action !== 'object' || action.seat !== seat) return reply(false, 'Not your seat');
        const r = this.game.submit(action);
        // An invalid reveal can never become valid: void the locked cards so the game goes on.
        if (!r.ok && action.type === 'RevealBossCards') this.game.forfeitReveal();
        return reply(r.ok, r.ok ? undefined : r.error);
      }
    }
  }

  private dropPeer(peer: string) {
    const clientId = this.peers.get(peer);
    this.peers.delete(peer);
    this.lastSeen.delete(peer);
    if (!clientId || [...this.peers.values()].includes(clientId)) return;
    this.lobby = { ...this.lobby, players: this.lobby.players.map((p) => (p.clientId === clientId ? { ...p, connected: false } : p)) };
    const seat = this.seatOf(clientId);
    if (!this.lobby.started) {
      this.release(clientId);
      return;
    }
    if (seat !== null && this.game) {
      this.lobby = { ...this.lobby, dropped: [...new Set([...this.lobby.dropped, seat])] };
      this.game.notice(`${this.playerName(clientId)} disconnected: a bot covers their seat until they rejoin.`);
      this.game.setController(seat, { controller: 'bot', dropped: true });
    }
    this.changed();
  }

  private sendView(peer: string) {
    if (!this.game) return;
    const clientId = this.peers.get(peer);
    const seat = clientId ? this.seatOf(clientId) : null;
    this.sendTo(peer, { t: 'view', view: this.game.clientView(seat ?? 'spectator') });
  }

  private onGameChange() {
    const g = this.game;
    if (!g) return;
    for (const peer of this.peers.keys()) this.sendView(peer);
    // Commit-reveal guard: the Colossus's secret lives only on the client that locked.
    const s = g.state;
    if (s.phase === 'bossReveal' && !g.holdsReveal) {
      const boss = g.seat(0);
      if (boss.controller === 'bot') {
        g.forfeitReveal();
      } else if (boss.controller === 'remote' && !this.revealTimer) {
        const round = s.round;
        this.revealTimer = setTimeout(() => {
          this.revealTimer = null;
          if (g.state.phase === 'bossReveal' && g.state.round === round) g.forfeitReveal();
        }, REVEAL_GRACE_MS);
      }
    } else if (this.revealTimer && s.phase !== 'bossReveal') {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.broadcast({ t: 'bye' });
    clearInterval(this.heartbeat);
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.game?.dispose();
    this.listeners.clear();
    // Let the goodbye flush before the data channels close.
    setTimeout(() => this.transport.leave(), 300);
  }
}

type Occupant = LobbySeat['occupant'];
