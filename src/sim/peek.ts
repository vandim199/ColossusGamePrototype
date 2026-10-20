// Debug helper: print one simulated game's log, or tally Quick Attack outcomes.
//   npx tsx src/sim/peek.ts log [seed] [mode]
//   npx tsx src/sim/peek.ts quick [games]
import { simulateGame } from './simulate';
const [cmd = 'log', a = '1', b = '1v4'] = process.argv.slice(2);
if (cmd === 'log') {
  const s = simulateGame({ mode: b as '1v3' | '1v4', seed: Number(a) });
  for (const e of s.log) console.log(`R${e.round} ${e.step.padEnd(7)} ${e.text}`);
  console.log(s.winner, s.round, JSON.stringify(s.stats));
} else {
  const tally: Record<string, number> = {};
  for (let i = 1; i <= Number(a); i++) {
    const s = simulateGame({ mode: '1v4', seed: i });
    for (const e of s.log) {
      const m = e.text.match(/^(Quick Swipe|Body Thrash|Wild Thrash) (smashes empty|hits|lashes)|^PARRY|Parry whiffs|holds Anchor/);
      if (m) tally[m[0]] = (tally[m[0]] ?? 0) + 1;
    }
  }
  console.log(tally);
}
