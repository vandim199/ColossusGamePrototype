import { useState } from 'react';
import { DIFFICULTIES, type Difficulty } from '../bots';
import { ALL_CLASSES, CLASSES, createGame, defaultClasses, type HunterClass, type Mode } from '../engine';
import { GameHost } from '../host/gameHost';
import { LocalSession, seatsFor } from '../host/session';
import type { TimerSetting } from '../host/types';

export interface LocalConfig {
  mode: Mode;
  classes: HunterClass[];
  you: number | 'spectator';
  difficulty: Difficulty;
  timer: TimerSetting;
  seed: number;
}

export function startLocalGame(c: LocalConfig): LocalSession {
  const state = createGame({ mode: c.mode, classes: c.classes, seed: c.seed });
  const seats = seatsFor(c.classes, c.you, c.difficulty);
  const watching = c.you === 'spectator';
  const host = new GameHost(state, seats, { timer: c.timer, botDelayMs: watching ? 900 : 650, revealPauseMs: watching ? 4500 : 1200 });
  // Dev builds only: expose the authority for scenario testing from the console.
  if (import.meta.env.DEV) (window as unknown as { __host: GameHost }).__host = host;
  return new LocalSession(host, c.you);
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label?: (v: T) => string }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {label ? label(o.v) : o.label}
        </button>
      ))}
    </div>
  );
}

export function LocalSetup({ onStart, onBack }: { onStart: (c: LocalConfig) => void; onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('1v4');
  const [benched, setBenched] = useState<HunterClass>('bard');
  const [you, setYou] = useState<number | 'spectator'>(1);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [timer, setTimer] = useState<TimerSetting>(0);
  const [seed, setSeed] = useState('');

  const classes = mode === '1v4' ? defaultClasses('1v4') : ALL_CLASSES.filter((c) => c !== benched);
  const seatOptions: { v: number | 'spectator'; label: string }[] = [
    { v: 0, label: 'Colossus' },
    ...classes.map((c, i) => ({ v: i + 1, label: CLASSES[c].short })),
    { v: 'spectator', label: 'Watch bots' },
  ];
  const youValid = you === 'spectator' || you <= classes.length;

  return (
    <div className="menu">
      <button className="btn small" onClick={onBack}>
        ← Back
      </button>
      <h1 style={{ marginTop: 12 }}>Local game</h1>
      <p className="subtitle">You take one seat; bots fill every other seat. Same engine and bots as online play.</p>

      <div className="menu-card">
        <div className="field">
          <label>Mode</label>
          <Seg value={mode} onChange={setMode} options={[{ v: '1v3', label: '1v3 (4 strikes)' }, { v: '1v4', label: '1v4 (5 strikes)' }]} />
        </div>
        {mode === '1v3' && (
          <div className="field">
            <label>Hunter class left out</label>
            <Seg value={benched} onChange={setBenched} options={ALL_CLASSES.map((c) => ({ v: c, label: CLASSES[c].short }))} />
          </div>
        )}
        <div className="field">
          <label>Your seat</label>
          <Seg value={youValid ? you : 1} onChange={setYou} options={seatOptions} />
          <span className="muted" style={{ fontSize: 12 }}>
            {you === 0
              ? 'Lock 2 hidden cards each round; cubes herd, Quick Attacks punish.'
              : you === 'spectator'
                ? 'All five seats are bots. Good for learning the flow.'
                : CLASSES[classes[(you as number) - 1] ?? 'slasher'].blurb}
          </span>
        </div>
        <div className="field">
          <label>Bot difficulty</label>
          <Seg value={difficulty} onChange={setDifficulty} options={DIFFICULTIES.map((d) => ({ v: d, label: d }))} />
        </div>
        <div className="field">
          <label>Turn timer</label>
          <Seg value={timer} onChange={setTimer} options={[{ v: 0 as TimerSetting, label: 'Off' }, { v: 60 as TimerSetting, label: '60 s' }, { v: 90 as TimerSetting, label: '90 s' }]} />
          <span className="muted" style={{ fontSize: 12 }}>When it runs out, a bot plays your turn.</span>
        </div>
        <div className="field">
          <label>Seed (optional)</label>
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ''))} placeholder="random" />
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={() =>
              onStart({ mode, classes, you: youValid ? you : 1, difficulty, timer, seed: seed ? Number(seed) : Math.floor(Math.random() * 1e9) })
            }
          >
            Start game
          </button>
        </div>
      </div>
    </div>
  );
}
