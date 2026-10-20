// The only networking surface the rest of the app sees. Swap the
// implementation (PeerJS, a hosted relay, ...) without touching the game.

export interface Transport {
  readonly selfId: string;
  readonly label: string;
  /** Send to one peer, or to everyone in the room when `to` is omitted. */
  send(data: string, to?: string): void;
  onMessage(fn: (data: string, from: string) => void): void;
  onPeerJoin(fn: (peerId: string) => void): void;
  onPeerLeave(fn: (peerId: string) => void): void;
  leave(): void;
}

export type TransportKind = 'trystero' | 'local';

/** Small fan-out helper so implementations can support several listeners. */
export class Emitter<A extends unknown[]> {
  private fns: ((...a: A) => void)[] = [];
  on(fn: (...a: A) => void) {
    this.fns.push(fn);
  }
  emit(...a: A) {
    for (const fn of this.fns) fn(...a);
  }
  clear() {
    this.fns = [];
  }
}

export async function openTransport(kind: TransportKind, room: string): Promise<Transport> {
  if (kind === 'local') {
    const { broadcastTransport } = await import('./broadcastTransport');
    return broadcastTransport(room);
  }
  const { trysteroTransport } = await import('./trysteroTransport');
  return trysteroTransport(room);
}
