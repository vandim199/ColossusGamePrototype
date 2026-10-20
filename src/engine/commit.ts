// Commit-reveal for the Colossus's hidden cards. At lock time only the hash
// (plus the face-up parts: new Red Cubes, and the Enraged face-up card) is
// shared; at the reveal step the plays and salt are opened and every peer
// re-hashes them.

import { cubesForPlays } from './rules';
import { canonicalJson, sha256Hex } from './sha256';
import type { Action, BossPlay, GameState } from './types';

export const commitmentInput = (plays: BossPlay[], salt: string) => `${canonicalJson(plays)}:${salt}`;
export const makeCommitment = (plays: BossPlay[], salt: string) => sha256Hex(commitmentInput(plays, salt));
export const verifyCommitment = (commitment: string, plays: BossPlay[], salt: string) =>
  makeCommitment(plays, salt) === commitment;

/** 128-bit random salt. Uses WebCrypto when present; `fallback` lets the headless simulator stay deterministic. */
export function randomSalt(fallback?: () => number): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!fallback && c?.getRandomValues) c.getRandomValues(bytes);
  else {
    const r = fallback ?? Math.random;
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(r() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BossCommitment {
  lock: Extract<Action, { type: 'LockBossCards' }>;
  reveal: Extract<Action, { type: 'RevealBossCards' }>;
}

/** Build the matching lock and reveal actions for a set of plays. */
export function makeBossCommitment(s: GameState, plays: BossPlay[], salt: string, faceUpIndex = 0): BossCommitment {
  return {
    lock: {
      type: 'LockBossCards',
      seat: 0,
      commitment: makeCommitment(plays, salt),
      cardCount: plays.length,
      cubes: cubesForPlays(s, plays),
      faceUp: s.colossus.enraged ? plays[Math.min(faceUpIndex, plays.length - 1)] : null,
    },
    reveal: { type: 'RevealBossCards', seat: 0, plays, salt },
  };
}
