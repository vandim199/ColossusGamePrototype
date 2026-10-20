import { useEffect, useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../bots';
import { ALL_CLASSES, CLASSES, type HunterClass, type Mode } from '../engine';
import type { Session } from '../host/session';
import { roleName, type TimerSetting } from '../host/types';
import type { NetClient } from '../net/netClient';
import type { NetHost } from '../net/netHost';
import { roomLink, type LobbySeat, type LobbyState } from '../net/protocol';
import { ROLE_COLOR, ROLE_LETTER } from './theme';

export type LobbyNet = { kind: 'host'; net: NetHost } | { kind: 'client'; net: NetClient };

/** Re-render on every network change (lobby updates, host leaving, views arriving). */
function useLobby(n: LobbyNet): LobbyState | null {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const off = n.net.subscribe(() => setVersion((v) => v + 1));
    return () => void off();
  }, [n]);
  return n.net.lobby;
}

function Seg<T extends string | number>({ value, options, onChange, disabled }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Lobby({ lobbyNet, onGame, onExit }: { lobbyNet: LobbyNet; onGame: (s: Session) => void; onExit: () => void }) {
  const lobby = useLobby(lobbyNet);
  const isHost = lobbyNet.kind === 'host';
  const me = lobbyNet.net.clientId;
  const [copied, setCopied] = useState(false);
  const [watching, setWatching] = useState(false);
  const hostLeft = lobbyNet.kind === 'client' && lobbyNet.net.hostLeft;

  const mySeat = lobby?.seats.find((s) => s.occupant.kind === 'human' && s.occupant.clientId === me)?.seat ?? null;
  const droppedMine = mySeat !== null && lobby?.dropped.includes(mySeat);

  useEffect(() => {
    if (!lobby?.started) return;
    if (lobbyNet.kind === 'host' && lobbyNet.net.hostSession) {
      const host = lobbyNet.net;
      const s = host.hostSession!;
      onGame({ ...wrap(s), leave: () => host.close() });
    } else if (lobbyNet.kind === 'client' && ((mySeat !== null && !droppedMine) || watching)) {
      onGame(lobbyNet.net.session());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobby?.started, mySeat, droppedMine, watching]);

  if (!lobby) {
    return (
      <div className="menu">
        <button className="btn small" onClick={onExit}>
          ← Back
        </button>
        <h1 style={{ marginTop: 12 }}>Joining…</h1>
        <p className="subtitle">
          {hostLeft ? 'The host left.' : `Looking for the host of room ${lobbyNet.kind === 'client' ? lobbyNet.net.code : ''} over ${lobbyNet.net.transport.label}. This can take a few seconds.`}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          If nothing happens: check the code, make sure the host's tab is still open, and that both of you use the same link type (a same-machine link contains "net=local").
        </p>
      </div>
    );
  }

  const link = roomLink(lobby.code, lobby.transport);
  const nameOf = (clientId: string) => lobby.players.find((p) => p.clientId === clientId);
  const claim = (seat: number) => (lobbyNet.kind === 'host' ? lobbyNet.net.claim(me, seat) : lobbyNet.net.claim(seat));
  const release = () => (lobbyNet.kind === 'host' ? lobbyNet.net.release(me) : lobbyNet.net.release());
  const host = lobbyNet.kind === 'host' ? lobbyNet.net : null;
  const colossus = lobby.seats[0].occupant;
  const humanColossusNotHost = colossus.kind === 'human' && colossus.clientId !== lobby.hostClientId;

  return (
    <div className="menu" style={{ maxWidth: 860 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn small" onClick={onExit}>
          ← Leave room
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {lobbyNet.net.transport.label}
        </span>
      </div>
      <h1 style={{ marginTop: 12 }}>
        Room <span style={{ color: 'var(--accent)', letterSpacing: '0.12em' }}>{lobby.code}</span>
      </h1>
      <div className="row" style={{ margin: '8px 0 20px' }}>
        <input readOnly value={link} style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.target.select()} aria-label="Room link" />
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
      </div>
      {hostLeft && <p className="error">The host left the room.</p>}

      {lobby.started ? (
        <div className="menu-card">
          <h2>Game in progress</h2>
          {lobby.dropped.length ? (
            <>
              <p className="muted">These seats lost their player; a bot is covering. Take one over:</p>
              <div className="row">
                {lobby.dropped.map((seat) => (
                  <button key={seat} className="btn primary" disabled={mySeat !== null && !droppedMine} onClick={() => claim(seat)}>
                    Take over the {roleName(lobby.seats[seat].role)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Every seat is taken.</p>
          )}
          {lobbyNet.kind === 'client' && (
            <button className="btn" onClick={() => setWatching(true)}>
              Watch as a spectator
            </button>
          )}
        </div>
      ) : (
        <div className="menu-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}>
          <div className="menu-card">
            <h2>Seats</h2>
            {lobby.seats.map((s) => (
              <SeatRow key={s.seat} seat={s} me={me} lobby={lobby} isHost={isHost} nameOf={nameOf} claim={claim} release={release} host={host} />
            ))}
            {humanColossusNotHost && (
              <p className="muted" style={{ fontSize: 12 }}>
                Fair-play note: the host's browser runs the rules engine, so it holds the Colossus hand. The commit-reveal hash still proves the Colossus never
                changes its locked cards. For the fairest game the host plays the Colossus.
              </p>
            )}
          </div>
          <div className="menu-card">
            <h2>Settings</h2>
            <div className="field">
              <label>Mode</label>
              <Seg<Mode> value={lobby.mode} disabled={!isHost} onChange={(m) => host?.setMode(m)} options={[{ v: '1v3', label: '1v3' }, { v: '1v4', label: '1v4' }]} />
            </div>
            {lobby.mode === '1v3' && (
              <div className="field">
                <label>Class left out</label>
                <Seg<HunterClass> value={lobby.benched} disabled={!isHost} onChange={(c) => host?.setBenched(c)} options={ALL_CLASSES.map((c) => ({ v: c, label: CLASSES[c].short }))} />
              </div>
            )}
            <div className="field">
              <label>Turn timer</label>
              <Seg<TimerSetting>
                value={lobby.timer}
                disabled={!isHost}
                onChange={(t) => host?.setTimer(t)}
                options={[{ v: 0, label: 'Off' }, { v: 60, label: '60 s' }, { v: 90, label: '90 s' }]}
              />
            </div>
            <div className="field">
              <label>Bots for empty seats</label>
              <Seg<Difficulty> value={lobby.botDifficulty} disabled={!isHost} onChange={(d) => host?.setBotDifficulty(d)} options={DIFFICULTIES.map((d) => ({ v: d, label: d }))} />
            </div>
            <div className="field">
              <label>Players here</label>
              {lobby.players.map((p) => (
                <span key={p.clientId} className={p.connected ? '' : 'muted'}>
                  {p.name}
                  {p.clientId === lobby.hostClientId ? ' (host)' : ''}
                  {p.clientId === me ? ' (you)' : ''}
                  {p.connected ? '' : ' (left)'}
                </span>
              ))}
            </div>
            {isHost ? (
              <button className="btn primary" onClick={() => host!.start()}>
                Start game
              </button>
            ) : (
              <p className="muted">Waiting for the host to start. Empty seats become bots.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SeatRow({
  seat,
  me,
  lobby,
  isHost,
  nameOf,
  claim,
  release,
  host,
}: {
  seat: LobbySeat;
  me: string;
  lobby: LobbyState;
  isHost: boolean;
  nameOf: (id: string) => { name: string; connected: boolean } | undefined;
  claim: (seat: number) => void;
  release: () => void;
  host: NetHost | null;
}) {
  const o = seat.occupant;
  const mine = o.kind === 'human' && o.clientId === me;
  return (
    <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      <span className="row">
        <span className="seat-dot" style={{ background: ROLE_COLOR[seat.role] }}>
          {ROLE_LETTER[seat.role]}
        </span>
        <span>
          <b>{roleName(seat.role)}</b>
          <br />
          <span className="muted" style={{ fontSize: 12 }}>
            {o.kind === 'human' ? `${nameOf(o.clientId)?.name ?? 'Player'}${mine ? ' (you)' : ''}${o.clientId === lobby.hostClientId ? ' · host' : ''}` : o.kind === 'bot' ? `Bot · ${o.difficulty}` : 'Empty: becomes a bot at start'}
          </span>
        </span>
      </span>
      <span className="row">
        {mine && (
          <button className="btn small" onClick={release}>
            Leave seat
          </button>
        )}
        {o.kind !== 'human' && (
          <button className="btn small primary" onClick={() => claim(seat.seat)}>
            Sit here
          </button>
        )}
        {isHost && o.kind === 'empty' && (
          <button className="btn small" onClick={() => host?.setSeatOccupant(seat.seat, { kind: 'bot', difficulty: lobby.botDifficulty })}>
            Make bot
          </button>
        )}
        {isHost && o.kind === 'bot' && (
          <>
            <select value={o.difficulty} onChange={(e) => host?.setSeatOccupant(seat.seat, { kind: 'bot', difficulty: e.target.value as Difficulty })} aria-label="Bot difficulty">
              {DIFFICULTIES.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <button className="btn small" onClick={() => host?.setSeatOccupant(seat.seat, { kind: 'empty' })}>
              Remove bot
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** Bind a class-based session's methods so it can be spread into a plain object. */
function wrap(s: Session): Session {
  return {
    kind: 'online',
    view: () => s.view(),
    subscribe: (fn) => s.subscribe(fn),
    act: (a) => s.act(a),
    lockBoss: (p, f) => s.lockBoss(p, f),
    problem: () => s.problem(),
    leave: () => s.leave(),
  };
}
