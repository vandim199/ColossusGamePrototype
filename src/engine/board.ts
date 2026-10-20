// Game-specific geometry on top of hex.ts: the 7-hex Colossus, its rings,
// telegraph patterns, Hunter reachability, knockback and the Charge path.

import { hunterDef } from './cards';
import {
  ALL_HEXES,
  DIRS,
  add,
  bearing,
  distance,
  inBoard,
  key,
  neighbors,
  parse,
  ring,
  scale,
  toPixel,
  type Dir,
  type HexKey,
} from './hex';
import type { GameState, HunterState, NodeId } from './types';

export const CUBE_BUDGET = 30;

// ---------------------------------------------------------------- Colossus body

export function bodyHexes(center: HexKey): HexKey[] {
  const c = parse(center);
  return [center, ...DIRS.map((d) => key(add(c, d)))];
}

export function bodySet(s: GameState): Set<HexKey> {
  return new Set(bodyHexes(s.colossus.center));
}

/** Distance from a hex to the nearest Colossus hex (0 = on the body, 1 = adjacent). */
export function distToBody(center: HexKey, h: HexKey): number {
  return Math.max(0, distance(parse(center), parse(h)) - 1);
}

/** Ground hexes at a given distance from the body (1 = adjacent ring), on the board. */
export function bodyRing(center: HexKey, d: number): HexKey[] {
  return ring(parse(center), d + 1).filter(inBoard).map(key);
}

export const isAdjacentToColossus = (s: GameState, h: HexKey) => distToBody(s.colossus.center, h) === 1;

// ---------------------------------------------------------------- telegraphs

/** Tri-Cone: three rays (dir-1, dir, dir+1), each 3 hexes, starting next to the body. */
export function triConeHexes(center: HexKey, dir: Dir): HexKey[] {
  const c = parse(center);
  const out: HexKey[] = [];
  for (const d of [dir + 5, dir, dir + 1]) {
    const v = DIRS[d % 6];
    for (let k = 2; k <= 4; k++) out.push(key(add(c, scale(v, k))));
  }
  return out.filter((k) => inBoard(parse(k)));
}

/** Line Burst: one straight 5-hex line starting next to the body. */
export function lineBurstHexes(center: HexKey, dir: Dir): HexKey[] {
  const c = parse(center);
  const out: HexKey[] = [];
  for (let k = 2; k <= 6; k++) out.push(key(add(c, scale(DIRS[dir], k))));
  return out.filter((k) => inBoard(parse(k)));
}

/** Ring Slam: every hex at distance 2 from the Colossus body. */
export const ringSlamHexes = (center: HexKey): HexKey[] => bodyRing(center, 2);

/** Tail Sweep: the adjacent ring hexes at 90 degrees or more from the facing (7 of 12). */
export function tailSweepHexes(center: HexKey, facing: Dir): HexKey[] {
  const c = parse(center);
  const f = toPixel(DIRS[facing]);
  return ring(c, 2)
    .filter((h) => {
      const p = toPixel(h);
      const o = toPixel(c);
      return (p.x - o.x) * f.x + (p.y - o.y) * f.y <= 1e-6;
    })
    .filter(inBoard)
    .map(key);
}

// ---------------------------------------------------------------- occupancy

export function hunterAt(s: GameState, h: HexKey, except?: number): HunterState | undefined {
  return s.hunters.find((x) => x.seat !== except && !x.exhausted && x.pos === h);
}

export function isFree(s: GameState, h: HexKey, except?: number): boolean {
  return inBoard(parse(h)) && !bodySet(s).has(h) && !hunterAt(s, h, except);
}

// ---------------------------------------------------------------- Hunter movement

