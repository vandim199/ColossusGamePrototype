import type { Difficulty } from '../bots';
import type { Action, HunterClass, Mode } from '../engine';
import type { ClientView, SeatInfo, TimerSetting } from '../host/types';
import type { TransportKind } from './transport';

export type Occupant = { kind: 'human'; clientId: string } | { kind: 'bot'; difficulty: Difficulty } | { kind: 'empty' };

export interface LobbySeat {
  seat: number;
  role: SeatInfo['role'];
  occupant: Occupant;
}

export interface LobbyPlayer {
  clientId: string;
  name: string;
  connected: boolean;
}

export interface LobbyState {
  code: string;
  transport: TransportKind;
  mode: Mode;
  /** The class left out in 1v3. */
  benched: HunterClass;
  timer: TimerSetting;
  botDifficulty: Difficulty;
  seats: LobbySeat[];
  players: LobbyPlayer[];
  hostClientId: string;
  started: boolean;
  /** In a running game: seats whose human left. A bot covers them until someone reclaims the seat. */
  dropped: number[];
}

export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'claim'; seat: number }
  | { t: 'release' }
  | { t: 'action'; action: Action; seq: number }
  | { t: 'beat' }
  | { t: 'bye' };

export type HostMsg =
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'view'; view: ClientView }
  | { t: 'ack'; seq: number; ok: boolean; error?: string }
  | { t: 'beat' }
  | { t: 'bye' };

/** Both sides send a heartbeat; silence this long counts as a drop (WebRTC can take far longer to notice). Both recover if messages resume. */
export const HEARTBEAT_MS = 3000;
export const SILENCE_MS = 15_000;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

/** A per-tab identity for this room. Survives a reload of the same tab, so a dropped player reclaims their seat. */
export function clientIdFor(code: string): string {
  const k = `colossus:client:${code}`;
  try {
    const existing = sessionStorage.getItem(k);
    if (existing) return existing;
    const id = `c-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(k, id);
    return id;
  } catch {
    return `c-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function roomLink(code: string, transport: TransportKind): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#room=${code}${transport === 'local' ? '&net=local' : ''}`;
}

export function parse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
