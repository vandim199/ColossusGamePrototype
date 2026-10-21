import { useEffect, useMemo, useState } from 'react';
import {
  ALL_HEXES,
  BURST_TARGET,
  CLASSES,
  MAX_HUNTER_CARDS,
  bodyHexes,
  bodyRing,
  bossDef,
  cardType,
  chargePath,
  cubesForPlays,
  describeBossPlay,
  hexLabel,
  hunterDef,
  isRestCard,
  isSuperRest,
  lockedWhileTumbled,
  maxBossCards,
  reachable,
  revivableAllies,
  stridePath,
  swipeHexes,
  thrashHexes,
  validateBossPlays,
  validateHunterPlays,
  type BossPlay,
  type GameState,
  type HexKey,
  type HunterPlay,
} from '../engine';
import type { Session } from '../host/session';
import type { ClientView } from '../host/types';

export interface BoardOverlay {
  selectable?: Set<HexKey>;
  onPick?: (h: HexKey) => void;
  onHover?: (h: HexKey | null) => void;
  previewCubes?: HexKey[];
  arrows?: { from: HexKey; to: HexKey; color: string; dashed?: boolean }[];
  aims?: HexKey[];
}

type SetOverlay = (o: BoardOverlay) => void;

// ------------------------------------------------------------------ cards

function HunterCard({ id, selected, order, onClick, disabled }: { id: string; selected?: boolean; order?: number; onClick?: () => void; disabled?: boolean }) {
  const d = hunterDef(id);
  const kind = [
    d.attack && (d.attack.range > 1 ? `attack · range ${d.attack.range}` : 'attack · melee'),
    d.move && (d.move.kind === 'walk' ? `move ${d.move.range}` : d.move.kind),
    d.parry && 'parry',
    d.climb && 'climb',
    d.ability && 'ability',
    d.rest && 'rest',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button className={`card${d.rest ? ' rest-card' : ''}${selected ? ' sel' : ''}`} onClick={onClick} disabled={disabled} title={d.text}>
      {order !== undefined && <span className="order">{order}</span>}
      <span className="kind">{kind}</span>
      <span className="name">{d.name}</span>
      <span className="text">{d.text}</span>
    </button>
  );
}

function BossCard({ id, selected, order, onClick, disabled }: { id: string; selected?: boolean; order?: number; onClick?: () => void; disabled?: boolean }) {
  const d = bossDef(id);
  return (
    <button className={`card boss${d.rage ? ' rage' : ''}${selected ? ' sel' : ''}`} onClick={onClick} disabled={disabled} title={d.text}>
      {order !== undefined && <span className="order">{order}</span>}
      <span className="kind">
        {d.rage ? 'rage · ' : ''}
        {d.kind}
      </span>
      <span className="name">{d.name}</span>
      <span className="text">{d.text}</span>
    </button>
  );
}

export function RevealedBossCard({ play }: { play: BossPlay }) {
  const d = bossDef(play.card);
  return (
    <div className={`card boss${d.rage ? ' rage' : ''}`}>
      <span className="kind">{d.kind}</span>
      <span className="name">{describeBossPlay(play)}</span>
      <span className="text">{d.text}</span>
    </div>
  );
}

// ------------------------------------------------------------------ Hunter

const COLORS: Record<string, string> = { slasher: '#2a8a7e', marksman: '#6a9636', vanguard: '#3c64a3', bard: '#8956b5' };

function positionsAlong(s: GameState, seat: number, plays: HunterPlay[]): HexKey[] {
  let pos = s.hunters[seat - 1].pos;
  const out = [pos];
  for (const p of plays) {
    if (hunterDef(p.card).move && p.dest) pos = p.dest;
    out.push(pos);
  }
  return out;
}

export function teammateArrows(s: GameState, you: number) {
  const arrows: NonNullable<BoardOverlay['arrows']> = [];
  for (const h of s.hunters) {
    const c = s.commits[h.seat - 1];
    if (h.seat === you || c?.kind !== 'cards') continue;
    let from = h.pos;
    for (const p of c.plays) {
      if (hunterDef(p.card).move && p.dest && p.dest !== from) {
        arrows.push({ from, to: p.dest, color: COLORS[h.cls], dashed: true });
        from = p.dest;
      }
    }
  }
  return arrows;
}

