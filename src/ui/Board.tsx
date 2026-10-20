import { useMemo } from 'react';
import {
  ALL_HEXES,
  DIRS,
  bodyHexes,
  bodyRing,
  cardType,
  chargeSweep,
  hexLabel,
  parse,
  tailSweepHexes,
  toPixel,
  type GameState,
  type HexKey,
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
  for (const [k, p] of pts) pts.set(k, { x: p.x - minX + PAD, y: p.y - minY + PAD });
  return { pts, width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 };
})();

/** Pixel position of any hex, on or off the board. */
export function hexPixel(k: HexKey): { x: number; y: number } {
  const known = layout.pts.get(k);
  if (known) return known;
  const ref = layout.pts.get(ALL_HEXES[0])!;
  const a = toPixel(parse(ALL_HEXES[0]), SIZE);
  const b = toPixel(parse(k), SIZE);
  return { x: ref.x + b.x - a.x, y: ref.y + b.y - a.y };
}

function corners(cx: number, cy: number, r = SIZE): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return out.join(' ');
}

export interface BoardProps {
  state: GameState;
  you: number | 'spectator';
  selectable?: Set<HexKey>;
  onPick?: (hex: HexKey) => void;
  previewCubes?: HexKey[];
  /** Planned or animated movement arrows. */
  arrows?: { from: HexKey; to: HexKey; color: string; dashed?: boolean }[];
  /** Hexes to pulse (reveal step, aimed Quick Attacks). */
  focus?: HexKey[];
  /** Colossus's own aimed Quick Attacks (shown only to the Colossus while locking). */
  aims?: HexKey[];
}

export function Board({ state, you, selectable, onPick, previewCubes, arrows, focus, aims }: BoardProps) {
  const body = useMemo(() => new Set(bodyHexes(state.colossus.center)), [state.colossus.center]);
  const ring = useMemo(() => new Set(bodyRing(state.colossus.center, 1)), [state.colossus.center]);
  const chargeZone = useMemo(() => {
    const out = new Set<HexKey>();
    for (const p of state.pendingCharged) {
      const hexes =
        cardType(p.card) === 'chargeForward' && p.dir !== undefined
          ? chargeSweep(state.colossus.center, p.dir)
          : tailSweepHexes(state.colossus.center, state.colossus.facing);
      hexes.forEach((h) => out.add(h));
    }
    return out;
  }, [state.pendingCharged, state.colossus.center, state.colossus.facing]);

  const c = layout.pts.get(state.colossus.center) ?? hexPixel(state.colossus.center);
  const facing = toPixel(DIRS[state.colossus.facing], SIZE);
  const tumbled = !!state.tumble;

  return (
    <svg viewBox={`0 0 ${layout.width.toFixed(0)} ${layout.height.toFixed(0)}`} width={layout.width} role="img" aria-label="Arena">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(245,158,11,0.12)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(245,158,11,0.7)" strokeWidth="3" />
        </pattern>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
        <radialGradient id="colossusFill">
          <stop offset="0%" stopColor="#9a8670" />
          <stop offset="100%" stopColor="#4a3f35" />
        </radialGradient>
      </defs>

      {ALL_HEXES.map((k) => {
        const p = layout.pts.get(k)!;
        const pick = selectable?.has(k);
        return (
          <polygon
            key={k}
            points={corners(p.x, p.y, SIZE - 1)}
            className={`hex${ring.has(k) ? ' adj' : ''}${pick ? ' pick' : ''}`}
            onClick={pick && onPick ? () => onPick(k) : undefined}
          >
            <title>{hexLabel(k)}</title>
          </polygon>
        );
      })}
      {ALL_HEXES.map((k) => {
        const p = layout.pts.get(k)!;
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
              <rect x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} fill={now ? '#ffd6d6' : '#e5383b'} opacity={0.9} />
            </g>
          );
        }),
      )}

      {previewCubes?.map((k) => {
        const p = hexPixel(k);
        return <polygon key={`pc${k}`} points={corners(p.x, p.y, SIZE - 6)} className="cube-preview" pointerEvents="none" />;
      })}

      {[...body].map((k) => {
        const p = hexPixel(k);
        return <polygon key={`b${k}`} points={corners(p.x, p.y, SIZE)} fill="url(#colossusFill)" stroke="#2a221c" strokeWidth={1.5} opacity={tumbled ? 0.6 : 1} />;
      })}
      <g pointerEvents="none" transform={tumbled ? `rotate(${state.tumble?.kind === 'long' ? 90 : 25} ${c.x} ${c.y})` : undefined}>
        <circle cx={c.x} cy={c.y} r={SIZE * 1.15} fill="#5e5044" stroke="#c9b79c" strokeWidth={2} />
        <text x={c.x} y={c.y - 2} textAnchor="middle" fontFamily="Georgia, serif" fontSize={13} fill="#f3e6d2" fontWeight={700}>
          COLOSSUS
        </text>
        <text x={c.x} y={c.y + 13} textAnchor="middle" fontSize={11} fill="#f0b44c">
          {tumbled ? (state.tumble!.kind === 'long' ? 'LONG TUMBLE' : 'TUMBLED') : `Armor ${state.colossus.armor}`}
        </text>
      </g>
      {!tumbled && (
        <polygon
          points={`${c.x + facing.x * 1.55},${c.y + facing.y * 1.55} ${c.x + facing.x * 1.2 - facing.y * 0.35},${c.y + facing.y * 1.2 + facing.x * 0.35} ${c.x + facing.x * 1.2 + facing.y * 0.35},${c.y + facing.y * 1.2 - facing.x * 0.35}`}
          fill="#f0b44c"
          pointerEvents="none"
        >
          <title>Facing</title>
        </polygon>
      )}

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
            <circle cx={p.x} cy={p.y} r={SIZE * 0.7} fill="none" stroke="#ff9a9c" strokeWidth={2} strokeDasharray="4 3" />
            <line x1={p.x - 8} y1={p.y} x2={p.x + 8} y2={p.y} stroke="#ff9a9c" strokeWidth={2} />
            <line x1={p.x} y1={p.y - 8} x2={p.x} y2={p.y + 8} stroke="#ff9a9c" strokeWidth={2} />
          </g>
        );
      })}

      {state.hunters.map((h) => {
        if (!h.pos || h.exhausted) return null;
        const p = hexPixel(h.pos);
        const role = h.cls;
        const low = h.hp <= 4;
        return (
          <g key={`h${h.seat}`} pointerEvents="none" opacity={h.down ? 0.55 : 1}>
            {h.shield > 0 && <circle cx={p.x} cy={p.y} r={SIZE * 0.78} fill="none" stroke="var(--info)" strokeWidth={3} />}
            <circle
              cx={p.x}
              cy={p.y}
              r={SIZE * 0.62}
              fill={h.down ? '#555' : ROLE_COLOR[role]}
              stroke={h.exposed ? 'var(--danger)' : h.seat === you ? '#fff' : '#0f1218'}
              strokeWidth={h.exposed || h.seat === you ? 3 : 1.5}
            />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" className="token-label">
              {h.down ? '✕' : ROLE_LETTER[role]}
            </text>
            <rect x={p.x - 13} y={p.y + SIZE * 0.5} width={26} height={11} rx={3} fill={low ? '#7a1d1f' : '#0f1218'} opacity={0.9} />
            <text x={p.x} y={p.y + SIZE * 0.5 + 8.5} textAnchor="middle" className="hp-label">
              {h.hp} HP
            </text>
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
