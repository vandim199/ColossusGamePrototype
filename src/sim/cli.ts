// AI vs AI balance runner.
//   npm run sim                                  200 games of 1v4
//   npm run sim -- --games 500 --mode 1v3
//   npm run sim -- --mode both --boss hard --hunters easy --seed 7
//   npm run sim -- --classes slasher,bard,vanguard --mode 1v3 --json

import { DIFFICULTIES, type Difficulty } from '../bots';
import { ALL_CLASSES, type HunterClass, type Mode } from '../engine';
import { runBatch, type Report } from './simulate';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const games = Number(arg('games', '200'));
const modeArg = arg('mode', '1v4');
const seed = Number(arg('seed', '1'));
const boss = arg('boss', 'normal') as Difficulty;
const hunters = arg('hunters', 'normal') as Difficulty;
const classesArg = arg('classes', '');
const json = process.argv.includes('--json');

if (!DIFFICULTIES.includes(boss) || !DIFFICULTIES.includes(hunters)) throw new Error('Difficulty must be easy, normal or hard');
const modes: Mode[] = modeArg === 'both' ? ['1v3', '1v4'] : [modeArg as Mode];
const classes = classesArg ? (classesArg.split(',') as HunterClass[]) : undefined;
if (classes?.some((c) => !ALL_CLASSES.includes(c))) throw new Error(`Classes must be from ${ALL_CLASSES.join(', ')}`);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);

function histogram(xs: number[], bucket: number): string[] {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(Math.floor(x / bucket) * bucket, (counts.get(Math.floor(x / bucket) * bucket) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => `  ${String(k).padStart(3)}-${String(k + bucket - 1).padEnd(3)} ${'#'.repeat(Math.max(1, Math.round((n / max) * 40)))} ${n}`);
}

function print(r: Report, ms: number) {
  const totalPoints = r.points.reduce((a, b) => a + b, 0);
  const totalRounds = r.rounds.reduce((a, b) => a + b, 0);
  const rows: [string, string, string][] = [
    ['Hunter win rate', `${f1((100 * r.hunterWins) / r.games)}%  (Colossus ${f1((100 * r.colossusWins) / r.games)}%, draws ${r.draws})`, ''],
    ['Game length (rounds)', `mean ${f1(mean(r.rounds))}, median ${pct(r.rounds, 0.5)}, p10-p90 ${pct(r.rounds, 0.1)}-${pct(r.rounds, 0.9)}`, '14-18'],
    ['Vital Strike points / game', f2(mean(r.points)), ''],
    ['Rounds per strike point', totalPoints ? f2(totalRounds / totalPoints) : 'n/a', '3-4'],
    ['Median rounds between points', r.strikeGaps.length ? String(pct(r.strikeGaps, 0.5)) : 'n/a', ''],
    ['Successful Parries / game', f2(mean(r.parries)), '2-4'],
    ['Whiffed Parries / game', f2(mean(r.whiffs)), ''],
    ['Feint catches / game', f2(mean(r.feintCatches)), ''],
    ['Downs / game', `${f2(mean(r.downs))}  (revives ${f2(mean(r.revives))})`, ''],
    ['Armor Shatters / game', f2(mean(r.shatters)), ''],
    ['Short Tumbles / game', f2(mean(r.shortTumbles)), ''],
    ['Climbs / game', `${f2(mean(r.climbs))}  (Bursts landed ${f2(mean(r.bursts))}, shaken off ${f2(mean(r.shakeOffs))})`, ''],
    ['Colossus moves / game', f2(mean(r.bossMoves)), ''],
    ['Armor damage / standing round', f2(mean(r.armorPerRound)), '~7 (1v4)'],
    ['Rests / game', `Hunters ${f2(mean(r.hunterRests))}, Colossus ${f2(mean(r.bossRests))}`, ''],
  ];
  console.log(`\n=== ${r.mode}: ${r.games} games, Colossus bot ${boss} vs Hunter bots ${hunters}, seeds ${seed}-${seed + r.games - 1} (${(ms / 1000).toFixed(1)} s) ===`);
  const w = Math.max(...rows.map((x) => x[0].length));
  for (const [k, v, t] of rows) console.log(`  ${k.padEnd(w)}  ${v}${t ? `   [target ${t}]` : ''}`);
  console.log('\n  Game length distribution:');
  for (const line of histogram(r.rounds, 3)) console.log(line);
}

for (const mode of modes) {
  const t0 = Date.now();
  const report = runBatch({ games, mode, seed, boss, hunters, classes: mode === '1v4' ? undefined : classes });
  if (json) console.log(JSON.stringify(report));
  else print(report, Date.now() - t0);
}
