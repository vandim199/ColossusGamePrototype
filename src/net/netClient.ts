// A joining peer: talks only to the host, sends actions, renders the views it
// receives. Its SeatClient keeps the Colossus's secret (if it holds that seat)
// and opens the commitment at the reveal step.

import type { Action, BossPlay } from '../engine';
import { SeatClient, type Session } from '../host/session';
import type { SubmitResult } from '../host/gameHost';
import type { ClientView } from '../host/types';
import { HEARTBEAT_MS, SILENCE_MS, clientIdFor, parse, type ClientMsg, type HostMsg, type LobbyState } from './protocol';
import type { Transport } from './transport';

const ACK_TIMEOUT_MS = 10_000;

export class NetClient {
  lobby: LobbyState | null = null;
  view: ClientView | null = null;
  hostPeer: string | null = null;
  hostLeft = false;
  readonly clientId: string;
  readonly seatClient: SeatClient;
  private listeners = new Set<() => void>();
  private seq = 0;
  private pending = new Map<number, (r: SubmitResult) => void>();
  private lastHostMsg = 0;
  private hostSaidBye = false;
  private lastRehello = 0;
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval>;
  private onPageHide = () => this.send({ t: 'bye' });

  constructor(
    readonly transport: Transport,
    readonly code: string,
    readonly name: string,
  ) {
    this.clientId = clientIdFor(code);
    this.seatClient = new SeatClient((a) => this.sendAction(a));
    transport.onPeerJoin((peer) => this.sendTo(peer, { t: 'hello', clientId: this.clientId, name }));
    transport.onPeerLeave((peer) => {
      if (peer === this.hostPeer) this.markHostLeft();
    });
    transport.onMessage((data, from) => {
      const msg = parse<HostMsg>(data);
      if (msg) this.handle(msg, from);
    });
    this.send({ t: 'hello', clientId: this.clientId, name });
    this.heartbeat = setInterval(() => {
      if (!this.hostPeer) {
        this.send({ t: 'hello', clientId: this.clientId, name });
        return;
      }
      this.send({ t: 'beat' });
      if (!this.hostLeft && Date.now() - this.lastHostMsg > SILENCE_MS) this.markHostLeft();
    }, HEARTBEAT_MS);
    globalThis.addEventListener?.('pagehide', this.onPageHide);
  }

  private markHostLeft() {
    if (this.hostLeft) return;
    this.hostLeft = true;
    for (const resolve of this.pending.values()) resolve({ ok: false, error: 'The host left' });
    this.pending.clear();
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private send(msg: ClientMsg) {
    this.transport.send(JSON.stringify(msg), this.hostPeer ?? undefined);
  }

  private sendTo(peer: string, msg: ClientMsg) {
    this.transport.send(JSON.stringify(msg), peer);
  }

  private handle(msg: HostMsg, from: string) {
    if (this.closed) return;
    if (from === this.hostPeer || msg.t === 'lobby') {
      this.lastHostMsg = Date.now();
      // Silence is not goodbye: a host whose tab was throttled comes back on its next message.
      if (this.hostLeft && !this.hostSaidBye && msg.t !== 'bye') {
        this.hostLeft = false;
        this.emit();
      }
    }
    if (msg.t === 'lobby') {
      // The first peer to answer with a lobby is the host; ignore anyone else claiming to be.
      if (this.hostPeer && from !== this.hostPeer) return;
      if (!this.hostPeer) this.hostPeer = from;
      this.lobby = msg.lobby;
      // If the host thinks we dropped while we are still here, introduce ourselves again to reclaim the seat.
      const mine = msg.lobby.seats.find((s) => s.occupant.kind === 'human' && s.occupant.clientId === this.clientId);
      if (msg.lobby.started && mine && msg.lobby.dropped.includes(mine.seat) && Date.now() - this.lastRehello > 2000) {
        this.lastRehello = Date.now();
        this.send({ t: 'hello', clientId: this.clientId, name: this.name });
      }
      this.emit();
      return;
    }
    if (from !== this.hostPeer) return;
    if (msg.t === 'bye') {
      this.hostSaidBye = true;
      this.markHostLeft();
    } else if (msg.t === 'view') {
      this.view = msg.view;
      this.seatClient.onView(msg.view);
      this.emit();
    } else if (msg.t === 'ack') {
      this.pending.get(msg.seq)?.({ ok: msg.ok, error: msg.error ?? 'Rejected' } as SubmitResult);
      this.pending.delete(msg.seq);
    }
  }

  claim(seat: number) {
    this.send({ t: 'claim', seat });
  }

  release() {
    this.send({ t: 'release' });
  }

  sendAction(action: Action): Promise<SubmitResult> {
    if (!this.hostPeer || this.hostLeft) return Promise.resolve({ ok: false, error: 'Not connected to the host' });
    const seq = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(seq, resolve);
      this.send({ t: 'action', action, seq });
      setTimeout(() => {
        if (this.pending.delete(seq)) resolve({ ok: false, error: 'No answer from the host' });
      }, ACK_TIMEOUT_MS);
    });
  }

  session(): Session {
    return {
      kind: 'online',
      view: () => this.view,
      subscribe: (fn) => this.subscribe(fn),
      act: (a) => this.sendAction(a),
      lockBoss: (plays: BossPlay[], faceUp: number) =>
        this.view ? this.seatClient.lockBoss(this.view.state, plays, faceUp) : Promise.resolve({ ok: false, error: 'No game yet' }),
      problem: () => (this.hostLeft ? 'The host left the game.' : null),
      leave: () => this.close(),
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.send({ t: 'bye' });
    clearInterval(this.heartbeat);
    globalThis.removeEventListener?.('pagehide', this.onPageHide);
    this.listeners.clear();
    setTimeout(() => this.transport.leave(), 300);
  }
}
