import { useEffect, useMemo, useState } from 'react';
import {
  ALL_HEXES,
  CLASSES,
  DIR_NAMES,
  LEGS,
  NODES,
  NODE_LINKS,
  NODE_NAMES,
  bodyHexes,
  bodyRing,
  bossDef,
  cubesForPlays,
  describeBossPlay,
  hexLabel,
  hunterDef,
  isRestCard,
  isSuperRestNow,
  reachable,
  requiredBossCount,
  requiredHunterCount,
  revivableAllies,
  validateBossPlays,
  validateHunterPlays,
  type BossPlay,
  type Dir,
  type GameState,
  type HexKey,
  type HunterPlay,
  type NodeId,
} from '../engine';
import type { Session } from '../host/session';
import type { ClientView } from '../host/types';

export interface BoardOverlay {
  selectable?: Set<HexKey>;
  onPick?: (h: HexKey) => void;
  nodes?: Set<NodeId>;
  onNode?: (n: NodeId) => void;
  previewCubes?: HexKey[];
  arrows?: { from: HexKey; to: HexKey; color: string; dashed?: boolean }[];
  aims?: HexKey[];
}

type SetOverlay = (o: BoardOverlay) => void;

// ------------------------------------------------------------------ cards

function HunterCard({ id, selected, order, onClick, disabled }: { id: string; selected?: boolean; order?: number; onClick?: () => void; disabled?: boolean }) {
  const d = hunterDef(id);
  const kind = [d.attack && (d.attack.range > 1 ? `attack · range ${d.attack.range}` : 'attack · melee'), d.move && (d.move.kind === 'walk' ? `move ${d.move.range}` : d.move.kind), d.parry && 'parry', d.climb && 'climb', d.ability && 'ability', d.rest && 'rest']
    .filter(Boolean)
    .join(' · ');
  return (
    <button className={`card${selected ? ' sel' : ''}`} onClick={onClick} disabled={disabled} title={d.text}>
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
      <span className="kind">{d.rage ? 'rage · ' : ''}{d.kind}</span>
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

const COLORS: Record<string, string> = { slasher: '#2bb3a3', marksman: '#8cc95b', vanguard: '#5b8def', bard: '#c084fc' };

function simulatePositions(s: GameState, seat: number, plays: HunterPlay[]): { pos: HexKey | null; node: NodeId | null }[] {
  const me = s.hunters[seat - 1];
  let pos = me.pos;
  let node = me.node;
  const out: { pos: HexKey | null; node: NodeId | null }[] = [];
  for (const p of plays) {
    out.push({ pos, node });
    if (!hunterDef(p.card).move) continue;
    if (node) {
      if (p.jump) {
        node = null;
        pos = p.jump;
      } else if (p.node) node = p.node;
    } else if (p.dest) pos = p.dest;
  }
  out.push({ pos, node });
  return out;
}

export function teammateArrows(s: GameState, you: number) {
  const arrows: NonNullable<BoardOverlay['arrows']> = [];
  for (const h of s.hunters) {
    const c = s.commits[h.seat - 1];
    if (h.seat === you || c?.kind !== 'cards' || !h.pos) continue;
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
  if (p.dest) bits.push(`to ${hexLabel(p.dest)}`);
  if (p.node) bits.push(`to ${NODE_NAMES[p.node]}`);
  if (p.jump) bits.push(`jump to ${hexLabel(p.jump)}`);
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
  const [restOpen, setRestOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlays([]);
    setActive(null);
    setEditing(true);
    setRestOpen(false);
    setError(null);
  }, [s.round, seat]);

  const canAct = s.phase === 'hunterCommit' && !me.down && !me.exhausted;
  const showEditor = canAct && (editing || !commit);
  const need = requiredHunterCount(me);
  const positions = useMemo(() => simulatePositions(s, seat, plays), [s, seat, plays]);
  const validation = plays.length ? validateHunterPlays(s, seat, plays) : null;
  const allies = s.hunters.filter((h) => h.seat !== seat && !h.exhausted);
  const revivable = canAct ? revivableAllies(s, seat) : [];

  useEffect(() => {
    const o: BoardOverlay = { arrows: teammateArrows(s, seat) };
    if (showEditor) {
      plays.forEach((_, i) => {
        const a = positions[i];
        const b = positions[i + 1];
        if (a.pos && b.pos && a.pos !== b.pos) o.arrows!.push({ from: a.pos, to: b.pos, color: '#fff' });
      });
      if (active !== null && plays[active] && hunterDef(plays[active].card).move) {
        const at = positions[active];
        const card = plays[active].card;
        if (at.node) {
          o.nodes = new Set(NODE_LINKS[at.node]);
          o.onNode = (n) => update(active, { node: n, jump: undefined });
          o.selectable = new Set(bodyRing(s.colossus.center, 1));
          o.onPick = (h) => update(active, { jump: h, node: undefined });
        } else if (at.pos) {
          o.selectable = reachable(s, card, at.pos);
          o.onPick = (h) => update(active, { dest: h === at.pos ? undefined : h });
        }
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
      setPlays(plays.filter((_, j) => j !== i));
      setActive(null);
      return;
    }
    if (plays.length >= need) return;
    const d = hunterDef(card);
    const p: HunterPlay = { card };
    if (d.ability === 'beam') p.target = allies[0]?.seat;
    if (d.climb && !me.node) p.node = 'L1';
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
      setRestOpen(false);
      setActive(null);
    }
  }

  if (me.exhausted) return <p className="muted">You are Exhausted and out of the fight. Your team fights on.</p>;
  if (me.down)
    return (
      <p className="muted">
        You are Down. {me.revived ? 'You were already revived once.' : 'An adjacent ally can spend a full turn to revive you at 4 HP.'}
      </p>
    );
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
            const text =
              c.kind === 'cards' ? c.plays.map((p) => describeHunterPlay(p, s)).join(' + ') : c.kind === 'rest' ? 'Rest' : c.kind === 'revive' ? 'Revive' : 'committed';
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
          <span>
            {commit.kind === 'cards' ? commit.plays.map((p) => describeHunterPlay(p, s)).join(' + ') : commit.kind === 'rest' ? `Rest (burn ${hunterDef(commit.burn).name})` : commit.kind === 'revive' ? 'Revive' : ''}
          </span>
          <button className="btn small" onClick={() => setEditing(true)}>
            Change
          </button>
          <span className="muted">You can change until the last Hunter commits.</span>
        </div>
      )}

      {showEditor && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <span>
              <b>Your turn.</b>{' '}
              {need === 0 ? (
                <span>Only Rest is left: Super Rest.</span>
              ) : (
                <span className="muted">
                  Pick {need} card{need > 1 ? 's' : ''} (they resolve in the order picked). {me.node ? 'You are climbing: moves go 1 node or jump down.' : 'Moves: click a highlighted hex.'}
                </span>
              )}
            </span>
            <span className="row">
              {revivable.map((t) => (
                <button key={t} className="btn" disabled={busy} onClick={() => submit({ type: 'Revive', seat, target: t })}>
                  Revive {CLASSES[s.hunters[t - 1].cls].short}
                </button>
              ))}
              {me.discard.length > 0 && (
                <button className={`btn${restOpen ? ' on' : ''}`} onClick={() => setRestOpen(!restOpen)}>
                  {isSuperRestNow(me.hand) ? 'Super Rest…' : 'Rest…'}
                </button>
              )}
            </span>
          </div>

          {restOpen && (
            <div className="panel" style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 6 }}>
                <b>{isSuperRestNow(me.hand) ? 'Super Rest' : 'Rest'}</b>: reclaim your discard and recover {isSuperRestNow(me.hand) ? '4 HP and upgrade a die' : '2 HP'}. Pick the card to burn
                for good. {me.hand.length + me.discard.length - 1 < 4 && <span className="error">This leaves fewer than 4 cards: you will be Exhausted.</span>}
              </div>
              <div className="hand">
                {me.discard.map((c) => (
                  <HunterCard key={c} id={c} disabled={busy} onClick={() => submit({ type: 'Rest', seat, burn: c })} />
                ))}
              </div>
            </div>
          )}

          <div className="hand">
            {me.hand
              .filter((c) => !isRestCard(c))
              .map((c) => {
                const i = plays.findIndex((p) => p.card === c);
                return <HunterCard key={c} id={c} selected={i >= 0} order={i >= 0 ? i + 1 : undefined} onClick={() => toggle(c)} />;
              })}
          </div>

          {plays.length > 0 && (
            <div className="plays">
              {plays.map((p, i) => {
                const d = hunterDef(p.card);
                const at = positions[i];
                return (
                  <div key={p.card} className={`play-row${active === i ? ' active' : ''}`}>
                    <b>
                      {i + 1}. {d.name}
                    </b>
                    {d.move && (
                      <>
                        <span className="muted">{at.node ? (p.node ? `→ ${NODE_NAMES[p.node]}` : p.jump ? `jump down to ${hexLabel(p.jump)}` : 'stay on this node') : p.dest ? `→ ${hexLabel(p.dest)}` : 'stay in place'}</span>
                        <button className={`btn small${active === i ? ' on' : ''}`} onClick={() => setActive(active === i ? null : i)}>
                          {active === i ? 'Picking… (click the board)' : 'Choose'}
                        </button>
                      </>
                    )}
                    {d.climb && !at.node && (
                      <span className="row">
                        Mount on
                        {LEGS.map((n) => (
                          <button key={n} className={`btn small${p.node === n ? ' on' : ''}`} onClick={() => setPlays(plays.map((q, j) => (j === i ? { ...q, node: n } : q)))}>
                            {NODE_NAMES[n]}
                          </button>
                        ))}
                      </span>
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
                    {d.parry && <span className="muted">Protects your final hex at step 3.3.</span>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="row">
            <button className="btn primary" disabled={busy || plays.length !== need || need === 0 || !!validation} onClick={() => submit({ type: 'CommitHunterCards', seat, plays })}>
              Lock in
            </button>
            {plays.length > 0 && (
              <button className="btn" onClick={() => (setPlays([]), setActive(null))}>
                Clear
              </button>
            )}
            {validation && plays.length === need && <span className="error">{validation}</span>}
            {error && <span className="error">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Colossus

type Slot = { idx: number; slot: number };

function needsTargets(p: BossPlay): number {
  const n = bossDef(p.card).needs;
  return n === 'adjacentHex' || n === 'hexOrNode' ? 1 : n === 'twoTargets' ? 2 : 0;
}

export function BossControls({ view, session, setOverlay }: { view: ClientView; session: Session; setOverlay: SetOverlay }) {
  const s = view.state;
  const hand = s.colossus.hand;
  const [plays, setPlays] = useState<BossPlay[]>([]);
  const [active, setActive] = useState<Slot | null>(null);
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

  const need = requiredBossCount(s);
  const superRest = isSuperRestNow(hand);
  const canAct = s.phase === 'bossLock';
  const validation = plays.length ? validateBossPlays(s, plays) : null;
  const body = useMemo(() => new Set(bodyHexes(s.colossus.center)), [s.colossus.center]);

  useEffect(() => {
    if (!canAct) {
      setOverlay({});
      return;
    }
    const o: BoardOverlay = {
      previewCubes: cubesForPlays(s, plays),
      aims: plays.flatMap((p) => (p.targets ?? []).map((t) => t.hex).filter((h): h is HexKey => !!h)),
    };
    if (active) {
      const p = plays[active.idx];
      const def = bossDef(p.card);
      const setTarget = (t: { hex?: HexKey; node?: NodeId }) => {
        setPlays((ps) =>
          ps.map((q, j) => {
            if (j !== active.idx) return q;
            if (def.needs === 'restCube') return { ...q, hex: t.hex };
            const targets = [...(q.targets ?? [])];
            targets[active.slot] = t;
            return { ...q, targets };
          }),
        );
        const more = def.needs === 'twoTargets' && active.slot === 0;
        setActive(more ? { idx: active.idx, slot: 1 } : null);
      };
      o.selectable = new Set(def.needs === 'adjacentHex' ? bodyRing(s.colossus.center, 1) : ALL_HEXES.filter((h) => !body.has(h)));
      o.onPick = (hex) => setTarget({ hex });
      if (def.needs === 'hexOrNode' || def.needs === 'twoTargets') {
        o.nodes = new Set(NODES);
        o.onNode = (node) => setTarget({ node });
      }
    }
    setOverlay(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays, active, canAct, s]);

  function toggle(card: string) {
    setError(null);
    const i = plays.findIndex((p) => p.card === card);
    if (i >= 0) {
      setPlays(plays.filter((_, j) => j !== i));
      setActive(null);
      return;
    }
    if (isRestCard(card)) {
      setPlays([{ card }]);
      setActive(superRest ? { idx: 0, slot: 0 } : null);
      return;
    }
    const base = plays.filter((p) => !isRestCard(p.card));
    if (base.length >= need) return;
    const p: BossPlay = { card };
    const def = bossDef(card);
    if (def.needs === 'dir') p.dir = 3;
    setPlays([...base, p]);
    if (needsTargets(p)) setActive({ idx: base.length, slot: 0 });
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

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span>
          <b>Lock your cards.</b>{' '}
          <span className="muted">
            {need === 0
              ? 'Nothing playable: you must Rest.'
              : `Pick ${need} card${need > 1 ? 's' : ''}, or Rest alone. Red Cubes go down face up now; the rest stays hidden behind a SHA-256 commitment.`}
            {s.tumble ? ' Tumbled: Charged cards are locked.' : ''}
          </span>
        </span>
      </div>
      <div className="hand">
        {hand.map((c) => {
          const i = plays.findIndex((p) => p.card === c);
          const disabled = bossDef(c).kind === 'charged' && !!s.tumble;
          return <BossCard key={c} id={c} selected={i >= 0} order={i >= 0 ? i + 1 : undefined} disabled={disabled} onClick={() => toggle(c)} />;
        })}
      </div>

      {plays.length > 0 && (
        <div className="plays">
          {plays.map((p, i) => {
            const def = bossDef(p.card);
            return (
              <div key={p.card} className={`play-row${active?.idx === i ? ' active' : ''}`}>
                <b>
                  {i + 1}. {def.name}
                </b>
                {def.needs === 'dir' && (
                  <span className="compass">
                    {DIR_NAMES.map((n, d) => (
                      <button key={n} className={`btn small${p.dir === d ? ' on' : ''}`} onClick={() => setPlays(plays.map((q, j) => (j === i ? { ...q, dir: d as Dir } : q)))}>
                        {n}
                      </button>
                    ))}
                  </span>
                )}
                {Array.from({ length: needsTargets(p) }, (_, slot) => {
                  const t = p.targets?.[slot];
                  const picking = active?.idx === i && active.slot === slot;
                  return (
                    <button key={slot} className={`btn small${picking ? ' on' : ''}`} onClick={() => setActive(picking ? null : { idx: i, slot })}>
                      {picking ? 'Picking… (click a hex or node)' : t ? `Target: ${t.node ? NODE_NAMES[t.node] : hexLabel(t.hex!)}` : 'Choose target'}
                    </button>
                  );
                })}
                {def.needs === 'restCube' && superRest && (
                  <button className={`btn small${active?.idx === i ? ' on' : ''}`} onClick={() => setActive(active ? null : { idx: i, slot: 0 })}>
                    {p.hex ? `Free cube: ${hexLabel(p.hex)}` : 'Place free Red Cube (optional)'}
                  </button>
                )}
                {s.colossus.enraged && (
                  <label className="row muted">
                    <input type="radio" name="faceup" checked={faceUp === i} onChange={() => setFaceUp(i)} /> face up
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="row">
        <button className="btn primary" disabled={busy || !plays.length || !!validation} onClick={lock}>
          Lock in
        </button>
        {plays.length > 0 && (
          <button className="btn" onClick={() => (setPlays([]), setActive(null))}>
            Clear
          </button>
        )}
        {validation && <span className="error">{validation}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
