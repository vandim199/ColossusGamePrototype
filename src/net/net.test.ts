import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackBossPlays, fallbackHunterAction } from '../bots';
import { NetClient } from './netClient';
import { NetHost } from './netHost';
import { Emitter, type Transport } from './transport';

/** An in-memory room: every transport sees every other one; delivery is async like a real network. */
class Hub {
  members = new Map<string, MemoryTransport>();
  join(id: string): MemoryTransport {
    const t = new MemoryTransport(id, this);
    for (const other of this.members.values()) {
      queueMicrotask(() => {
        other.joins.emit(id);
        t.joins.emit(other.selfId);
      });
    }
    this.members.set(id, t);
    return t;
  }
  drop(id: string) {
    this.members.delete(id);
    for (const other of this.members.values()) queueMicrotask(() => other.leaves.emit(id));
  }
}

class MemoryTransport implements Transport {
  readonly label = 'Memory';
  messages = new Emitter<[string, string]>();
  joins = new Emitter<[string]>();
  leaves = new Emitter<[string]>();
  constructor(
    readonly selfId: string,
    private hub: Hub,
  ) {}
  send(data: string, to?: string) {
    for (const [id, t] of this.hub.members) {
      if (id === this.selfId || (to && to !== id)) continue;
      queueMicrotask(() => t.messages.emit(data, this.selfId));
    }
  }
  onMessage(fn: (d: string, f: string) => void) {
    this.messages.on(fn);
  }
  onPeerJoin(fn: (p: string) => void) {
    this.joins.on(fn);
  }
  onPeerLeave(fn: (p: string) => void) {
    this.leaves.on(fn);
  }
  leave() {
    this.hub.drop(this.selfId);
  }
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

/** A remote Hunter that plays a legal fallback commit whenever it has to. */
function autoHunter(c: NetClient, seat: number) {
  c.subscribe(() => {
    const v = c.view;
    if (v?.you === seat && v.state.phase === 'hunterCommit' && !v.state.commits[seat - 1] && !v.state.hunters[seat - 1].down) {
      void c.sendAction(fallbackHunterAction(v.state, seat));
    }
  });
}

describe('peer-to-peer host and client', () => {
  it('lobby -> start -> remote Hunter plays; drop -> bot covers; rejoin -> seat reclaimed', async () => {
    const hub = new Hub();
    const host = new NetHost(hub.join('H'), 'ROOM1', 'Hana');
    const alice = new NetClient(hub.join('A'), 'ROOM1', 'Alice');
    await tick();
    expect(alice.lobby?.players.map((p) => p.name)).toEqual(['Hana', 'Alice']);
    expect(alice.lobby?.seats[0].occupant).toMatchObject({ kind: 'human', clientId: host.clientId }); // host defaults to Colossus

    alice.claim(2);
    await tick();
    expect(host.seatOf(alice.clientId)).toBe(2);
    host.setSeatOccupant(4, { kind: 'bot', difficulty: 'hard' });
    host.start();
    await tick();
    expect(alice.view?.you).toBe(2);
    expect(alice.view?.state.colossus.hand.every((c) => c === 'hidden')).toBe(true);
    expect(host.game!.seats.map((s) => s.controller)).toEqual(['local', 'bot', 'remote', 'bot', 'bot']);

    // The host plays its Colossus seat through its own session; Alice plays seat 2.
    host.hostSession!.subscribe(() => {
      const v = host.hostSession!.view()!;
      if (v.state.phase === 'bossLock') void host.hostSession!.lockBoss(fallbackBossPlays(v.state), 0);
    });
    autoHunter(alice, 2);
    void host.hostSession!.lockBoss(fallbackBossPlays(host.hostSession!.view()!.state), 0);
    for (let i = 0; i < 400 && host.game!.state.round < 3; i++) await tick(100);
    expect(host.game!.state.round).toBeGreaterThanOrEqual(3);
    expect(alice.seatClient.verified.get(1)).toBe(true);

    // Alice drops: a bot covers immediately and the game keeps going.
    alice.close();
    await tick();
    expect(host.game!.seat(2)).toMatchObject({ controller: 'bot', dropped: true });
    expect(host.lobby.dropped).toEqual([2]);
    const round = host.game!.state.round;
    for (let i = 0; i < 400 && host.game!.state.round < round + 2; i++) await tick(100);
    expect(host.game!.state.round).toBeGreaterThanOrEqual(round + 2);

    // Same tab rejoins with the same room code: seat 2 comes back to her.
    const again = new NetClient(hub.join('A2'), 'ROOM1', 'Alice');
    await tick();
    expect(again.clientId).toBe(alice.clientId);
    expect(host.game!.seat(2)).toMatchObject({ controller: 'remote', dropped: false });
    expect(again.view?.you).toBe(2);
  });

  it('a remote Colossus locks with a hash, reveals automatically, and a dropped lock is voided', async () => {
    const hub = new Hub();
    const host = new NetHost(hub.join('H'), 'ROOM2', 'Hana');
    const bob = new NetClient(hub.join('B'), 'ROOM2', 'Bob');
    await tick();
    host.claim(host.clientId, 1); // host moves to a Hunter seat
    bob.claim(0);
    await tick();
    host.start();
    await tick();
    expect(bob.view?.you).toBe(0);
    expect(bob.view?.state.colossus.hand).not.toContain('hidden');

    // Host sees only the commitment while Hunters decide.
    void bob.session().lockBoss(fallbackBossPlays(bob.view!.state), 0);
    await tick();
    expect(host.game!.state.phase).toBe('hunterCommit');
    expect(host.game!.state.lock?.commitment).toMatch(/^[0-9a-f]{64}$/);
    // Host (seat 1) commits; the rest are bots. Bob's client then opens the commitment by itself.
    await host.hostSession!.act(fallbackHunterAction(host.game!.state, 1));
    for (let i = 0; i < 100 && host.game!.state.round === 1; i++) await tick(100);
    expect(host.game!.state.round).toBe(2);
    expect(host.game!.state.lastReveal?.forfeited).toBe(false);

    // Round 2: Bob locks, then drops before revealing. His cards are voided; the game continues.
    for (let i = 0; i < 50 && bob.view?.state.phase !== 'bossLock'; i++) await tick(100);
    void bob.session().lockBoss(fallbackBossPlays(bob.view!.state), 0);
    await tick();
    bob.close();
    await host.hostSession!.act(fallbackHunterAction(host.game!.state, 1));
    for (let i = 0; i < 100 && host.game!.state.round === 2; i++) await tick(100);
    expect(host.game!.state.round).toBe(3);
    expect(host.game!.state.lastReveal?.forfeited).toBe(true);
    expect(host.game!.seat(0)).toMatchObject({ controller: 'bot', dropped: true });
  });

  it('clients learn when the host leaves', async () => {
    const hub = new Hub();
    const host = new NetHost(hub.join('H'), 'ROOM3', 'Hana');
    const c = new NetClient(hub.join('C'), 'ROOM3', 'Cy');
    await tick();
    expect(c.lobby).not.toBeNull();
    host.close();
    await tick();
    expect(c.hostLeft).toBe(true);
    expect(c.session().problem()).toMatch(/host left/i);
  });
});
