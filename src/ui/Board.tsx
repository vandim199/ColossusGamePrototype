import { useMemo } from 'react';
import {
  ALL_HEXES,
  DIRS,
  bodyHexes,
  bodyRing,
  chargedZone,
  hexLabel,
  parse,
  toPixel,
  type GameState,
  type HexKey,
  type Snapshot,
} from '../engine';
import { ROLE_COLOR, ROLE_LETTER } from './theme';

const SIZE = 30;
const PAD = SIZE + 6;

const layout = (() => {
  const pts = new Map<HexKey, { x: number; y: number }>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of ALL_HEXES) {
    const p = toPixel(parse(k), SIZE);
    pts.set(k, p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 };
})();

/** Pixel position of any hex, on or off the board. */
export function hexPixel(k: HexKey): { x: number; y: number } {
  const p = toPixel(parse(k), SIZE);
  return { x: p.x - layout.minX + PAD, y: p.y - layout.minY + PAD };
}

function corners(cx: number, cy: number, r = SIZE): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return out.join(' ');
}

const BODY_OFFSETS = [{ x: 0, y: 0 }, ...DIRS.map((d) => toPixel(d, SIZE))];

export interface ShakeCue {
  /** Changes every time a new hit lands, so the animation replays. */
  key: number;
  seats: number[];
  boss: boolean;
}

export interface BoardProps {
  state: GameState;
  you: number | 'spectator';
  selectable?: Set<HexKey>;
  onPick?: (hex: HexKey) => void;
  onHover?: (hex: HexKey | null) => void;
  previewCubes?: HexKey[];
  /** Planned or animated movement arrows. */
  arrows?: { from: HexKey; to: HexKey; color: string; dashed?: boolean }[];
  /** Hexes to pulse (reveal step). */
  focus?: HexKey[];
  /** The Colossus's own aimed attacks (shown only to the Colossus while locking). */
  aims?: HexKey[];
  /** Positions to show instead of the live state (step-by-step reveal replay). */
  snap?: Snapshot;
  shake?: ShakeCue;
}

