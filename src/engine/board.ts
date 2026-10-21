// Game-specific geometry on top of hex.ts: the 7-hex Colossus, its rings,
// aimed attack shapes, Hunter reachability (on the ground and on the body),
// knockback, and the Colossus walking or charging toward a point.

import { hunterDef } from './cards';
import {
  ALL_HEXES,
  ALL_DIRS,
  DIRS,
  add,
  angleBetween,
  angleDiff,
  bearing,
  distance,
  fromPixel,
  inBoard,
  key,
  neighbors,
  parse,
  ring,
  toPixel,
  type Dir,
  type HexKey,
} from './hex';
import type { GameState, HunterState } from './types';

/** Damage the Colossus's core must take from climbers (in one climb) to land a Vital Strike. */
export const BURST_TARGET = 4;
/** Damage a climber takes when shaken off after a failed Burst. */
export const SHAKE_DAMAGE = 4;

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

/** Ground hexes (on the board, off the body), in reading order. */
export function groundHexes(center: HexKey): HexKey[] {
  const body = new Set(bodyHexes(center));
  return ALL_HEXES.filter((h) => !body.has(h));
}

// ---------------------------------------------------------------- aimed shapes

/** Tri-Cone: a 120-degree V (a third of the arena around the Colossus) pointing at the aim, out to the edge. */
export function coneHexes(center: HexKey, aim: HexKey): HexKey[] {
  if (aim === center) return [];
  const c = parse(center);
  const a = angleBetween(c, parse(aim));
  return groundHexes(center).filter((h) => angleDiff(angleBetween(c, parse(h)), a) <= Math.PI / 3 + 1e-6);
}

