import { useEffect, useMemo, useRef, useState } from 'react';
import { verifyCommitment, type HexKey, type LogEvent, type Snapshot } from '../engine';
import type { Session } from '../host/session';
import { roleName, type ClientView } from '../host/types';
import { Board, type ShakeCue } from './Board';
import { BossControls, HunterControls, RevealedBossCard, teammateArrows, type BoardOverlay } from './Controls';
import { ClimbPanel, ColossusPanel, CombatLog, HuntersPanel, StatusStrip } from './Panels';

/** Re-render on every session event (a new view, but also "host left", which changes no view). */
export function useSessionView(session: Session): ClientView | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const off = session.subscribe(() => setVersion((v) => v + 1));
    return () => void off();
  }, [session]);
  return session.view();
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const PHASE_TEXT: Record<string, string> = {
  bossLock: '1 · Colossus locks',
  hunterCommit: '2 · Hunters commit',
  bossReveal: '3 · Reveal',
  gameOver: 'Game over',
};

/** What the board shows for one step of the reveal replay. */
interface ReplayCue {
  hexes: HexKey[];
  snap?: Snapshot;
  shake?: ShakeCue;
}

function cueFor(e: LogEvent | undefined, index: number): ReplayCue | null {
  if (!e) return null;
  const hurt = e.tone === 'damage' && e.seat ? [e.seat] : [];
  return {
    hexes: e.hexes ?? [],
    snap: e.snap,
    shake: hurt.length || e.bossHit ? { key: index, seats: hurt, boss: !!e.bossHit } : undefined,
  };
}

