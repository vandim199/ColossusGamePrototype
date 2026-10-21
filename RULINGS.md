# Rulings

`GDD.md` (v2.5) is the starting point. Where it is silent, ambiguous or contradicts itself, the prototype uses the simplest reading. Each ruling is listed here. Paths in brackets point to the code that implements it.

The designer's playtest changes of Oct 21, 2026 override both the GDD and the earlier rulings. They come first. Rulings they changed are marked **(changed Oct 21)**.

## Playtest changes (Oct 21, 2026)

These came from the designer after playing the first build.

| # | Change | Replaces |
| --- | --- | --- |
| A | **Rest is an ordinary card.** Play it as one of your cards (alone or with another) to take back your whole discard pile and heal 2. If it is your last card, it is a Super Rest instead: heal 4 and upgrade a die. **Nothing is ever burned.** | GDD fatigue clock ("every Rest burns 1 card"), Exhaustion, Rest using the whole turn |
| B | **Play 0, 1 or 2 cards.** Any combination is allowed, including Parry alone ("parry and stay still") or no cards at all (a pass). | Exactly 2 cards per round; Parry must be played with a move |
| C | **Climbing uses the map.** The Colossus's 7 hexes are its body. A climber stands on the nearest body hex and is drawn on top of the Colossus there. There are no Legs, Back or Head nodes and no Grip. | The 3-tier body board, nodes, Grip |
| D | **Burst on the core.** Only the central hex (the core) can be hurt from on top. Climbers must deal **4 damage** there (the Burst, shared by all climbers) before they are shaken off at the end of the round after they climbed. Success is **1 Vital Strike**, and the climbers are thrown clear unharmed. Failure means each climber is shaken off and takes **4 damage**. | Striking nodes for 1 or 2 points |
| E | **Bigger Colossus attacks, aimed by clicking the map.** Tri-Cone is a 120° V (a third of the arena around the Colossus) to the edge. Line Burst is a straight line from the body to the arena edge toward any hex. Charge Forward surges toward any hex. Ring Slam, Quick Swipe, Body Thrash and Tail Sweep all cover more ground (see 26). | Fixed 6-direction aiming; 3-hex rays; a 5-hex line |
| F | **The Colossus can walk.** Two **Stride** cards join its deck (16 cards): walk up to 2 hexes toward a clicked hex at the end of the round, trampling Hunters in the way for 2. | Moving only by Charge Forward |
| G | **The Colossus may lock any cards together**: 1 or 2 (3 when Enraged), in any combination. That includes two Charged Attacks, a Stride with an attack, or Rest with an attack. | Exactly 2 cards; one Charged Attack per round; Rest alone |
| H | **Look and feel.** A parchment-and-leather theme with green accents. Figures glide when they move, and anyone hit shakes, the Colossus included. The reveal replays the round step by step. | |

Tuning dials: `BURST_TARGET` (4) and `SHAKE_DAMAGE` (4) live in `src/engine/board.ts`. The Burst target was set from simulation: at 5, a lone climber almost never broke the core.

## Board and setup

1. **Geometry.** The 10x10 arena uses flat-top hexes in an odd-q offset grid. "Adjacent to the Colossus" means touching any of its 7 hexes. "Distance N from the Colossus" means N hexes from the nearest body hex. [`engine/board.ts`]
2. **Start positions** (not in the GDD). The Colossus centre is at column 5, row 5 and faces south. The Hunters stand spread along the bottom row. [`engine/setup.ts`]
3. **One figure per ground hex.** Hunters may walk through allies but not through the Colossus. A Hunter commits a destination hex. If that hex is occupied when they move, they stop on the free reachable hex closest to it. Climbers may share body hexes.
4. **1v3** uses any 3 of the 4 classes. The default leaves out the Bard.
5. The components list says "5 class decks". Only 4 Hunter classes exist, so the prototype has 4 decks.

## Hand loop and Rest

6. **The Hunter decks are not in the GDD**, so these are designed for the prototype. Each class has 10 cards. All four share Rest, Parry and Climb & Strike, and the class cards are built around the named signature cards:

   | Class | Attacks | Movement | Other |
   | --- | --- | --- | --- |
   | Quick Slasher | Slash x2 (melee, 6 dice + Momentum), Infinite Vector Dash (move 3, then melee with 4 dice + Momentum) | Dash x2 (3), Sidestep (2), Vault Over Colossus (from within 2 hexes of the body, leap to any adjacent hex) | |
   | Range Marksman | Arrow Volley x3 (range 4, 4 dice, Bleed on two or more 2s) | Step x2 (2), Stride (3), Grapple Reposition (any hex within 4, ignores blockers) | |
   | Heavy Vanguard | Hammer Blow x2 (melee, 2 Upgraded d4 + Heavy d8), Sledge Shatter (melee, 3 + Heavy d8) | March x2 (2), Advance (3) | Anchor Stance |
   | The Bard | Chord Strike x2 (range 3, 2 Standard d4) | Stride x2 (3), Step (2) | Rescue Beam, Harmonic Hymn |

   "Melee" means adjacent to the Colossus. A range is measured to the nearest body hex.
