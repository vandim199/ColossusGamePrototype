# Colossus: Mind Game — browser prototype

A playable prototype of the asymmetric 1v3 / 1v4 boss battler described in [GDD.md](GDD.md).
Interpretations of unclear rules are logged in [RULINGS.md](RULINGS.md).

## Getting started

```bash
npm install
npm run dev       # play at http://localhost:5173
npm test          # rules engine + bot tests
npm run sim       # 200 AI vs AI games, prints balance stats
```

## Playing locally

**Play local** lets you take any seat: the Colossus or one Hunter class. Bots fill every other seat. You can also pick **Watch bots** to see five bots play.

Options: 1v3 or 1v4 (and which class sits out in 1v3), bot difficulty, a turn timer (off / 60 s / 90 s, after which a bot plays your turn) and a seed.

Each round has three steps:

1. **Lock (Colossus).** Pick 2 cards (3 when Enraged) and set their direction or target on the board or the body board. Cube placements preview as you go.
2. **Commit (Hunters).** Pick 2 cards in the order they should resolve, then click highlighted hexes for each move. Your team's committed plans show as dashed arrows. You can change your commit until the last Hunter commits.
3. **Reveal.** A panel flips the Colossus's cards, shows the SHA-256 check, then plays the resolution step by step while the board highlights each event.

## Playing online (peer to peer)

There is no server. Browsers connect directly over WebRTC with [Trystero](https://github.com/dmotz/trystero), which uses public Nostr relays only to introduce peers. The networking sits behind a small `Transport` interface in `src/net/transport.ts`, so PeerJS or a hosted backend can replace it later.

1. **Create room.** You get a 5-letter code and a shareable link, and you take the Colossus seat by default.
2. **Players join.** Others open the link, or type the code under **Join a room**.
3. **The lobby** shows a seat for the Colossus and one per Hunter class. Players click **Sit here** to claim one. The host can set any empty seat to a bot, set each bot's difficulty, and pick the mode, timer and default bot difficulty.
4. **Start game.** Every unclaimed seat becomes a bot.

The host's browser runs the engine and the bots. Clients only send actions and only receive their own seat's view. The Colossus commits a SHA-256 hash of its locked cards plus a salt. At the reveal every client re-hashes the cards to check them.

If a player drops, a bot takes their seat at once. Reloading the same tab reclaims it, and anyone can take over a dropped seat from the lobby. If the host leaves, everyone sees a "Host left" message.

### Testing with two tabs on one machine

- **Over the real network:** create a room, copy the link, and open it in a second tab. Both tabs connect over WebRTC through the public relays, so you need internet access.
- **Offline:** tick **Same-machine test** before creating the room. The link then carries `&net=local`, and tabs talk over `BroadcastChannel` with no internet needed. Open the link in a second tab to join.

To test a reconnect, reload the client tab mid-game. A bot covers the seat, then the player gets it back. To test a host drop, close or leave the host tab.

## AI vs AI simulator

```bash
npm run sim                                   # 200 games of 1v4, both sides on "normal"
npm run sim -- --mode 1v3 --games 500
npm run sim -- --mode both --boss hard --hunters easy --seed 7
npm run sim -- --mode 1v3 --classes slasher,bard,vanguard
npm run sim -- --json                         # raw per-game arrays for your own analysis
npm run sim:log -- 12 1v4                     # full combat log of seed 12
```

Every simulated game runs through the same path as real play. Each seat sees only its own view, the Colossus uses commit-reveal, and every action goes through `applyAction`. A seed always replays the same game.

The report compares each stat to the GDD's playtest targets: game length, win rate, Parries, Exhaustions, rounds per strike point, climb length, Armor damage per standing round and more.

Baseline with v2.5 numbers and both bots on `normal` (seeds 1-200):

| | 1v3 | 1v4 | GDD target |
| --- | --- | --- | --- |
| Hunter win rate | 50% | 55% | |
| Mean game length (rounds) | 16.9 | 23.2 | 14-18 |
| Rounds per strike point | 5.2 | 5.3 | 3-4 |
| Successful Parries / game | 0.43 | 0.35 | 2-4 |
| Exhaustions / game | 0.12 | 0.57 | rare |
| Rounds a climber stays on | 2.8 | 2.9 | 1-3 |
| Armor damage / standing round | 3.8 | 4.6 | ~7 (1v4) |

**Reading the numbers.** The bots are heuristic one-ply planners. Treat the stats as relative: compare a rules change against this baseline, not against the targets. In particular:

- The Colossus bot avoids Hunters who hold Parry. The Hunter bot only parries when it reads that it is the likely target. That keeps Parries rare, so the Parry stat is a lower bound for human play.
- Difficulty shifts the win rate as expected. A hard Colossus against easy Hunters wins ~60%. An easy Colossus against hard Hunters wins ~32%.

## Layout

| Path | What it is |
| --- | --- |
| `src/engine/` | Pure rules engine: `applyAction(state, action) -> newState`, seeded RNG in state, no UI or network code |
| `src/engine/engine.test.ts` | Unit tests: dice, Parry/whiff, Tumbles, climbing, Rest/burn, escalation, commit-reveal |
| `src/bots/` | Colossus and Hunter bots (used for solo play, empty seats, dropped players, turn timeouts and the simulator) |
| `src/sim/` | Headless AI vs AI runner and stats report |
| `src/host/` | `GameHost` (the authority: engine, seat controllers, bots, turn timer) and `Session`/`SeatClient` (what a UI talks to; holds the Colossus's secret between lock and reveal) |
| `src/net/` | Peer-to-peer: `Transport` interface (Trystero WebRTC, or BroadcastChannel for same-machine tests), lobby protocol, `NetHost` (authority side) and `NetClient` |
| `src/ui/` | React UI: SVG hex arena, body board, hand, status strip, reveal panel, combat log |
