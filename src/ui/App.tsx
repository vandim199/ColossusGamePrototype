import { useEffect, useState } from 'react';
import type { Session } from '../host/session';
import { GameScreen } from './GameScreen';
import { LocalSetup, startLocalGame } from './LocalSetup';

type Screen = { name: 'home' } | { name: 'local' } | { name: 'game'; session: Session };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  useEffect(() => {
    return () => {
      if (screen.name === 'game') screen.session.leave();
    };
  }, [screen]);

  if (screen.name === 'game') return <GameScreen session={screen.session} onExit={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'local')
    return <LocalSetup onBack={() => setScreen({ name: 'home' })} onStart={(c) => setScreen({ name: 'game', session: startLocalGame(c) })} />;

  return (
    <div className="menu">
      <h1>Colossus: Mind Game</h1>
      <p className="subtitle">
        A 1v3 / 1v4 asymmetric boss battle of telegraphed danger and blind reads. Hunters race Vital Strikes; the Colossus races their shrinking decks.
      </p>
      <div className="menu-grid">
        <div className="menu-card">
          <h2>Play local</h2>
          <p className="muted">Take any seat (Colossus or a Hunter). Bots fill the rest. Or watch five bots play.</p>
          <button className="btn primary" onClick={() => setScreen({ name: 'local' })}>
            Set up a game
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>
        Rules: GDD v2.5. Interpretations are listed in RULINGS.md.
      </p>
    </div>
  );
}
