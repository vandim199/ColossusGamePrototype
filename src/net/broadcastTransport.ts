// Same-machine transport for testing with several tabs (?net=local): a
// BroadcastChannel per room, with presence via hello/heartbeat/bye.

import { Emitter, type Transport } from './transport';

type Frame =
  | { k: 'hello'; from: string; reply?: boolean }
  | { k: 'beat'; from: string }
  | { k: 'bye'; from: string }
  | { k: 'msg'; from: string; to?: string; data: string };

const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 4000;

export function broadcastTransport(room: string): Transport {
  const selfId = `tab-${Math.random().toString(36).slice(2, 10)}`;
  const ch = new BroadcastChannel(`colossus-room-${room}`);
  const messages = new Emitter<[string, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  const lastSeen = new Map<string, number>();
  const post = (f: Frame) => ch.postMessage(f);

  const seen = (id: string) => {
    const known = lastSeen.has(id);
    lastSeen.set(id, Date.now());
    if (!known) joins.emit(id);
    return known;
  };

  ch.onmessage = (e: MessageEvent<Frame>) => {
    const f = e.data;
    if (f.from === selfId) return;
    switch (f.k) {
      case 'hello':
        seen(f.from);
        if (!f.reply) post({ k: 'hello', from: selfId, reply: true });
        break;
      case 'beat':
        seen(f.from);
        break;
      case 'bye':
        if (lastSeen.delete(f.from)) leaves.emit(f.from);
        break;
      case 'msg':
        if (f.to && f.to !== selfId) return;
        seen(f.from);
        messages.emit(f.data, f.from);
        break;
    }
  };

  const beat = setInterval(() => {
    post({ k: 'beat', from: selfId });
    const now = Date.now();
    for (const [id, t] of lastSeen) {
      if (now - t > TIMEOUT_MS) {
        lastSeen.delete(id);
        leaves.emit(id);
      }
    }
  }, HEARTBEAT_MS);
  const bye = () => post({ k: 'bye', from: selfId });
  window.addEventListener('pagehide', bye);
  // Let callers attach listeners before the first hello goes out.
  setTimeout(() => post({ k: 'hello', from: selfId }), 0);

  return {
    selfId,
    label: 'Local tabs (BroadcastChannel)',
    send(data, to) {
      post({ k: 'msg', from: selfId, to, data });
    },
    onMessage: (fn) => messages.on(fn),
    onPeerJoin: (fn) => joins.on(fn),
    onPeerLeave: (fn) => leaves.on(fn),
    leave() {
      bye();
      clearInterval(beat);
      window.removeEventListener('pagehide', bye);
      messages.clear();
      joins.clear();
      leaves.clear();
      ch.close();
    },
  };
}
