# Rulings

`GDD.md` (v2.5) is the source of truth. Where it is silent, ambiguous or contradicts itself, the prototype uses the simplest reading. Each ruling is listed here. Numbers in brackets point to the code that implements it.

## Board and setup

1. **Geometry.** The 10x10 arena uses flat-top hexes in an odd-q offset grid. "Adjacent to the Colossus" means touching any of its 7 hexes. "Distance N from the Colossus" means N hexes from the nearest body hex. [`engine/board.ts`]
2. **Start positions** (not in the GDD). The Colossus centre is at column 5, row 5 and faces south. The Hunters stand spread along the bottom row. [`engine/setup.ts`]
3. **One figure per hex.** Hunters may walk through allies but not through the Colossus. A Hunter commits a destination hex. If that hex is occupied when they move, they stop on the free reachable hex closest to it.
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
7. **The whole deck starts in hand** (a Concordia-style loop). Played cards go to the discard pile, and Rest takes them back.
8. **Each round a Hunter commits exactly 2 non-Rest cards.** With only 1 non-Rest card left, they commit that one. **Rest is played alone and uses the whole turn.** This reproduces the GDD's arithmetic exactly: a Hunter who plays every card and Rests every cycle hits 3 cards after 7 Rests, on round 30. A unit test checks this.
9. **Super Rest** means Rest is the only card in hand. A Standard Rest needs a non-empty discard pile, since the burned card comes from it.
10. **Exhaustion** is checked right after the burn. If hand plus discard is under 4 cards, the Hunter is Exhausted and leaves the board.
11. **The Colossus uses the same hand loop.** All 14 cards start in hand. It locks 2 per round (3 when Enraged) and plays Rest alone. It never burns cards.
12. If the Colossus holds fewer legal cards than it must lock, it locks all it can. With none, it must Rest. **Rest is allowed while Tumbled**: the Tumble rule exists to lock Charged cards.
13. **Fizzles.** A card whose condition fails when it resolves still goes to the discard. Conditions include being out of range, no Tumble for Climb & Strike, or a revive target that moved.
14. **Parry must be paired with a movement card**, as "Play it with a move" says. A 0-hex move is fine. The one exception: Parry may be committed alone when it is the last non-Rest card in hand.
15. **Revive.** The reviver commits "Revive" in place of cards and spends no cards. They must be adjacent to the Downed ally at commit time and still adjacent at step 3.4.
16. Hunters may change their commit until the last Hunter commits. After that, it is locked.

## Timing within a round

17. **Telegraph cubes** are placed face up at the lock in round N and detonate at step 3.2 of round N+1. Hunters get two commit windows to react.
18. **Charged Attacks** are one of the Colossus's locked cards in round N. They are revealed with the rest, become the arrow token at cleanup of round N, and resolve at step 3.5 of round N+1. Only one Charged card may be locked per round, since there is one arrow token. Any Tumble cancels both the pending and the just-locked Charged Attack.
19. **The Colossus's Rest** resolves at the reveal, before movement, so Hunters can still break the restored Armor that round.
20. Other timings:
    - Step 3.1 is Hunter movement in seating order. Rescue Beam also resolves here, at the Bard's seat.
    - At step 3.3, Roar resolves first, then the other Quick cards in lock order. Shell Harden and Stomp Quake resolve in 3.3 too.
    - At step 3.4, Blasting Shell resolves first. Then each Hunter in seating order resolves their Climb, attacks, Hymn, Rest or Revive.
21. **Armor Shatter** is checked only at cleanup, as the GDD's turn sequence says.

## Card details

22. Quick Swipe targets a hex adjacent to the Colossus. Body Thrash targets any ground hex or any body node. Wild Thrash is two Body Thrash-style attacks, and each can be Parried. Stomp Quake is an area effect, not a Quick Attack on a hex, so it cannot be Parried.
23. **Knockback** pushes the Hunter directly away from the Colossus centre, one hex at a time. It stops at the board edge, the body and other figures.
24. **Charge Forward** moves straight until one more step would put a body hex off the board. Hunters in any swept hex take 4. Anyone left under the final body is pushed to the nearest free hex. Climbers ride along.
25. **Facing** changes only through Charge Forward. **Tail Sweep** hits the 7 adjacent-ring hexes at 90 degrees or more from the facing (the back half, including both side hexes).
26. **Telegraph shapes:**
    - Tri-Cone fires 3 rays: the chosen direction and its two neighbours, 3 hexes each, starting next to the body.
    - Line Burst fires 5 hexes in a straight line.
    - Ring Slam hits every hex 2 away from the body (18 hexes).

    Off-board hexes get no cube. The 30-cube budget covers every cube on the board. Overlapping hexes within one lock use a single cube.
27. **Feint** Exposes every Hunter who Parried, even one who deflected a different Quick Attack that round.
28. **Anchor Stance** blocks each Quick Attack that targets the Vanguard. Every block gives +3 Shield to each adjacent ally, and the Shield stacks.
29. **Blasting Shell "all but one"** means the number of attackers is at least max(1, active Hunters - 1). An attacker is any Hunter who committed an attack card, counting Climb & Strike played on the body.
30. Armor never exceeds full Armor. This covers Rest, Shell Harden and Blasting Shell.
31. **Exposed** adds +2 to every hit, including falls and Blasting Shell's reflected damage. **Shield** absorbs first.

## Climbing

32. **Body board links** form a ladder. Each tier's two nodes link to each other (L1-L2, B1-B2, H1-H2), and each side links up the tiers (L1-B1-H1 and L2-B2-H2).
33. **Mounting** happens at step 3.4 onto the chosen Legs node, at Grip 6.
    - **Short Tumble:** one mount. The parrier has priority. Otherwise an ally adjacent to the parrier mounts, in seating order. Hunters coordinate this in table talk.
    - **Long Tumble:** every adjacent Hunter may mount.
34. **On the body:**
    - Each movement card climbs 1 node (-1 Grip) or jumps down to a hex adjacent to the Colossus (no Grip cost).
    - Attack cards and Climb & Strike strike the current node.
    - Other cards fizzle, and Parry does nothing on the body.
35. **Grip loss.** At cleanup, climbers lose 1 Grip only if the Colossus was standing during that round. At Grip 0 at any moment, the climber falls immediately to a random free adjacent hex (seeded RNG) and takes 3.
36. The core-stats table mentions climbers being "knocked off when the Colossus stands". That contradicts the v2.5 changelog's "Climbers stay on". **Climbers stay on.**
37. A climber reduced to 0 HP drops to an adjacent hex with no extra fall damage.
38. **Strikes score points only.** They do no Armor damage. A spent node refreshes when any new Tumble starts.

## Escalation and Hunter abilities

39. **Each point scored** raises full Armor by 2. Current Armor stays put until it resets at the end of a Long Tumble. One Rage card per point goes straight into the Colossus's hand. **Enraged** is checked at cleanup, at target - 1 points.
40. **Momentum.** A round where the Slasher makes an in-range attack and takes no damage gives +1 (max 3). Any other round sets it to 0. The bonus dice apply to every Slasher attack that round.
41. **Super Rest upgrades** the weakest upgradable die in the attack pool. The Vanguard has nothing to upgrade, so its Super Rest gives +1 max HP from the start. Max HP caps at 14.
42. **Harmonic Hymn** heals the Bard and every ally within 3 hexes by 2. **Rescue Beam** rolls one Pull d6. An ally within 5 hexes is then pulled hex by hex toward the Bard, stopping when adjacent.
43. **Round limit:** 80 rounds, then the game is a draw. This is a simulator safety valve. The fatigue clock ends real games far sooner.