function describeHunterPlay(p: HunterPlay, s: GameState): string {
  const d = hunterDef(p.card);
  const bits: string[] = [];
  if (p.dest) bits.push(p.dest === s.colossus.center ? 'to the core' : `to ${hexLabel(p.dest)}`);
  if (p.target) bits.push(`on ${CLASSES[s.hunters[p.target - 1].cls].short}`);
  return bits.length ? `${d.name} (${bits.join(', ')})` : d.name;
}

export function HunterControls({ view, session, setOverlay }: { view: ClientView; session: Session; setOverlay: SetOverlay }) {
  const s = view.state;
  const seat = view.you as number;
  const me = s.hunters[seat - 1];
  const commit = s.commits[seat - 1];
  const [plays, setPlays] = useState<HunterPlay[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlays([]);
    setActive(null);
    setEditing(true);
    setError(null);
  }, [s.round, seat]);

  const canAct = s.phase === 'hunterCommit' && !me.down;
  const showEditor = canAct && (editing || !commit);
  const positions = useMemo(() => positionsAlong(s, seat, plays), [s, seat, plays]);
  const validation = validateHunterPlays(s, seat, plays);
  const allies = s.hunters.filter((h) => h.seat !== seat);
  const revivable = canAct ? revivableAllies(s, seat) : [];
  const superRest = isSuperRest(me.hand, plays.map((p) => p.card));

  useEffect(() => {
    const o: BoardOverlay = { arrows: teammateArrows(s, seat) };
    if (showEditor) {
      plays.forEach((_, i) => {
        if (positions[i] !== positions[i + 1]) o.arrows!.push({ from: positions[i], to: positions[i + 1], color: '#2f6b3a' });
      });
      if (active !== null && plays[active] && hunterDef(plays[active].card).move) {
        const from = positions[active];
        o.selectable = reachable(s, plays[active].card, from);
        o.onPick = (h) => update(active, { dest: h === from ? undefined : h });
      }
    }
    setOverlay(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, active, showEditor, s]);

  function update(i: number, patch: Partial<HunterPlay>) {
    // Later moves start from a new hex, so their destinations are cleared.
    const next = plays.map((p, j) => (j === i ? { ...p, ...patch } : j > i && hunterDef(p.card).move ? { card: p.card } : p));
    setPlays(next);
    const after = next.findIndex((p, j) => j > i && hunterDef(p.card).move);
    setActive(after >= 0 ? after : null);
  }

  function toggle(card: string) {
    setError(null);
    const i = plays.findIndex((p) => p.card === card);
    if (i >= 0) {
      setPlays(plays.filter((_, j) => j !== i).map((p) => (hunterDef(p.card).move ? { card: p.card } : p)));
      setActive(null);
      return;
    }
    if (plays.length >= MAX_HUNTER_CARDS) return;
    const d = hunterDef(card);
    const p: HunterPlay = { card };
    if (d.ability === 'beam') p.target = allies.find((a) => !a.climbing)?.seat ?? allies[0]?.seat;
    setPlays([...plays, p]);
    if (d.move) setActive(plays.length);
  }

  async function submit(action: Parameters<Session['act']>[0]) {
    setBusy(true);
    const r = await session.act(action);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setEditing(false);
      setActive(null);
    }
  }

  if (me.down)
    return <p className="muted">You are Down. {me.revived ? 'You were already revived once.' : 'An adjacent ally can spend a full turn to revive you at 4 HP.'}</p>;
  if (s.phase === 'bossLock') return <p className="muted">The Colossus is locking its cards behind the screen…</p>;
  if (s.phase === 'bossReveal') return <p className="muted">All Hunters committed. The Colossus reveals…</p>;
  if (s.phase === 'gameOver') return null;

  const teammates = s.hunters.filter((h) => h.seat !== seat && s.commits[h.seat - 1]);

  return (
    <div>
      {teammates.length > 0 && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted">Team plan:</span>
          {teammates.map((h) => {
            const c = s.commits[h.seat - 1]!;
            const text = c.kind === 'cards' ? (c.plays.length ? c.plays.map((p) => describeHunterPlay(p, s)).join(' + ') : 'pass') : c.kind === 'revive' ? 'Revive' : 'committed';
            return (
              <span key={h.seat} className="tag" style={{ borderColor: COLORS[h.cls], color: COLORS[h.cls] }}>
                {CLASSES[h.cls].short}: {text}
              </span>
            );
          })}
        </div>
      )}

      {!showEditor && commit && (
        <div className="row">
          <span className="tag ok">Locked in</span>
          <span>{commit.kind === 'cards' ? (commit.plays.length ? commit.plays.map((p) => describeHunterPlay(p, s)).join(' + ') : 'Pass') : commit.kind === 'revive' ? 'Revive' : ''}</span>
          <button className="btn small" onClick={() => setEditing(true)}>
            Change
          </button>
          <span className="muted">You can change until the last Hunter commits.</span>
        </div>
      )}

      {showEditor && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span>
              <b>Your turn.</b>{' '}
              {me.climbing ? (
                <span className="muted">
                  You are on the Colossus: move onto the core (the central hex) and attack. Burst {s.burst}/{BURST_TARGET}. You are shaken off at the end of round{' '}
                  {(me.mountedRound ?? s.round) + 1}.
                </span>
              ) : (
                <span className="muted">Pick up to 2 cards (they resolve in the order picked), or none to stay still. Moves: click a highlighted hex.</span>
              )}
            </span>
            <span className="row">
              {revivable.map((t) => (
                <button key={t} className="btn" disabled={busy} onClick={() => submit({ type: 'Revive', seat, target: t })}>
                  Revive {CLASSES[s.hunters[t - 1].cls].short}
                </button>
              ))}
            </span>
          </div>

          <div className="hand">
            {me.hand.map((c) => {
              const i = plays.findIndex((p) => p.card === c);
              return <HunterCard key={c} id={c} selected={i >= 0} order={i >= 0 ? i + 1 : undefined} onClick={() => toggle(c)} />;
            })}
          </div>

          {plays.length > 0 && (
            <div className="plays">
              {plays.map((p, i) => {
                const d = hunterDef(p.card);
                return (
                  <div key={p.card} className={`play-row${active === i ? ' active' : ''}`}>
                    <b>
                      {i + 1}. {d.name}
                    </b>
                    {d.move && (
                      <>
                        <span className="muted">{p.dest ? `→ ${p.dest === s.colossus.center ? 'the CORE' : hexLabel(p.dest)}` : 'stay in place'}</span>
                        <button className={`btn small${active === i ? ' on' : ''}`} onClick={() => setActive(active === i ? null : i)}>
                          {active === i ? 'Picking… (click the board)' : 'Choose'}
                        </button>
                      </>
                    )}
                    {d.ability === 'beam' && (
                      <span className="row">
                        Pull
                        {allies.map((a) => (
                          <button key={a.seat} className={`btn small${p.target === a.seat ? ' on' : ''}`} onClick={() => setPlays(plays.map((q, j) => (j === i ? { ...q, target: a.seat } : q)))}>
                            {CLASSES[a.cls].short}
                          </button>
                        ))}
                      </span>
                    )}
                    {d.parry && <span className="muted">Protects the hex you end on.</span>}
                    {d.rest && <span className="muted">{superRest ? 'Super Rest: +4 HP and a die upgrade.' : 'Take back your discard pile, +2 HP.'}</span>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn primary" disabled={busy || !!validation} onClick={() => submit({ type: 'CommitHunterCards', seat, plays })}>
              {plays.length ? 'Lock in' : 'Pass (stay still)'}
            </button>
            {plays.length > 0 && (
              <button className="btn" onClick={() => (setPlays([]), setActive(null))}>
                Clear
              </button>
            )}
            {validation && plays.length > 0 && <span className="error">{validation}</span>}
            {error && <span className="error">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Colossus

type Slot = { idx: number; slot: number; kind: 'aim' | 'target' | 'cube' };

function slotsFor(p: BossPlay, superRest: boolean): Slot['kind'][] {
  const n = bossDef(p.card).needs;
  if (n === 'aim') return ['aim'];
  if (n === 'adjacentHex' || n === 'anyHex') return ['target'];
  if (n === 'twoHexes') return ['target', 'target'];
  if (n === 'restCube' && superRest) return ['cube'];
  return [];
}

function slotValue(p: BossPlay, slot: Slot): HexKey | undefined {
  if (slot.kind === 'aim') return p.aim;
  if (slot.kind === 'cube') return p.hex;
  return p.targets?.[slot.slot];
}

function withValue(p: BossPlay, slot: Slot, h: HexKey | undefined): BossPlay {
  if (slot.kind === 'aim') return { ...p, aim: h };
  if (slot.kind === 'cube') return { ...p, hex: h };
  const targets = [...(p.targets ?? [])];
  if (h) targets[slot.slot] = h;
  return { ...p, targets };
}

export function BossControls({ view, session, setOverlay }: { view: ClientView; session: Session; setOverlay: SetOverlay }) {
  const s = view.state;
  const hand = s.colossus.hand;
  const [plays, setPlays] = useState<BossPlay[]>([]);
  const [active, setActive] = useState<Slot | null>(null);
  const [hover, setHover] = useState<HexKey | null>(null);
  const [faceUp, setFaceUp] = useState(0);
  const [locked, setLocked] = useState<{ round: number; plays: BossPlay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlays([]);
    setActive(null);
    setFaceUp(0);
    setError(null);
  }, [s.round]);

  const max = maxBossCards(s);
  const superRest = isSuperRest(hand, plays.map((p) => p.card));
  const canAct = s.phase === 'bossLock';
  const validation = plays.length ? validateBossPlays(s, plays) : 'Pick at least one card';
  const c = s.colossus.center;
  const body = useMemo(() => new Set(bodyHexes(c)), [c]);

  const choices = (slot: Slot): Set<HexKey> => {
    const p = plays[slot.idx];
    if (slot.kind === 'target' && bossDef(p.card).needs === 'adjacentHex') return new Set(bodyRing(c, 1));
    if (slot.kind === 'target') return new Set(ALL_HEXES);
    return new Set(ALL_HEXES.filter((h) => !body.has(h)));
  };

  useEffect(() => {
    if (!canAct) {
      setOverlay({});
      return;
    }
    // Hovering previews the active choice before you click it.
    const shown = plays.map((p, i) => (active && active.idx === i && hover && choices(active).has(hover) ? withValue(p, active, hover) : p));
    const o: BoardOverlay = { previewCubes: cubesForPlays(s, shown), aims: [], arrows: [], onHover: setHover };
    for (const p of shown) {
      const t = cardType(p.card);
      if (t === 'quickSwipe' && p.targets?.[0]) o.previewCubes!.push(...swipeHexes(c, p.targets[0]));
      if ((t === 'bodyThrash' || t === 'wildThrash') && p.targets) for (const x of p.targets) if (x) o.previewCubes!.push(...thrashHexes(c, x));
      for (const x of p.targets ?? []) if (x) o.aims!.push(x);
      if (t === 'chargeForward' && p.aim) {
        const path = chargePath(c, p.aim);
        if (path.length) o.arrows!.push({ from: c, to: path[path.length - 1], color: '#c2741b' });
      }
      if (t === 'stride' && p.aim) {
        const path = stridePath(c, p.aim, 2);
        if (path.length) o.arrows!.push({ from: c, to: path[path.length - 1], color: '#2f6b3a' });
      }
      if ((t === 'triCone' || t === 'lineBurst') && p.aim) o.aims!.push(p.aim);
    }
    if (active) {
      o.selectable = choices(active);
      o.onPick = (h) => {
        const next = plays.map((p, i) => (i === active.idx ? withValue(p, active, h) : p));
        setPlays(next);
        setActive(nextSlot(next, active));
      };
    }
    setOverlay(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, active, hover, canAct, s]);

  /** After filling a slot, jump to the next empty one. */
  function nextSlot(ps: BossPlay[], after: Slot | null): Slot | null {
    const sr = isSuperRest(hand, ps.map((p) => p.card));
    for (let i = 0; i < ps.length; i++) {
      const kinds = slotsFor(ps[i], sr);
      for (let j = 0; j < kinds.length; j++) {
        const slot: Slot = { idx: i, slot: j, kind: kinds[j] };
        if (kinds[j] === 'cube') continue;
        if (after && i === after.idx && j === after.slot) continue;
        if (!slotValue(ps[i], slot)) return slot;
      }
    }
    return null;
  }

  function toggle(card: string) {
    setError(null);
    const i = plays.findIndex((p) => p.card === card);
    if (i >= 0) {
      const next = plays.filter((_, j) => j !== i);
      setPlays(next);
      setActive(nextSlot(next, null));
      return;
    }
    if (plays.length >= max) return;
    const next = [...plays, { card }];
    setPlays(next);
    setActive(nextSlot(next, null));
  }

  async function lock() {
    setBusy(true);
    const r = await session.lockBoss(plays, Math.min(faceUp, plays.length - 1));
    setBusy(false);
    if (!r.ok) setError(r.error);
    else setLocked({ round: s.round, plays });
  }

  if (s.phase === 'gameOver') return null;
  if (!canAct) {
    const mine = locked?.round === s.round ? locked.plays : null;
    return (
      <div className="row">
        <span className="tag ok">Locked</span>
        <span>{mine ? mine.map(describeBossPlay).join(' + ') : `${s.lock?.cardCount ?? 0} cards`}</span>
        <span className="muted">
          {s.phase === 'hunterCommit' ? 'Hunters are deciding (their cards are hidden from you until the reveal)…' : 'Revealing (your salt opens the commitment)…'}
        </span>
      </div>
    );
  }

  const label = (slot: Slot, p: BossPlay) => {
    const v = slotValue(p, slot);
    if (active && active.idx === slot.idx && active.slot === slot.slot && active.kind === slot.kind) return 'Click the board…';
    if (slot.kind === 'aim') return v ? `Aimed at ${hexLabel(v)}` : 'Aim';
    if (slot.kind === 'cube') return v ? `Free cube: ${hexLabel(v)}` : 'Free Red Cube (optional)';
    return v ? `Target: ${body.has(v) ? (v === c ? 'your core' : 'your body') : hexLabel(v)}` : 'Choose target';
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <b>Lock your cards.</b>
        <span className="muted">
          Pick 1 to {max} cards in any combination. Aimed attacks: click any hex to point them. Red Cubes go down face up now; the rest stays hidden behind a
          SHA-256 commitment.{s.tumble ? ' Tumbled: you cannot charge or walk.' : ''}
        </span>
      </div>
      <div className="hand">
        {hand.map((card) => {
          const i = plays.findIndex((p) => p.card === card);
          const disabled = !!s.tumble && lockedWhileTumbled(card);
          return <BossCard key={card} id={card} selected={i >= 0} order={i >= 0 ? i + 1 : undefined} disabled={disabled} onClick={() => toggle(card)} />;
        })}
      </div>

      {plays.length > 0 && (
        <div className="plays">
          {plays.map((p, i) => (
            <div key={p.card} className={`play-row${active?.idx === i ? ' active' : ''}`}>
              <b>
                {i + 1}. {bossDef(p.card).name}
                {isRestCard(p.card) && superRest ? ' (Super Rest)' : ''}
              </b>
              {slotsFor(p, superRest).map((kind, j) => {
                const slot: Slot = { idx: i, slot: j, kind };
                const on = active?.idx === i && active.slot === j;
                return (
                  <button key={j} className={`btn small${on ? ' on' : ''}`} onClick={() => setActive(on ? null : slot)}>
                    {label(slot, p)}
                  </button>
                );
              })}
              {s.colossus.enraged && (
                <label className="row muted">
                  <input type="radio" name="faceup" checked={faceUp === i} onChange={() => setFaceUp(i)} /> face up
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <button className="btn primary" disabled={busy || !!validation} onClick={lock}>
          Lock in
        </button>
        {plays.length > 0 && (
          <button className="btn" onClick={() => (setPlays([]), setActive(null))}>
            Clear
          </button>
        )}
        {validation && plays.length > 0 && <span className="error">{validation}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
