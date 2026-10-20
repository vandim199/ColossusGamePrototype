import { useEffect, useState } from 'react';
import type { Session } from '../host/session';
import { NetClient } from '../net/netClient';
import { NetHost } from '../net/netHost';
import { newRoomCode, normalizeCode } from '../net/protocol';
import { openTransport, type TransportKind } from '../net/transport';
import { GameScreen } from './GameScreen';
import { Lobby, type LobbyNet } from './Lobby';
import { LocalSetup, startLocalGame } from './LocalSetup';

type Screen = { name: 'home' } | { name: 'local' } | { name: 'lobby'; lobby: LobbyNet } | { name: 'game'; session: Session };

function readHash(): { code: string; net: TransportKind } | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = normalizeCode(params.get('room') ?? '');
  return code ? { code, net: params.get('net') === 'local' ? 'local' : 'trystero' } : null;
}

function storedName(): string {
  try {
    return localStorage.getItem('colossus:name') ?? '';
  } catch {
    return '';
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [name, setName] = useState(storedName);
  const [joinCode, setJoinCode] = useState(() => readHash()?.code ?? '');
  const [sameMachine, setSameMachine] = useState(() => readHash()?.net === 'local' || new URLSearchParams(location.search).get('net') === 'local');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const playerName = name.trim() || 'Player';
  useEffect(() => {
    try {
      localStorage.setItem('colossus:name', name);
    } catch {
      /* private mode */
    }
  }, [name]);

  const goHome = () => {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    setScreen({ name: 'home' });
  };

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const code = newRoomCode();
      const kind: TransportKind = sameMachine ? 'local' : 'trystero';
      const t = await openTransport(kind, code);
      const net = new NetHost(t, code, playerName);
      history.replaceState(null, '', `${location.pathname}${location.search}#room=${code}${kind === 'local' ? '&net=local' : ''}&host=1`);
      setScreen({ name: 'lobby', lobby: { kind: 'host', net } });
    } catch (e) {
      setError(`Could not open a room: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function join(code: string, kind: TransportKind) {
    setBusy(true);
    setError(null);
    try {
      const t = await openTransport(kind, code);
      const net = new NetClient(t, code, playerName);
      history.replaceState(null, '', `${location.pathname}${location.search}#room=${code}${kind === 'local' ? '&net=local' : ''}`);
      setScreen({ name: 'lobby', lobby: { kind: 'client', net } });
    } catch (e) {
      setError(`Could not join: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // Opening a shared link (#room=CODE) joins straight away.
  useEffect(() => {
    const h = readHash();
    if (h && !new URLSearchParams(location.hash.replace(/^#/, '')).get('host')) void join(h.code, h.net);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (screen.name === 'game')
    return (
      <GameScreen
        session={screen.session}
        onExit={() => {
          screen.session.leave();
          goHome();
        }}
      />
    );
  if (screen.name === 'local')
    return <LocalSetup onBack={goHome} onStart={(c) => setScreen({ name: 'game', session: startLocalGame(c) })} />;
  if (screen.name === 'lobby')
    return (
      <Lobby
        lobbyNet={screen.lobby}
        onGame={(session) => setScreen({ name: 'game', session })}
        onExit={() => {
          screen.lobby.net.close();
          goHome();
        }}
      />
    );

  return (
    <div className="menu">
      <h1>Colossus: Mind Game</h1>
      <p className="subtitle">
        A 1v3 / 1v4 asymmetric boss battle of telegraphed danger and blind reads. Hunters race Vital Strikes; the Colossus races their shrinking decks.
      </p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="name">Your name</label>
        <input id="name" value={name} maxLength={24} placeholder="Player" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="menu-grid">
        <div className="menu-card">
          <h2>Play local</h2>
          <p className="muted">Take any seat (Colossus or a Hunter). Bots fill the rest. Or watch five bots play.</p>
          <button className="btn primary" onClick={() => setScreen({ name: 'local' })}>
            Set up a game
          </button>
        </div>
        <div className="menu-card">
          <h2>Create online room</h2>
          <p className="muted">Peer-to-peer over WebRTC. You host: your browser runs the rules and the bots. Share the code or link.</p>
          <label className="row muted" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={sameMachine} onChange={(e) => setSameMachine(e.target.checked)} /> Same-machine test (tabs, no internet)
          </label>
          <button className="btn primary" disabled={busy} onClick={create}>
            Create room
          </button>
        </div>
        <div className="menu-card">
          <h2>Join a room</h2>
          <input value={joinCode} placeholder="Room code" aria-label="Room code" onChange={(e) => setJoinCode(normalizeCode(e.target.value))} />
          <button className="btn primary" disabled={busy || joinCode.length < 4} onClick={() => join(joinCode, sameMachine ? 'local' : 'trystero')}>
            Join
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>
        Rules: GDD v2.5. Interpretations are listed in RULINGS.md.
      </p>
    </div>
  );
}
