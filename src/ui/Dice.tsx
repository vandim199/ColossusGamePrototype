import { useEffect, useState } from 'react';
import { CLASSES, DIE_FACES, DIE_LABEL, type DiceRoll, type DieKind, type GameState } from '../engine';
import { ROLE_COLOR } from './theme';

/** How each die looks: its printed shape and colours. */
const STYLE: Record<DieKind, { shape: 'd4' | 'd6' | 'd8'; fill: string; ink: string; edge: string }> = {
  slasher: { shape: 'd4', fill: '#b23a2e', ink: '#fff6e6', edge: '#5e1a14' },
  standard: { shape: 'd4', fill: '#f8efd8', ink: '#3b2a18', edge: '#8a6a3c' },
  upgraded: { shape: 'd4', fill: '#2f6b3a', ink: '#f5ffe9', edge: '#163a1d' },
  heavy: { shape: 'd8', fill: '#4a301c', ink: '#f0c46a', edge: '#1e130a' },
  pull: { shape: 'd6', fill: '#8956b5', ink: '#fbf2ff', edge: '#432363' },
};

const SHAPES: Record<'d4' | 'd6' | 'd8', string> = {
  d4: '24,3 45,41 3,41',
  d6: '6,6 42,6 42,42 6,42',
  d8: '24,2 46,24 24,46 2,24',
};

/** Faces settle one after another, then the total appears. */
const ROLL_MS = 650;
const STAGGER_MS = 110;

function Die({ kind, face, rolling, index }: { kind: DieKind; face: number; rolling: boolean; index: number }) {
  const st = STYLE[kind];
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 48 48"
      className={rolling ? 'die rolling' : 'die landed'}
      style={{ animationDelay: rolling ? `${index * 37}ms` : '0ms' }}
      aria-label={`${DIE_LABEL[kind]}: ${face}`}
    >
      <polygon points={SHAPES[st.shape]} fill={st.fill} stroke={st.edge} strokeWidth={2.5} strokeLinejoin="round" />
      <text x={24} y={st.shape === 'd4' ? 34 : 30} textAnchor="middle" fontSize={st.shape === 'd4' ? 15 : 17} fontWeight={800} fill={st.ink} fontFamily="Cinzel, Georgia, serif">
        {face}
      </text>
    </svg>
  );
}

export function DiceTray({ roll, state }: { roll: DiceRoll; state: GameState }) {
  const [elapsed, setElapsed] = useState(0);
  const settleAt = (i: number) => ROLL_MS + i * STAGGER_MS;
  const done = elapsed >= settleAt(roll.faces.length - 1) + 120;

  useEffect(() => {
    const start = performance.now();
    const t = setInterval(() => {
      const e = performance.now() - start;
      setElapsed(e);
      if (e > settleAt(roll.faces.length) + 200) clearInterval(t);
    }, 60);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const h = state.hunters[roll.seat - 1];
  const tick = Math.floor(elapsed / 60);
  const sum = roll.faces.reduce((a, b) => a + b, 0) + roll.bonus;

  return (
    <div className="dice-tray" role="status" aria-live="polite">
      <div className="dice-title">
        <span className="seat-dot" style={{ background: ROLE_COLOR[h.cls], width: 20, height: 20, fontSize: 11 }}>
          {CLASSES[h.cls].short[0]}
        </span>
        {CLASSES[h.cls].short} · {roll.label}
      </div>
      <div className="dice-row">
        {roll.bonus > 0 && <span className="dice-bonus">{roll.bonus} +</span>}
        {roll.kinds.map((kind, i) => {
          const rolling = elapsed < settleAt(i);
          const faces = DIE_FACES[kind];
          const face = rolling ? faces[(tick * 5 + i * 3) % faces.length] : roll.faces[i];
          return <Die key={i} kind={kind} face={face} rolling={rolling} index={i} />;
        })}
      </div>
      <div className={`dice-total${done ? ' shown' : ''}`}>
        {done ? (
          <>
            = <b>{sum}</b>
            {roll.halved && (
              <>
                , halved to <b>{roll.total}</b>
              </>
            )}
          </>
        ) : (
          'rolling…'
        )}
      </div>
    </div>
  );
}