/** Line Burst: a straight line from the Colossus toward the aim, all the way to the arena edge. */
export function lineHexes(center: HexKey, aim: HexKey): HexKey[] {
  if (aim === center) return [];
  const c = parse(center);
  const from = toPixel(c);
  const to = toPixel(parse(aim));
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const body = new Set(bodyHexes(center));
  const out: HexKey[] = [];
  for (let t = 0.5; t < 40; t += 0.2) {
    const h = fromPixel(from.x + ux * t, from.y + uy * t);
    const k = key(h);
    if (body.has(k)) continue;
    if (!inBoard(h)) break;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** Ring Slam: every hex 2 or 3 away from the body. */
export const ringSlamHexes = (center: HexKey): HexKey[] => [...bodyRing(center, 2), ...bodyRing(center, 3)];

/** Quick Swipe: the chosen adjacent hex and its two neighbours along the adjacent ring. */
export function swipeHexes(center: HexKey, target: HexKey): HexKey[] {
  const adj = new Set(bodyRing(center, 1));
  return [target, ...neighbors(target).filter((n) => adj.has(n))];
}

/** Body Thrash: a body hex alone (to hit climbers), or a ground hex plus its ground neighbours. */
export function thrashHexes(center: HexKey, target: HexKey): HexKey[] {
  const body = new Set(bodyHexes(center));
  if (body.has(target)) return [target];
  return [target, ...neighbors(target).filter((n) => inBoard(parse(n)) && !body.has(n))];
}

/** Tail Sweep: the two rings around the body, back half (90 degrees or more from the facing). */
export function tailSweepHexes(center: HexKey, facing: Dir): HexKey[] {
  const c = parse(center);
  const f = toPixel(DIRS[facing]);
  const o = toPixel(c);
  return [...ring(c, 2), ...ring(c, 3)]
    .filter((h) => {
      const p = toPixel(h);
      return (p.x - o.x) * f.x + (p.y - o.y) * f.y <= 1e-6;
    })
    .filter(inBoard)
    .map(key);
}

// ---------------------------------------------------------------- Colossus movement

const fitsOnBoard = (center: HexKey) => bodyHexes(center).every((h) => inBoard(parse(h)));

/**
 * Centre positions the Colossus passes through walking toward a pixel point: each step goes to the
 * neighbouring centre closest to the point, as long as it heads within 45 degrees of the point, gets
 * closer, and keeps the whole body on the board. (So a charge stops at the edge instead of sliding along it.)
 */
function walkToward(center: HexKey, point: { x: number; y: number }, maxSteps: number): HexKey[] {
  const path: HexKey[] = [];
  let cur = center;
  const d2 = (k: HexKey) => {
    const p = toPixel(parse(k));
    return (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
  };
  for (let i = 0; i < maxSteps; i++) {
    let best: HexKey | null = null;
    const here = toPixel(parse(cur));
    const heading = Math.atan2(point.y - here.y, point.x - here.x);
    for (const d of ALL_DIRS) {
      const n = key(add(parse(cur), DIRS[d]));
      const v = toPixel(DIRS[d]);
      if (angleDiff(Math.atan2(v.y, v.x), heading) > Math.PI / 4 + 1e-6) continue;
      if (!fitsOnBoard(n) || d2(n) >= d2(cur) - 1e-9) continue;
      if (!best || d2(n) < d2(best)) best = n;
    }
    if (!best) break;
    path.push(best);
    cur = best;
  }
  return path;
}

/** Stride: up to `steps` hexes toward the aimed hex. */
export function stridePath(center: HexKey, aim: HexKey, steps = 2): HexKey[] {
  return walkToward(center, toPixel(parse(aim)), steps);
}

/** Charge Forward: straight toward the aim and beyond, until the body reaches the edge. */
export function chargePath(center: HexKey, aim: HexKey): HexKey[] {
  if (aim === center) return [];
  const a = toPixel(parse(center));
  const b = toPixel(parse(aim));
  const far = { x: a.x + (b.x - a.x) * 50, y: a.y + (b.y - a.y) * 50 };
  return walkToward(center, far, 30);
}

/** Every ground hex the body passes over along a path (excluding where it started). */
export function sweepOf(center: HexKey, path: HexKey[]): HexKey[] {
  const start = new Set(bodyHexes(center));
  const swept = new Set<HexKey>();
  for (const c of path) for (const h of bodyHexes(c)) if (!start.has(h)) swept.add(h);
  return [...swept];
}

/** Facing after moving toward a hex. */
export const facingToward = (center: HexKey, h: HexKey): Dir => bearing(parse(center), parse(h));

/** Translate a hex by the movement of the Colossus (climbers ride along). */
export function shiftBy(h: HexKey, from: HexKey, to: HexKey): HexKey {
  const a = parse(from);
  const b = parse(to);
  const p = parse(h);
  return key({ q: p.q + b.q - a.q, r: p.r + b.r - a.r });
}

// ---------------------------------------------------------------- occupancy

/** A Hunter standing on this ground hex (climbers stand on the body and do not block the ground). */
export function hunterAt(s: GameState, h: HexKey, except?: number): HunterState | undefined {
  return s.hunters.find((x) => x.seat !== except && !x.climbing && x.pos === h);
}

/** A ground hex a Hunter may end on. */
export function isFree(s: GameState, h: HexKey, except?: number): boolean {
  return inBoard(parse(h)) && !bodySet(s).has(h) && !hunterAt(s, h, except);
}

// ---------------------------------------------------------------- Hunter movement

/**
 * Hexes a movement card can reach from `from` (always includes `from`: a 0-hex move).
 * On the ground the body blocks. A climber (standing on the body) walks across body hexes
 * and may step down onto the ground.
 */
export function reachable(s: GameState, cardId: string, from: HexKey): Set<HexKey> {
  const def = hunterDef(cardId);
  const out = new Set<HexKey>([from]);
  if (!def.move) return out;
  const body = bodySet(s);
  const onBody = body.has(from);
  const center = s.colossus.center;
  if (def.move.kind === 'vault') {
    if (onBody || distToBody(center, from) <= 2) for (const h of bodyRing(center, 1)) out.add(h);
    return out;
  }
  if (def.move.kind === 'grapple') {
    const f = parse(from);
    for (const h of ALL_HEXES) if ((onBody || !body.has(h)) && distance(f, parse(h)) <= def.move.range) out.add(h);
    return out;
  }
  let frontier = [from];
  for (let step = 0; step < def.move.range; step++) {
    const next: HexKey[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        if (out.has(n) || !inBoard(parse(n))) continue;
        if (body.has(n) && !onBody) continue;
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
 * Body hexes are always free (climbers may share them).
 */
export function resolveMoveDest(s: GameState, seat: number, cardId: string, from: HexKey, dest: HexKey | undefined): HexKey {
  if (!dest) return from;
  const reach = reachable(s, cardId, from);
  const body = bodySet(s);
  const ok = (h: HexKey) => body.has(h) || isFree(s, h, seat);
  if (reach.has(dest) && ok(dest)) return dest;
  let best = from;
  let bestScore = [dist2(from, dest), 0, -1];
  for (const h of reach) {
    if (!ok(h)) continue;
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

/** Push a ground Hunter `n` hexes directly away from the Colossus. Stops at edges, the body and other figures. */
export function pushAway(s: GameState, h: HunterState, n: number): number {
  if (h.climbing) return 0;
  let moved = 0;
  const c = toPixel(parse(s.colossus.center));
  for (let i = 0; i < n; i++) {
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

/** Pull a ground Hunter up to `n` hexes toward `toward`, stopping once adjacent. */
export function pullToward(s: GameState, h: HunterState, toward: HexKey, n: number): number {
  if (h.climbing) return 0;
  let moved = 0;
  for (let i = 0; i < n; i++) {
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
export function nearestFree(s: GameState, from: HexKey, forbidden: Set<HexKey>, seat?: number): HexKey {
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
  return from;
}

/** The body hex a Hunter climbs onto: the one next to them, closest to the core on ties. */
export function mountHex(s: GameState, from: HexKey): HexKey {
  const body = bodyHexes(s.colossus.center);
  const touching = body.filter((b) => dist2(b, from) === 1);
  return touching[0] ?? body[1];
}
