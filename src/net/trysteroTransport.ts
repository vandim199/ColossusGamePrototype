// WebRTC data channels between browsers; signaling goes through public Nostr
// relays (Trystero's default strategy), so no server of our own is needed.

import { joinRoom, selfId } from 'trystero';
import { Emitter, type Transport } from './transport';

const APP_ID = 'colossus-mind-game-prototype-v1';

export function trysteroTransport(room: string): Transport {
  const r = joinRoom({ appId: APP_ID }, `room-${room}`);
  const msg = r.makeAction<string>('msg');
  const messages = new Emitter<[string, string]>();
  const joins = new Emitter<[string]>();
  const leaves = new Emitter<[string]>();
  msg.onMessage = (data, ctx) => messages.emit(data, ctx.peerId);
  r.onPeerJoin = (id) => joins.emit(id);
  r.onPeerLeave = (id) => leaves.emit(id);
  return {
    selfId,
    label: 'WebRTC (Trystero, Nostr relays)',
    send(data, to) {
      void msg.send(data, to ? { target: to } : undefined).catch(() => undefined);
    },
    onMessage: (fn) => messages.on(fn),
    onPeerJoin: (fn) => joins.on(fn),
    onPeerLeave: (fn) => leaves.on(fn),
    leave() {
      messages.clear();
      joins.clear();
      leaves.clear();
      void r.leave();
    },
  };
}
