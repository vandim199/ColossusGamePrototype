import { useEffect, useRef } from 'react';
import {
  BURST_TARGET,
  CLASSES,
  DIE_LABEL,
  bossDef,
  describeBossPlay,
  fullArmor,
  hunterDef,
  type GameState,
  type HunterState,
  type LogEvent,
} from '../engine';
import type { SeatInfo } from '../host/types';
import { ROLE_COLOR, ROLE_LETTER, controllerLabel } from './theme';

// ------------------------------------------------------------------ the climb

export function ClimbPanel({ state }: { state: GameState }) {
  const climbers = state.hunters.filter((h) => h.climbing);
  return (
    <div className="panel">
      <h3>
        Climb &amp; Burst
        <span className="muted" style={{ fontSize: 13, fontWeight: 400, fontFamily: 'var(--font)' }}>
          {BURST_TARGET} damage on the core = 1 Vital Strike
        </span>
      </h3>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          Burst <b>{state.burst}</b> / {BURST_TARGET}
        </span>
        <span className="muted" style={{ fontSize: 14 }}>
          {climbers.length ? `${climbers.length} on the Colossus` : state.tumble ? 'Tumbled: adjacent Hunters may climb' : 'Nobody climbing'}
        </span>
      </div>
      <div className="bar burst" style={{ margin: '4px 0 6px' }}>
        <div style={{ width: `${(100 * Math.min(state.burst, BURST_TARGET)) / BURST_TARGET}%` }} />
      </div>
      {climbers.map((h) => (
        <div key={h.seat} className="row" style={{ fontSize: 14 }}>
          <span className="seat-dot" style={{ background: ROLE_COLOR[h.cls], width: 20, height: 20, fontSize: 11 }}>
            {ROLE_LETTER[h.cls]}
          </span>
          {CLASSES[h.cls].short} {h.pos === state.colossus.center ? 'is on the CORE' : 'is on the body'}
          <span className="muted">· shaken off at the end of round {(h.mountedRound ?? state.round) + 1}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ status strip

function seatState(state: GameState, seat: SeatInfo): { text: string; tone: '' | 'done' | 'wait' } {
  if (state.phase === 'gameOver') return { text: '', tone: '' };
  if (seat.seat === 0) {
    if (state.phase === 'bossLock') return { text: 'locking cards…', tone: 'wait' };
    if (state.phase === 'hunterCommit') return { text: `locked ${state.lock?.cardCount ?? ''} ✓`, tone: 'done' };
    return { text: 'revealing…', tone: 'wait' };
  }
  const h = state.hunters[seat.seat - 1];
  if (h.down) return { text: 'Down', tone: '' };
  if (state.phase === 'bossLock') return { text: 'waiting for the Colossus', tone: '' };
  if (state.phase === 'hunterCommit') return state.commits[seat.seat - 1] ? { text: 'committed ✓', tone: 'done' } : { text: 'choosing…', tone: 'wait' };
  return { text: 'committed ✓', tone: 'done' };
}

export function StatusStrip({ state, seats, you }: { state: GameState; seats: SeatInfo[]; you: number | 'spectator' }) {
  return (
    <div className="status-strip">
      {seats.map((s) => {
        const st = seatState(state, s);
        return (
          <div key={s.seat} className={`seat-chip${s.seat === you ? ' you' : ''}`}>
            <span className="seat-dot" style={{ background: ROLE_COLOR[s.role] }}>
              {ROLE_LETTER[s.role]}
            </span>
            <div>
              <div className="who">
                {s.role === 'colossus' ? 'Colossus' : CLASSES[s.role].short} <span className="muted">· {controllerLabel(s, you)}</span>
              </div>
              <div className={`state ${st.tone}`}>{st.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ trackers

export function ColossusPanel({ state, you }: { state: GameState; you: number | 'spectator' }) {
  const c = state.colossus;
  const full = fullArmor(state);
  return (
    <div className="panel">
      <h3>
        Colossus
        <span className="row" style={{ gap: 4 }}>
          {c.enraged && <span className="tag bad">Enraged · 3 cards</span>}
          {state.tumble && <span className="tag warn">{state.tumble.kind === 'long' ? 'Long' : 'Short'} Tumble · stands end of R{state.tumble.endsRound}</span>}
          {c.bleed > 0 && <span className="tag bad">Bleed {c.bleed}</span>}
        </span>
      </h3>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          Armor <b>{c.armor}</b> / {full}
        </span>
        <span className="muted">
          Hand {c.hand.length} · Cubes {state.cubes.reduce((n, w) => n + w.hexes.length, 0)}/30
        </span>
      </div>
      <div className="bar" style={{ margin: '4px 0 8px' }}>
        <div style={{ width: `${(100 * c.armor) / Math.max(1, full)}%` }} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>Vital Strikes</span>
        <div className="pips">
          {Array.from({ length: state.target }, (_, i) => (
            <div key={i} className={`pip${i < state.points ? ' on' : ''}`} />
          ))}
        </div>
      </div>
      {state.pendingCharged.length > 0 && (
        <div style={{ marginTop: 6 }} className="tag warn">
          Declared: {state.pendingCharged.map(describeBossPlay).join(', ')} (resolves this round, step 3.5)
        </div>
      )}
      {you === 0 && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Your hand: {c.hand.map((x) => bossDef(x).name).join(', ')}
        </div>
      )}
      {c.discard.length > 0 && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Discard: {c.discard.map((x) => bossDef(x).name).join(', ')}
        </div>
      )}
    </div>
  );
}

function HunterRow({ h, seat, you }: { h: HunterState; seat: SeatInfo; you: number | 'spectator' }) {
  const pct = (100 * h.hp) / h.maxHp;
  return (
    <div className="hunter-row">
      <span className="seat-dot" style={{ background: ROLE_COLOR[h.cls] }}>
        {ROLE_LETTER[h.cls]}
      </span>
      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{CLASSES[h.cls].name}</b>
          <span className="muted" style={{ fontSize: 12 }}>
            {controllerLabel(seat, you)}
          </span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div className={`bar hp${h.hp <= 4 ? ' low' : ''}`} style={{ flex: 1 }}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span style={{ fontSize: 12 }}>
            {h.hp}/{h.maxHp} HP
          </span>
        </div>
        <div className="statuses">
          {h.down && <span className="tag bad">Down{h.revived ? '' : ' · revivable'}</span>}
          {h.climbing && <span className="tag warn">Climbing</span>}
          {h.exposed && <span className="tag bad">Exposed</span>}
          {h.exposedNext && <span className="tag bad">Exposed next round</span>}
          {h.shield > 0 && <span className="tag ok">Shield {h.shield}</span>}
          {h.cls === 'slasher' && h.momentum > 0 && <span className="tag ok">Momentum +{h.momentum}</span>}
          <span className="tag" title={`Hand: ${h.hand.map((x) => hunterDef(x).name).join(', ')}\nDiscard: ${h.discard.map((x) => hunterDef(x).name).join(', ')}`}>
            Hand {h.hand.length} · Discard {h.discard.length}
          </span>
          <span className="tag" title={h.dice.map((d) => DIE_LABEL[d]).join(', ')}>
            Dice {h.dice.map((d) => d[0].toUpperCase()).join('')}
          </span>
        </div>
      </div>
    </div>
  );
}

export function HuntersPanel({ state, seats, you }: { state: GameState; seats: SeatInfo[]; you: number | 'spectator' }) {
  return (
    <div className="panel">
      <h3>Hunters</h3>
      {state.hunters.map((h) => (
        <HunterRow key={h.seat} h={h} seat={seats[h.seat]} you={you} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ combat log

export function CombatLog({ log }: { log: LogEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length]);
  let lastRound = -1;
  return (
    <div className="panel">
      <h3>Combat log</h3>
      <div className="log" ref={ref}>
        {log.map((e, i) => {
          const header = e.round !== lastRound;
          lastRound = e.round;
          return (
            <div key={i}>
              {header && <div className="round">Round {e.round}</div>}
              <div className={`e ${e.tone}`}>
                <span className="step">{e.step}</span>
                {e.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
