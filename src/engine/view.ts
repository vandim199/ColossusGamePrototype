// Per-seat projection of the state. A client only ever receives its own view.
//
// Hidden from everyone: the RNG state and the Rage deck order.
// Hidden from Hunters and spectators: the Colossus hand (it only has a count).
// Hidden from the Colossus and spectators: Hunter commits before the reveal
// (Hunters see each other's, matching the open table talk).
// Hunter hands stay public: they are deducible from the face-up discards.

import type { GameState } from './types';

export type Viewer = number | 'spectator';

export const HIDDEN_CARD = 'hidden';

export function projectView(s: GameState, viewer: Viewer): GameState {
  const v = structuredClone(s);
  v.rng = 0;
  v.ragePile = v.ragePile.map(() => HIDDEN_CARD);
  if (viewer !== 0) v.colossus.hand = v.colossus.hand.map(() => HIDDEN_CARD);
  const hunterViewer = typeof viewer === 'number' && viewer >= 1;
  if (!hunterViewer) v.commits = v.commits.map((c) => (c ? { kind: 'hidden' } : null));
  // Replay snapshots are only needed for the latest reveal; drop the rest to keep messages small.
  for (const e of v.log) if (e.round < s.round - 1) delete e.snap;
  return v;
}