7. **The whole deck starts in hand.** Played cards go to the discard pile, and Rest takes them back.
8. **(changed Oct 21)** Each round a Hunter commits 0, 1 or 2 cards, in any combination (change B). Rest is one of those cards (change A).
9. **(changed Oct 21)** A **Super Rest** is a Rest played together with every card still in your hand: it is your last card.
10. **(changed Oct 21)** Exhaustion is gone. No card is ever burned, so Hunters lose only when all of them are Down.
11. **(changed Oct 21)** **The Colossus uses the same hand loop.** All 16 cards start in hand. It locks 1 or 2 cards per round (up to 3 Enraged) in any combination, Rest included. It never burns cards.
12. **Tumbled Colossus.** While Tumbled it cannot play Charged Attacks or Stride, since it is lying down. Rest and every other card are allowed.
13. **Fizzles.** A card whose condition fails when it resolves still goes to the discard. Conditions include being out of range, no Tumble for Climb & Strike, an attack on the body away from the core, or a revive target that moved.
14. **(changed Oct 21)** Parry may be played with anything or alone. It always protects the hex you end your movement on.
15. **Revive.** The reviver commits "Revive" in place of cards and spends no cards. They must be adjacent to the Downed ally at commit time and still adjacent at step 3.4.
16. Hunters may change their commit until the last Hunter commits. After that, it is locked.

## Timing within a round

17. **Telegraph cubes** are placed face up at the lock in round N and detonate at step 3.2 of round N+1. Hunters get two commit windows to react. Climbers are above the cubes and safe from them.
18. **Charged Attacks** are among the Colossus's locked cards in round N. They are revealed with the rest, become the arrow token at cleanup of round N, and resolve at step 3.5 of round N+1. **(changed Oct 21)** Any number may be locked together. Any Tumble cancels both the pending and the just-locked Charged Attacks.
19. **(changed Oct 21)** **Every Rest**, Hunter or Colossus, resolves at the reveal, before anything moves. Hunters can still break the Colossus's restored Armor that round.
20. Other timings:
    - Step 3.1 is Hunter movement in seating order. Rescue Beam also resolves here, at the Bard's seat.
    - At step 3.3, Roar resolves first, then the other Quick cards in lock order. Shell Harden and Stomp Quake resolve in 3.3 too.
    - At step 3.4, Blasting Shell resolves first. Then each Hunter in seating order resolves their Climb, attacks, Hymn or Revive.
    - Step 3.5 resolves the Charged Attacks declared last round first, then this round's Strides.
21. **Armor Shatter** is checked only at cleanup, as the GDD's turn sequence says.

## Card details

22. **(changed Oct 21)** Quick Attacks hit areas. Quick Swipe hits an adjacent hex and its two neighbours along the ring. Body Thrash hits any hex plus its ground neighbours. Aimed at one of the Colossus's own body hexes, it hits only climbers on that hex. Wild Thrash is two Body Thrashes. A Hunter who Parried deflects any of them that covers their hex. Stomp Quake hits every adjacent hex and every climber for 2, and cannot be Parried.
23. **Knockback** pushes the Hunter directly away from the Colossus centre, one hex at a time. It stops at the board edge, the body and other figures.
24. **(changed Oct 21)** **Charge Forward** surges toward the aimed hex, each step heading within 45 degrees of that line, until the body would leave the board. Hunters in any swept hex take 4. Anyone left under the final body is pushed to the nearest free hex. Climbers ride along. **Stride** works the same way for at most 2 steps, dealing 2.
25. **(changed Oct 21)** **Facing** changes whenever the Colossus moves (Charge Forward or Stride). **Tail Sweep** hits the hexes 1 and 2 away from the body at 90 degrees or more from the facing.
26. **(changed Oct 21)** **Telegraph shapes:**
    - Tri-Cone covers every ground hex within 60 degrees of the line to the aimed hex, out to the edge: a 120-degree V, a third of the directions around the Colossus.
    - Line Burst covers a straight line from the body toward the aimed hex, out to the arena edge.
    - Ring Slam covers every hex 2 or 3 away from the body.

    Off-board hexes get no cube. The GDD's 30-cube budget is dropped, since the bigger shapes need more cubes. Overlapping hexes within one lock use a single cube.
