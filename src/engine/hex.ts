// Hex math for the 10x10 arena. Flat-top hexes, axial coordinates (q, r),
// laid out as an "odd-q" offset rectangle (odd columns shifted down half a hex).

export interface Hex {
  q: number;
  r: number;
}

/** Serialized hex, "q,r". Used everywhere in state so it stays JSON-friendly. */
export type HexKey = string;

export type Dir = 0 | 1 | 2 | 3 | 4 | 5;

export const BOARD_COLS = 10;
export const BOARD_ROWS = 10;

/** Clockwise from north: N, NE, SE, S, SW, NW. */
export const DIRS: readonly Hex[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];
export const DIR_NAMES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;
export const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5];

export const key = (h: Hex): HexKey => `${h.q},${h.r}`;
export function parse(k: HexKey): Hex {
  const i = k.indexOf(',');
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

export const add = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });
export const scale = (a: Hex, n: number): Hex => ({ q: a.q * n, r: a.r * n });
export const neighbor = (h: Hex, d: number): Hex => add(h, DIRS[((d % 6) + 6) % 6]);

export function distance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export const dist = (a: HexKey, b: HexKey): number => distance(parse(a), parse(b));

export function toOffset(h: Hex): { col: number; row: number } {
  return { col: h.q, row: h.r + (h.q - (h.q & 1)) / 2 };
}
export function fromOffset(col: number, row: number): Hex {
  return { q: col, r: row - (col - (col & 1)) / 2 };
}

export function inBoard(h: Hex): boolean {
  const { col, row } = toOffset(h);
  return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS;
}
export const inBoardKey = (k: HexKey): boolean => inBoard(parse(k));

/** Human-readable board label: column letter A-J, row number 1-10 (e.g. "E5"). */
export function hexLabel(k: HexKey): string {
  const { col, row } = toOffset(parse(k));
  return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS ? `${'ABCDEFGHIJ'[col]}${row + 1}` : `(${k})`;
}

/** Every board hex, in offset reading order (row by row). Deterministic. */
export const ALL_HEXES: readonly HexKey[] = (() => {
  const out: HexKey[] = [];
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) out.push(key(fromOffset(col, row)));
  }
  return out;
})();

/** Pixel centre of a hex for a flat-top layout with unit size. */
export function toPixel(h: Hex, size = 1): { x: number; y: number } {
  return { x: size * 1.5 * h.q, y: size * Math.sqrt(3) * (h.r + h.q / 2) };
}

/** Nearest hex to a pixel position (inverse of toPixel, cube rounding). */
export function fromPixel(x: number, y: number, size = 1): Hex {
  const qf = ((2 / 3) * x) / size;
  const rf = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Angle in radians of the line from one hex to another (screen coordinates, y down). */
export function angleBetween(from: Hex, to: Hex): number {
  const a = toPixel(from);
  const b = toPixel(to);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Smallest absolute difference between two angles. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Hexes at exactly distance `radius` from `center`, clockwise, starting at the N corner. */
export function ring(center: Hex, radius: number): Hex[] {
  if (radius === 0) return [center];
  const out: Hex[] = [];
  let h = add(center, scale(DIRS[0], radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(h);
      h = neighbor(h, side + 2);
    }
  }
  return out;
}

export function neighbors(k: HexKey): HexKey[] {
  const h = parse(k);
  return DIRS.map((d) => key(add(h, d)));
}

/** Direction index whose vector points most closely from `from` toward `to`. */
export function bearing(from: Hex, to: Hex): Dir {
  const a = toPixel(from);
  const b = toPixel(to);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  let best: Dir = 0;
  let bestDot = -Infinity;
  for (const d of ALL_DIRS) {
    const v = toPixel(DIRS[d]);
    const dot = Math.cos(ang) * v.x + Math.sin(ang) * v.y;
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = d;
    }
  }
  return best;
}