/** Hexes a movement card can reach from `from` (always includes `from` itself: a 0-hex move). */
export function reachable(s: GameState, cardId: string, from: HexKey): Set<HexKey> {
  const def = hunterDef(cardId);
  const out = new Set<HexKey>([from]);
  if (!def.move) return out;
  const body = bodySet(s);
  const center = s.colossus.center;
  if (def.move.kind === 'vault') {
    if (distToBody(center, from) <= 2) for (const h of bodyRing(center, 1)) out.add(h);
    return out;
  }
  if (def.move.kind === 'grapple') {
    const f = parse(from);
    for (const h of ALL_HEXES) if (!body.has(h) && distance(f, parse(h)) <= def.move.range) out.add(h);
    return out;
  }
  // Walk: BFS around the body. Allies never block passage (they only block the final hex).
  let frontier = [from];
  for (let step = 0; step < def.move.range; step++) {
    const next: HexKey[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        if (out.has(n) || body.has(n) || !inBoard(parse(n))) continue;
        out.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Where a Hunter actually ends a move: the chosen hex if it is reachable and free,
 * otherwise the free reachable hex closest to it (ties: closer to the start, then board order).
 */
export function resolveMoveDest(s: GameState, seat: number, cardId: string, from: HexKey, dest: HexKey | undefined): HexKey {
  if (!dest) return from;
  const reach = reachable(s, cardId, from);
  if (reach.has(dest) && isFree(s, dest, seat)) return dest;
  let best = from;
  let bestScore = [dist2(from, dest), 0, -1];
  for (const h of ALL_HEXES) {
    if (!reach.has(h) || !isFree(s, h, seat)) continue;
    const score = [dist2(h, dest), dist2(h, from), ALL_HEXES.indexOf(h)];
    if (lexLess(score, bestScore)) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

const dist2 = (a: HexKey, b: HexKey) => distance(parse(a), parse(b));
function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Push a Hunter `n` hexes directly away from the Colossus. Stops at edges, bodies and other figures. */
export function pushAway(s: GameState, h: HunterState, n: number): number {
  let moved = 0;
  const c = toPixel(parse(s.colossus.center));
  for (let i = 0; i < n && h.pos; i++) {
    const cur = h.pos;
    const curD = dist2(cur, s.colossus.center);
    let best: HexKey | null = null;
    let bestFar = -Infinity;
    for (const nb of neighbors(cur)) {
      if (!isFree(s, nb, h.seat) || dist2(nb, s.colossus.center) <= curD) continue;
      const p = toPixel(parse(nb));
      const far = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
      if (far > bestFar + 1e-9) {
        bestFar = far;
        best = nb;
      }
    }
    if (!best) break;
    h.pos = best;
    moved++;
  }
  return moved;
}

/** Pull a Hunter up to `n` hexes toward `toward`, stopping once adjacent. */
export function pullToward(s: GameState, h: HunterState, toward: HexKey, n: number): number {
  let moved = 0;
  for (let i = 0; i < n && h.pos; i++) {
    const curD = dist2(h.pos, toward);
    if (curD <= 1) break;
    let best: HexKey | null = null;
    let bestD = curD;
    for (const nb of neighbors(h.pos)) {
      if (!isFree(s, nb, h.seat)) continue;
      const d = dist2(nb, toward);
      if (d < bestD) {
        bestD = d;
        best = nb;
      }
    }
    if (!best) break;
    h.pos = best;
    moved++;
  }
  return moved;
}

/** Nearest free ground hex to `from` that is not in `forbidden` (BFS, deterministic). */
export function nearestFree(s: GameState, from: HexKey, forbidden: Set<HexKey>, seat?: number): HexKey | null {
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: HexKey[] = [];
    for (const h of frontier) {
      if (!forbidden.has(h) && isFree(s, h, seat)) return h;
      for (const n of neighbors(h)) {
        if (seen.has(n) || !inBoard(parse(n))) continue;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------- Charge Forward

/** Centre positions the Colossus passes through when surging to the board edge. */
export function chargePath(center: HexKey, dir: Dir): HexKey[] {
  const path: HexKey[] = [];
  let c = parse(center);
  for (;;) {
    const n = add(c, DIRS[dir]);
    if (!bodyHexes(key(n)).every((h) => inBoard(parse(h)))) break;
    path.push(key(n));
    c = n;
  }
  return path;
}

/** Every ground hex the body sweeps through during a charge (excluding where it started). */
export function chargeSweep(center: HexKey, dir: Dir): HexKey[] {
  const start = new Set(bodyHexes(center));
  const swept = new Set<HexKey>();
  for (const c of chargePath(center, dir)) for (const h of bodyHexes(c)) if (!start.has(h)) swept.add(h);
  return [...swept];
}

/** Facing that points from the Colossus toward a hex. */
export const facingToward = (center: HexKey, h: HexKey): Dir => bearing(parse(center), parse(h));

// ---------------------------------------------------------------- body board

export const NODES: readonly NodeId[] = ['L1', 'L2', 'B1', 'B2', 'H1', 'H2'];
export const LEGS: readonly NodeId[] = ['L1', 'L2'];
export const NODE_POINTS: Record<NodeId, number> = { L1: 0, L2: 0, B1: 1, B2: 1, H1: 2, H2: 2 };
export const NODE_NAMES: Record<NodeId, string> = {
  L1: 'Left Leg',
  L2: 'Right Leg',
  B1: 'Left Back',
  B2: 'Right Back',
  H1: 'Left Head',
  H2: 'Right Head',
};
/** A ladder: each node links to its tier partner and the node above/below it. */
export const NODE_LINKS: Record<NodeId, NodeId[]> = {
  L1: ['L2', 'B1'],
  L2: ['L1', 'B2'],
  B1: ['B2', 'L1', 'H1'],
  B2: ['B1', 'L2', 'H2'],
  H1: ['H2', 'B1'],
  H2: ['H1', 'B2'],
};
export const isNodeId = (x: unknown): x is NodeId => typeof x === 'string' && (NODES as readonly string[]).includes(x);