27. **Feint** Exposes every Hunter who Parried, even one who deflected a different Quick Attack that round.
28. **Anchor Stance** blocks each Quick Attack that covers the Vanguard. Every block gives +3 Shield to each adjacent ally, and the Shield stacks.
29. **Blasting Shell "all but one"** means the number of attackers is at least max(1, active Hunters - 1). An attacker is any Hunter who committed an attack card, counting Climb & Strike played on the body.
30. Armor never exceeds full Armor. This covers Rest, Shell Harden and Blasting Shell.
31. **Exposed** adds +2 to every hit, including shake-offs and Blasting Shell's reflected damage. **Shield** absorbs first.

## Climbing (changed Oct 21)

32. **Mounting** happens at step 3.4. The climber moves onto the body hex next to them (change C).
    - **Short Tumble:** one mount. The parrier has priority. Otherwise an ally adjacent to the parrier mounts, in seating order. Hunters coordinate this in table talk.
    - **Long Tumble:** every adjacent Hunter may mount.
33. **On the body,** movement cards walk across body hexes and may step down onto the ground (jumping down safely). Attack cards and Climb & Strike only count on the core (the central hex). Each roll adds to the shared **Burst**, and Shell Harden halves it like any Hunter attack.
34. **The Burst** (change D). At 4 or more, the core breaks: 1 Vital Strike, the Burst resets, and every climber is thrown clear unharmed. A climber who mounted in round N is shaken off at cleanup of round N+1 if they are still on the body. They land on the nearest free adjacent hex and take 4. The Burst resets once nobody is left on the body.
35. Climbers ride along when the Colossus moves. Cubes, Charges and Tail Sweep miss them. Body Thrash on their body hex and Stomp Quake hit them.
36. A climber reduced to 0 HP drops to an adjacent hex with no extra damage.
37. Climbers stay on when the Colossus stands up. The shake-off is the only clock.
38. Vital Strikes come only from the Burst. Escalation is one step per Strike (39).

## Escalation and Hunter abilities

39. **Each Vital Strike** raises full Armor by 2. Current Armor stays put until it resets at the end of a Long Tumble. One Rage card per Strike goes straight into the Colossus hand. **Enraged** is checked at cleanup, at target - 1 Strikes.
40. **Momentum.** A round where the Slasher makes an in-range attack and takes no damage gives +1 (max 3). Any other round sets it to 0. The bonus dice apply to every Slasher attack that round.
41. **Super Rest upgrades** the weakest upgradable die in the attack pool, at most twice per game. The Vanguard has nothing to upgrade, so its Super Rest gives +1 max HP from the start. Max HP caps at 14.
42. **Harmonic Hymn** heals the Bard and every ally within 3 hexes by 2. **Rescue Beam** rolls one Pull d6. An ally on the ground within 5 hexes is then pulled hex by hex toward the Bard, stopping when adjacent.
43. **Round limit:** 80 rounds, then the game is a draw. **(changed Oct 21)** Without the fatigue clock, this is the only thing that ends a stalled game.

## Online play

These are prototype decisions about the rules in a networked setting.

44. **The host's browser is the authority.** It runs the engine and the bots. When the Colossus is human, the host sits in the Colossus seat by default, because the host machine holds the full state, including the Colossus hand. Whoever hosts, commit-reveal proves the Colossus never changes its locked cards. Each client re-hashes the revealed cards plus salt and checks the result against the hash it was shown at lock time.
45. **Hunter commits** are visible to the other Hunters before the reveal, matching the open table talk. They are hidden from the Colossus and from spectators until the reveal. The Colossus has already locked by then, so this costs it nothing.
46. **Hunter hands** are public, since anyone can deduce them from the face-up discards. Only the Colossus hand (a card count is shown) and the order of the Rage deck are private.
47. **An unopened commitment voids the lock.** If a Colossus player disconnects before the reveal, or sends a reveal that does not match its hash, its locked cards do nothing that round and the cubes it just placed are removed. The round then resolves with the Hunters' cards only. A connected remote Colossus gets 15 seconds to open its commitment.
48. **Dropped players.** A bot plays a dropped player's seat from that moment, at the room's difficulty. Any commit the player already made stands. The player reclaims the seat by rejoining from the same tab (reloading the room link). A new tab or device can take over a dropped seat from the lobby screen.
49. **The turn timer** covers the lock and commit steps. When it runs out, a bot plays for every seat that has not acted. The reveal step is automatic.