export function Board({ state, you, selectable, onPick, onHover, previewCubes, arrows, focus, aims, snap, shake }: BoardProps) {
  const center = snap?.center ?? state.colossus.center;
  const body = useMemo(() => new Set(bodyHexes(center)), [center]);
  const ring = useMemo(() => new Set(bodyRing(center, 1)), [center]);
  const chargeZone = useMemo(() => new Set(state.pendingCharged.flatMap((p) => chargedZone(state, p))), [state]);

  const c = hexPixel(center);
  const facing = toPixel(DIRS[state.colossus.facing], SIZE);
  const tumbled = !!state.tumble;
  const positions = state.hunters.map((h, i) => snap?.pos[i] ?? h.pos);
  const downs = state.hunters.map((h, i) => snap?.down[i] ?? h.down);

  // Climbers sharing a body hex fan out a little so every token stays visible.
  const stackIndex = new Map<number, { i: number; n: number }>();
  const groups = new Map<HexKey, number[]>();
  positions.forEach((p, i) => groups.set(p, [...(groups.get(p) ?? []), i]));
  for (const ids of groups.values()) ids.forEach((id, i) => stackIndex.set(id, { i, n: ids.length }));

  const pick = (k: HexKey) => (selectable?.has(k) && onPick ? () => onPick(k) : undefined);
  const hover = (k: HexKey | null) => (onHover ? () => onHover(k) : undefined);

  return (
    <svg viewBox={`0 0 ${layout.width.toFixed(0)} ${layout.height.toFixed(0)}`} width={layout.width} role="img" aria-label="Arena" onMouseLeave={hover(null)}>
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(194,116,27,0.12)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(194,116,27,0.65)" strokeWidth="3" />
        </pattern>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
        <radialGradient id="colossusFill">
          <stop offset="0%" stopColor="#9b7a55" />
          <stop offset="100%" stopColor="#5a3d26" />
        </radialGradient>
        <radialGradient id="coreFill">
          <stop offset="0%" stopColor="#e9b04a" />
          <stop offset="100%" stopColor="#9a4f1e" />
        </radialGradient>
      </defs>

      {ALL_HEXES.map((k) => {
        const p = hexPixel(k);
        const canPick = selectable?.has(k) && !body.has(k);
        return (
          <polygon
            key={k}
            points={corners(p.x, p.y, SIZE - 1)}
            className={`hex${ring.has(k) ? ' adj' : ''}${canPick ? ' pick' : ''}`}
            onClick={canPick ? pick(k) : undefined}
            onMouseEnter={hover(k)}
          >
            <title>{hexLabel(k)}</title>
          </polygon>
        );
      })}
      {ALL_HEXES.map((k) => {
        const p = hexPixel(k);
        return (
          <text key={`l${k}`} x={p.x} y={p.y - SIZE * 0.55} textAnchor="middle" className="coord">
            {hexLabel(k)}
          </text>
        );
      })}

      {[...chargeZone].map((k) => {
        const p = hexPixel(k);
        return <polygon key={`cz${k}`} points={corners(p.x, p.y, SIZE - 3)} className="charge-zone" pointerEvents="none" />;
      })}

      {state.cubes.map((w) =>
        w.hexes.map((k) => {
          const p = hexPixel(k);
          const now = w.round < state.round;
          return (
            <g key={`cube${w.round}-${k}`} pointerEvents="none">
              <polygon points={corners(p.x, p.y, SIZE - 4)} className={now ? 'cube-now' : 'cube-next'} />
              <rect x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} fill={now ? '#fbe2dc' : '#a3302a'} opacity={0.9} />
            </g>
          );
        }),
      )}

      {[...new Set(previewCubes ?? [])].map((k) => {
        const p = hexPixel(k);
        return <polygon key={`pc${k}`} points={corners(p.x, p.y, SIZE - 6)} className="cube-preview" pointerEvents="none" />;
      })}

      {/* The Colossus glides as one piece; its core is the central hex. */}
      <g className="mover" style={{ transform: `translate(${c.x}px, ${c.y}px)` }}>
        <g key={shake?.boss ? `boss-shake-${shake.key}` : 'boss'} className={shake?.boss ? 'shake-big' : undefined}>
          {BODY_OFFSETS.map((o, i) => (
            <polygon key={i} points={corners(o.x, o.y, SIZE)} fill={i === 0 ? 'url(#coreFill)' : 'url(#colossusFill)'} stroke="#2e1e11" strokeWidth={1.5} opacity={tumbled ? 0.75 : 1} />
          ))}
          <g transform={tumbled ? `rotate(${state.tumble?.kind === 'long' ? 90 : 25})` : undefined} pointerEvents="none">
            <text x={0} y={-SIZE * 1.95} textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize={12} fill="#5a3d26" fontWeight={700} stroke="#f5ebd3" strokeWidth={3} paintOrder="stroke">
              COLOSSUS
            </text>
            <text x={0} y={4} textAnchor="middle" fontSize={10} fill="#3b1e0c" fontWeight={700} fontFamily="Cinzel, Georgia, serif">
              CORE
            </text>
            <text x={0} y={SIZE * 2.15} textAnchor="middle" fontSize={11} fill="#5a3d26" fontWeight={700} stroke="#f5ebd3" strokeWidth={3} paintOrder="stroke">
              {tumbled ? (state.tumble!.kind === 'long' ? 'LONG TUMBLE' : 'TUMBLED') : `Armor ${state.colossus.armor}`}
            </text>
          </g>
          {!tumbled && (
            <polygon
              points={`${facing.x * 1.85},${facing.y * 1.85} ${facing.x * 1.5 - facing.y * 0.3},${facing.y * 1.5 + facing.x * 0.3} ${facing.x * 1.5 + facing.y * 0.3},${facing.y * 1.5 - facing.x * 0.3}`}
              fill="#2f6b3a"
              pointerEvents="none"
            />
          )}
        </g>
      </g>

      {/* Body hexes you can click (climbing moves, Body Thrash on climbers). */}
      {[...body].filter((k) => selectable?.has(k)).map((k) => {
        const p = hexPixel(k);
        return <polygon key={`bp${k}`} points={corners(p.x, p.y, SIZE - 3)} className="body-pick" onClick={pick(k)} onMouseEnter={hover(k)} />;
      })}

      {arrows?.map((a, i) => {
        const p = hexPixel(a.from);
        const q = hexPixel(a.to);
        return (
          <line
            key={`ar${i}`}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            stroke={a.color}
            strokeWidth={3}
            strokeDasharray={a.dashed ? '5 4' : undefined}
            markerEnd="url(#arrowhead)"
            opacity={0.85}
            pointerEvents="none"
          />
        );
      })}

      {aims?.map((k, i) => {
        const p = hexPixel(k);
        return (
          <g key={`aim${i}${k}`} pointerEvents="none">
            <circle cx={p.x} cy={p.y} r={SIZE * 0.7} fill="none" stroke="#a3302a" strokeWidth={2} strokeDasharray="4 3" />
            <line x1={p.x - 8} y1={p.y} x2={p.x + 8} y2={p.y} stroke="#a3302a" strokeWidth={2} />
            <line x1={p.x} y1={p.y - 8} x2={p.x} y2={p.y + 8} stroke="#a3302a" strokeWidth={2} />
          </g>
        );
      })}

      {state.hunters.map((h, i) => {
        const pos = positions[i];
        const climbing = body.has(pos);
        const st = stackIndex.get(i)!;
        const spread = st.n > 1 ? { x: Math.cos((2 * Math.PI * st.i) / st.n) * 10, y: Math.sin((2 * Math.PI * st.i) / st.n) * 10 } : { x: 0, y: 0 };
        const p = hexPixel(pos);
        const down = downs[i];
        const r = climbing ? SIZE * 0.48 : SIZE * 0.6;
        const shaking = shake?.seats.includes(h.seat);
        return (
          <g key={`h${h.seat}`} className="mover" style={{ transform: `translate(${p.x + spread.x}px, ${p.y + spread.y}px)` }} pointerEvents="none" opacity={down ? 0.55 : 1}>
            <g key={shaking ? `s${shake!.key}` : 'still'} className={shaking ? 'shake' : undefined}>
              {shaking && <circle r={r + 6} fill="#a3302a" className="hurt-flash" />}
              {h.shield > 0 && <circle r={r + 4} fill="none" stroke="var(--info)" strokeWidth={3} />}
              {climbing && <circle r={r + 3} fill="none" stroke="#7fb36a" strokeWidth={2.5} />}
              <circle
                r={r}
                fill={down ? '#8a7a66' : ROLE_COLOR[h.cls]}
                stroke={h.exposed ? 'var(--danger)' : h.seat === you ? '#fff8e8' : '#2e1e11'}
                strokeWidth={h.exposed || h.seat === you ? 3 : 1.5}
              />
              <text x={0} y={4.5} textAnchor="middle" className="token-label">
                {down ? '✕' : ROLE_LETTER[h.cls]}
              </text>
              <rect x={-13} y={r - 2} width={26} height={11} rx={3} fill={h.hp <= 4 ? '#7a1d1f' : '#3b2a18'} opacity={0.9} />
              <text x={0} y={r + 6.5} textAnchor="middle" className="hp-label">
                {h.hp} HP
              </text>
            </g>
          </g>
        );
      })}

      {focus?.map((k, i) => {
        const p = hexPixel(k);
        return <polygon key={`f${i}${k}`} points={corners(p.x, p.y, SIZE - 2)} className="focus-ring" />;
      })}
    </svg>
  );
}