function RevealOverlay({
  view,
  events,
  expected,
  onFocus,
  onClose,
}: {
  view: ClientView;
  events: LogEvent[];
  /** The commitment this client saw at lock time, before any Hunter committed. */
  expected: string | undefined;
  onFocus: (f: ReplayCue | null) => void;
  onClose: () => void;
}) {
  const r = view.state.lastReveal!;
  // Every client re-hashes the revealed cards + salt itself, and checks it is the hash it was shown at lock time.
  const verified = useMemo(() => !r.forfeited && verifyCommitment(r.commitment, r.plays, r.salt) && (!expected || expected === r.commitment), [r, expected]);
  const [shown, setShown] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown >= events.length) return;
    const e = events[shown];
    const big = e.tone === 'big' || e.tone === 'parry' || e.tone === 'strike';
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 900 : big ? 1300 : 650);
    return () => clearTimeout(t);
  }, [shown, events]);

  useEffect(() => {
    const i = Math.max(0, shown - 1);
    const cue = cueFor(events[i], i);
    if (!cue) return;
    onFocus(cue);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return (
    <div className="reveal" role="dialog" aria-label={`Round ${r.round} reveal`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Round {r.round}: Reveal</h2>
        <span className={`tag ${verified ? 'ok' : 'bad'}`} title={`Hash shown at lock: ${expected ?? 'not seen'}\nRevealed salt: ${r.salt}\nSHA-256(cards + salt) = ${r.commitment}`}>
          {r.forfeited ? 'forfeited' : verified ? 'SHA-256 verified ✓' : 'hash mismatch!'}
        </span>
      </div>
      <div className="cards">
        {r.plays.map((p, i) => (
          <div key={i} style={{ animationDelay: `${i * 0.25}s` }}>
            <RevealedBossCard play={p} />
          </div>
        ))}
      </div>
      <div className="events" ref={listRef}>
        {events.slice(0, shown).map((e, i) => (
          <div key={i} className={`ev ${e.tone}${i === shown - 1 ? ' current' : ''}`}>
            <span className="step">{e.step}</span>
            {e.text}
          </div>
        ))}
      </div>
      <div className="row">
        {shown < events.length && (
          <button className="btn" onClick={() => setShown(events.length)}>
            Skip
          </button>
        )}
        <button className="btn primary" onClick={onClose}>
          {shown < events.length ? 'Close' : 'Continue'}
        </button>
      </div>
    </div>
  );
}

export function GameScreen({ session, onExit }: { session: Session; onExit: () => void }) {
  const view = useSessionView(session);
  const [overlay, setOverlay] = useState<BoardOverlay>({});
  const [revealRound, setRevealRound] = useState<number | null>(null);
  const seenReveal = useRef(0);
  const [focus, setFocus] = useState<ReplayCue | null>(null);
  const timerEnd = useRef<{ key: string; endsAt: number } | null>(null);
  const seenCommitments = useRef(new Map<number, string>());

  const s = view?.state;
  useEffect(() => {
    const r = s?.lastReveal?.round ?? 0;
    if (r > seenReveal.current) {
      seenReveal.current = r;
      setRevealRound(r);
    }
  }, [s?.lastReveal?.round]);

  if (s?.lock && s.phase !== 'bossLock' && !seenCommitments.current.has(s.round)) seenCommitments.current.set(s.round, s.lock.commitment);
  if (view && s) {
    const key = `${s.round}:${s.phase}`;
    if (view.timer && timerEnd.current?.key !== key) timerEnd.current = { key, endsAt: Date.now() + view.timer.remainingMs };
    if (!view.timer) timerEnd.current = null;
  }
  const now = useNow(!!timerEnd.current);
  const problem = session.problem();

  if (!view || !s) {
    return (
      <div className="menu">
        <h1>Connecting…</h1>
        <p className="muted">{problem ?? 'Waiting for the host to send the game.'}</p>
        <button className="btn" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  const you = view.you;
  // A reveal that just arrived replays from its first step in this very render, so figures never jump ahead.
  const fresh = s.lastReveal && s.lastReveal.round > seenReveal.current ? s.lastReveal.round : null;
  const replayRound = revealRound ?? fresh;
  const revealEvents = replayRound !== null ? s.log.filter((e) => e.round === replayRound && e.step !== 'lock' && e.step !== 'setup') : [];
  const cue = replayRound !== null ? (revealRound !== null && focus ? focus : cueFor(revealEvents[0], 0)) : null;
  const remaining = timerEnd.current ? Math.max(0, Math.ceil((timerEnd.current.endsAt - now) / 1000)) : null;
  const spectatorArrows = you === 'spectator' || you === 0 ? [] : teammateArrows(s, you as number);

  return (
    <div className="game">
      <div className="topbar">
        <span className="title">Colossus: Mind Game</span>
        <span className="tag">Round {s.round}</span>
        <span className="tag warn">{PHASE_TEXT[s.phase]}</span>
        {remaining !== null && s.phase !== 'gameOver' && <span className={`tag ${remaining <= 10 ? 'bad' : ''}`}>⏱ {remaining}s</span>}
        <span className="muted">
          You: {you === 'spectator' ? 'spectating' : roleName(view.seats[you].role)} · {s.config.mode}
        </span>
        {view.notices.length > 0 && <span className="tag warn">{view.notices[view.notices.length - 1]}</span>}
        {problem && <span className="tag bad">{problem}</span>}
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={onExit}>
          Leave
        </button>
      </div>
      <StatusStrip state={s} seats={view.seats} you={you} />
      <div className="board-wrap">
        <Board
          state={s}
          you={you}
          selectable={overlay.selectable}
          onPick={overlay.onPick}
          previewCubes={overlay.previewCubes}
          aims={overlay.aims}
          onHover={overlay.onHover}
          arrows={cue ? focusArrows(cue) : overlay.arrows ?? spectatorArrows}
          focus={cue?.hexes}
          snap={cue?.snap}
          shake={cue?.shake}
        />
      </div>
      <div className="side">
        <ColossusPanel state={s} you={you} />
        <ClimbPanel state={s} />
        <HuntersPanel state={s} seats={view.seats} you={you} />
        <CombatLog log={s.log} />
      </div>
      <div className="controls">
        {you === 0 ? (
          <BossControls view={view} session={session} setOverlay={setOverlay} />
        ) : you === 'spectator' ? (
          <p className="muted">Spectating. Every seat is played by a bot; the reveal plays out each round.</p>
        ) : (
          <HunterControls view={view} session={session} setOverlay={setOverlay} />
        )}
      </div>

      {revealRound !== null && s.lastReveal && revealEvents.length > 0 && (
        <RevealOverlay
          key={revealRound}
          view={view}
          events={revealEvents}
          expected={seenCommitments.current.get(revealRound)}
          onFocus={setFocus}
          onClose={() => {
            setRevealRound(null);
            setFocus(null);
          }}
        />
      )}

      {problem && (
        <div className="modal-back">
          <div className="modal">
            <h2>Host left</h2>
            <p>{problem} The host's browser was running the game, so it cannot continue.</p>
            <div className="row">
              <button className="btn primary" onClick={onExit}>
                Back to menu
              </button>
            </div>
          </div>
        </div>
      )}

      {s.phase === 'gameOver' && revealRound === null && !problem && (
        <div className="modal-back">
          <div className="modal">
            <h2>{s.winner === 'hunters' ? 'The Hunters win!' : s.winner === 'colossus' ? 'The Colossus wins!' : 'Draw'}</h2>
            <p>
              {s.winner === 'hunters' ? `${s.points} Vital Strike points in ${s.round} round${s.round === 1 ? '' : 's'}.` : s.winner === 'colossus' ? `Every Hunter is Down after ${s.round} round${s.round === 1 ? '' : 's'}.` : 'Round limit reached.'}
            </p>
            <p className="muted">
              Parries {s.stats.parries} · whiffs {s.stats.whiffs} · Armor Shatters {s.stats.shatters} · climbs {s.stats.climbs} · Bursts {s.stats.bursts} · Downs {s.stats.downs}
            </p>
            <div className="row">
              <button className="btn primary" onClick={onExit}>
                Back to menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function focusArrows(focus: { hexes: HexKey[] } | null): BoardOverlay['arrows'] {
  if (!focus || focus.hexes.length !== 2) return [];
  return [{ from: focus.hexes[0], to: focus.hexes[1], color: '#fff' }];
}
