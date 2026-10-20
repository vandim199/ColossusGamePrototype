# Colossus: Mind Game — GDD v2.5

Oct 20, 2026 · @Ivan

## Changelog from v2.4

v2.5 fixes four undefined or broken rules, removes two dominant strategies, and turns climbing into the game's climax. Numbers come from a 100k-roll simulation of every dice pool.

| Area | v2.4 | v2.5 | Why |
| --- | --- | --- | --- |
| Front-page claim | "0 Dice Rolls" | "Bounded dice, no hidden math" | Contradicted section 5 |
| Core stats | HP, Armor, Grip undefined | Hunter HP 12, Armor 4 per Hunter, Grip 6 | Nothing could be balanced without them |
| Rest | Always reclaims everything | Every Rest burns 1 card permanently | "Exhaust hand resources" win could never trigger |
| Super Rest | Effectively free every 5 turns | Still upgrades a die, but costs a burned card like any Rest; max 2 upgrades per Hunter | Guaranteed 3-4 upgrades per game snowballed |
| Boss Super Rest | +4 HP (boss has no HP) | +4 Armor and 1 free cube placement | Undefined stat |
| Parry | No cost for parrying nothing | Whiff = Exposed (+2 damage taken next round) | Standing still with Parry was dominant |
| Tumble | One kind | Short Tumble (Parry) vs Long Tumble (Armor Shatter) | Rewards the read and the grind differently |
| Climb & Strike | +1 strike, boss stands, everyone off | Climbers stay on; Grip-based climbing phase | Climax was one card; multi-climber rule was ambiguous |
| Strikes to win | 3-5 | 4 (1v3) or 5 (1v4) | A range is not a rule |
| Escalation | None | +2 Armor and 1 Rage card per strike | Late game repeated the early game |
| Quick Slasher | 3.0 avg damage, weakest class | Momentum: +1 die per consecutive attacking turn | Damage class did the least damage |
| Marksman Bleed | Triggers 68% of volleys | Needs two or more 2s (26%) | Bleed was effectively always on |
| Bard pull die | \[1,1,2,2,3,4\], 33% pull 3+ | \[2,2,2,3,3,4\], 50% pull 3+ | Clutch save failed two thirds of the time |
| Vanguard Anchor Parry | Auto-parry plus Tumble | Blocks plus Shield, no Tumble | Free Tumble 25-50% of turns, no read needed |
| Blasting Shell | Triggers on 3+ attackers | Triggers on all-but-one Hunter attacking | 3+ meant everyone in 1v3 |

## Concept and design pillars

Colossus: Mind Game is a 1v3 or 1v4 asymmetric boss battler: deterministic movement (War Chest), a hand loop that slowly runs dry (Concordia), and blind simultaneous reads (Yomi Hustle). The Colossus fills a 7-hex flower (one hex plus its six neighbours) on a 10x10 hex arena. Hunters break it down, knock it over and climb it.

Four pillars every rule should serve:

- **Readable danger.** Red Cubes show where it will hurt next round; nothing deals damage that wasn't telegraphed or guessed.
- **The read is the hero moment.** A correct Parry is the loudest thing in the game.
- **Two clocks.** Hunters race strikes; the Colossus races the Hunters' shrinking decks.
- **It gets worse.** Every strike makes the Colossus tougher and angrier.

Dice are bounded (no die averages over 2.25) and every face is printed, so there is no hidden math.

## Victory conditions

Hunters win at 4 Vital Strikes in 1v3 or 5 in 1v4. The Colossus wins when every Hunter is Down.

A Hunter is **Down** when either is true:

- HP reaches 0. A Downed Hunter's miniature is laid flat; an ally can spend a full turn adjacent to revive them at 4 HP (once per Hunter per game).
- Their deck (hand + discard) drops below 4 cards. This is permanent: they are Exhausted and out of the fight.

**The fatigue clock.** Each Hunter starts with 10 cards. Every Rest burns 1 card of the Hunter's choice from the reclaimed discard pile into a personal Exhausted pile. Rest is still a card in hand and can never be burned. A Hunter who Rests every cycle hits 3 cards after 7 Rests, which is roughly turn 30, so the clock bites only in long or sloppy games. Taking hits forces earlier Rests, so it bites sooner when the Colossus is winning.

## Core stats

Starting values below are first-playtest targets; Armor is the dial to turn if games run long or short.

| Stat | Value | Notes |
| --- | --- | --- |
| Hunter HP | 12 (max 14) | Two telegraphed Tri-Cone hits plus a Quick Attack kills |
| Colossus Armor | 4 per Hunter (12 or 16) | +2 after each Vital Strike |
| Grip | 6 per climbing Hunter | Resets to 6 each climb |
| Quick Attack damage | 3, knockback 2 | Body Thrash is the Quick Attack on the body board |
| Charged Attack damage | 4, knockback along path | Declared with an arrow token a round early |
| Telegraphed (Red Cube) damage | 5 per cube hex | Detonates one round after placement |
| Fall damage | 3 | Grip 0 or knocked off when the Colossus stands |
| Exposed | +2 to every hit taken next round | From a whiffed Parry |
| Shield | Absorbs damage first, lost at round end | From Vanguard Anchor Stance |

## Turn sequence and resolution order

A round has four steps; the reveal resolves in a fixed order so every collision has one answer.

1. **Boss locks.** The Colossus places 2 cards face down behind the screen, plus any new Red Cubes face up on the board.
2. **Hunters commit.** Hunters discuss openly, then each plays 2 cards face up. Hunters may not change cards after the last Hunter commits.
3. **Reveal and resolve**, in this order:
   1. Hunter movement (in seating order from the boss's left).
   2. Last round's Red Cubes detonate.
   3. Boss Quick Attacks resolve; Parries are checked here.
   4. Hunter attacks and abilities.
   5. Boss Charged Attacks and movement.
4. **Cleanup.** Check Armor for Shatter, Tumble state, Grip, Exposed and Shield expiry. The boss declares next round's Charged Attack with an arrow token.

Movement before cubes is what makes the telegraph fair: a Hunter who moves out of a lane is safe. Quick Attacks resolve after movement, so the boss is guessing where Hunters will end up, not where they started.

## Parry and Tumble

A Parry names one hex; it succeeds only if a Quick Attack lands there, and it costs you if nothing does.

**Parry card.** Play it with a move. At step 3.3, if a boss Quick Attack targets your final hex, it is deflected: no damage, the Colossus takes a Short Tumble and its declared Charged Attack is cancelled. If no Quick Attack targets your hex, you whiffed and are Exposed next round.

The whiff penalty is what makes Parry a read. Without it, four Hunters standing still with Parry make every Quick Attack backfire.

|  | Short Tumble | Long Tumble |
| --- | --- | --- |
| Caused by | Successful Parry | Armor Shatter (Armor reaches 0) |
| Climb window | 1 Hunter (the parrier, or an adjacent ally they pick) | Every adjacent Hunter |
| Duration | Colossus stands at the end of next round | Colossus stands at the end of the round after next |
| Armor | Unchanged | Resets to full when it stands, +2 per strike so far |
| Feel | The flashy individual read | The team payoff for grinding |

While Tumbled, the Colossus still plays 2 cards but may only play Quick or Telegraphed cards; Charged cards are locked.

## Climbing phase

Climbers stay on when the Colossus stands up; each extra round they hold on is a chance at another strike, paid for in Grip.

**Body board.** The vertical schematic has 3 tiers: Legs (entry), Back, and Head. Vital points sit on the Back (1 point) and Head (2 points). Each tier holds 2 nodes.

1. **Mount.** During a Tumble, an adjacent Hunter plays Climb & Strike: place them on a Legs node at Grip 6.
2. **Climb.** On the body, any movement card moves 1 node instead of hexes. Each move costs 1 Grip.
3. **Strike.** An attack card played on a vital node scores that node's points. The node is then spent until the Colossus Tumbles again.
4. **Hold on.** While the Colossus is standing, each climber loses 1 Grip at cleanup. Body Thrash targets a node: 3 damage and -3 Grip.
5. **Fall.** At Grip 0, the climber falls to a random adjacent ground hex and takes 3 damage. A climber may also jump down safely on their own turn.

The Colossus's tension: every card spent on Body Thrash is a card not spent herding the ground team. The Hunters' tension: a climber at the Head scores 2, but the ground team must survive without them.

## Dice, Rest and Super Rest

Five bounded dice; the only change from v2.4 is the Bard's pull die.

| Die | Faces | Average | Used by |
| --- | --- | --- | --- |
| Slasher d4 | 0, 0, 1, 1 | 0.5 | Quick Slasher |
| Standard d4 | 0, 1, 1, 2 | 1.0 | Marksman, Bard, baseline |
| Upgraded d4 | 1, 1, 2, 2 | 1.5 | Vanguard, upgrades |
| Heavy d8 | 0, 2, 3, 4 (each twice) | 2.25 | Vanguard |
| Pull d6 | 2, 2, 2, 3, 3, 4 | 2.67 | Bard Rescue Beam |

**Standard Rest** (cards still in hand): reclaim your discard pile, burn 1 card, recover 2 HP. The Colossus instead restores 2 Armor.

**Super Rest** (Rest is your last card): reclaim, burn 1 card, recover 4 HP, and upgrade one die one step (Slasher → Standard → Upgraded). Each Hunter can take at most 2 upgrades per game; after that, Super Rest gives +1 max HP instead.

**Colossus Super Rest**: restore 4 Armor and place 1 free Red Cube.

The cap keeps the snowball to about +1 average damage per Hunter. The burn makes Resting early a real decision instead of a free heal.

## Escalation

Each Vital Strike point scored makes the Colossus harder, so the last strike is the hardest one.

- **Armor:** full Armor rises by 2 per point scored (16 → 18 → 20… in 1v4).
- **Rage cards:** shuffle 1 Rage card from a separate 4-card Rage deck into the Colossus deck per point.
- **Final phase:** at one point from defeat, the Colossus flips its screen side to "Enraged": it locks 3 cards per round instead of 2, but must reveal one of them face up.

Rage deck (4 cards):

- **Stomp Quake:** every hex adjacent to the Colossus takes 2 damage. Climbers lose 2 Grip.
- **Roar:** all Hunters are pushed 2 hexes away. Cancels Parries this round (no whiff penalty).
- **Wild Thrash:** two Quick Attacks this round instead of one.
- **Shell Harden:** gain 4 Armor; Hunter attacks this round deal half damage, rounded down.

## Colossus deck

The 14-card deck is built around one combo: cubes herd Hunters toward safe hexes, and blind Quick Attacks punish the hexes they will flee to. Five telegraph cards (36%) feed that combo.

| Card | Copies | Type | Effect |
| --- | --- | --- | --- |
| Tri-Cone Blast | 2 | Telegraphed | 3 cone lanes of 3 hexes; 5 damage per hex next round |
| Line Burst (new) | 2 | Telegraphed | One straight 5-hex line from the Colossus; 5 damage next round |
| Ring Slam (new) | 1 | Telegraphed | Every hex at distance 2 from the Colossus; 5 damage next round |
| Quick Swipe (new) | 2 | Quick | 1 adjacent ground hex: 3 damage, knockback 2 |
| Body Thrash | 2 | Quick | 1 ground hex or body node: 3 damage, -3 Grip |
| Feint (new) | 1 | Quick | Looks like a Quick Attack; does nothing, but every Hunter who Parried is Exposed |
| Charge Forward | 1 | Charged | Surge to the board edge: 4 damage and knockback in path |
| Tail Sweep (new) | 1 | Charged | Every hex on the back half of the ring: 4 damage |
| Blasting Shell | 1 | Quick reaction | If all but one Hunter attack: reflect 2 to each and gain 3 Armor. Otherwise lose 2 Armor |
| Rest | 1 | — | Standard or Super Rest |

Cube budget: a full turn of Tri-Cone uses 9 of the 30 cubes, so the boss cannot stack more than three big telegraphs at once.

## Hunter classes

After changes, the three damage classes average 3.0 to 5.3 per attack, the Bard trades damage for saves, and each has one tense decision of its own.

| Class | Dice | Avg per attack | Identity decision |
| --- | --- | --- | --- |
| Quick Slasher | 6x Slasher d4 | 3.0, rising to 4.5 with a 3-turn streak | Keep the streak alive or dodge |
| Range Marksman | 4x Standard d4 | 4.0 | Safe range vs moving into position |
| Heavy Vanguard | 2x Upgraded d4 + Heavy d8 | 5.3 | Stance (safe) vs Sledge (damage) |
| The Bard | 2x Standard d4 + 2x Pull d6 | 2.0 | Save an ally vs heal the group |

**Quick Slasher.** *Momentum:* each consecutive round you attack the Colossus adds +1 Slasher die (max +3). The streak resets when you take damage or skip an attack. *Infinite Vector Dash* rolls 4 dice plus Momentum. *Vault Over Colossus* unchanged.

**Range Marksman.** *Arrow Volley:* Bleed applies only if two or more dice show 2 (26% of volleys). Bleed removes 1 Armor at each cleanup for 2 rounds and does not stack. *Grapple Reposition* unchanged.

**Heavy Vanguard.** *Anchor Stance:* if a Quick Attack targets you, block it and grant +3 Shield to every adjacent ally. It does **not** cause a Tumble; only a positional Parry card does. *Sledge Shatter* unchanged (3 + Heavy d8 to Armor).

**The Bard.** *Rescue Beam:* target an ally within 5 hexes, roll the Pull d6 and pull them up to that many hexes toward you (50% chance of 3+). *Harmonic Hymn* unchanged.

## Pacing and playtest checklist

Target: 45-60 minutes, which means 14-18 rounds at about 3.5 minutes each.

Simulated with 4 Hunters and roughly half of played cards being attacks: the team deals about 7 Armor per round, so 16 Armor breaks in about 2.8 rounds. With one Long Tumble cycle per 4 rounds and Parry Tumbles adding a strike every few cycles, 5 points lands near round 16.

Track these in every playtest:

- [ ] Rounds per Vital Strike point (target 3-4)
- [ ] Successful Parries per game (target 2-4; under 1 means Feint and whiffs are too scary)
- [ ] Hunters Exhausted by the fatigue clock (target: rare, but close calls common)
- [ ] Rounds a climber stays on the body (target 1-3)
- [ ] Turn time per round (target under 3.5 minutes; over that, add a sand timer to Hunter commit)
- [ ] Final-strike moment: did the table cheer?

Open question: whether Head nodes worth 2 points end games too abruptly in 1v3.

## Components

v2.5 adds 4 Rage cards, Grip and status trackers, and changes 2 dice faces.

- 1 Main Ground Arena Board (10x10 hex grid)
- 1 Vertical Colossus Schematic Board (3 tiers, 6 nodes)
- 1 Custom Boss Screen (Calm side / Enraged side)
- 17 custom dice, one full pool per class (v2.4 listed 12, too few for all four pools): 6 Slasher d4, 6 Standard d4, 2 Upgraded d4, 1 Heavy d8, 2 Pull d6 (faces 2, 2, 2, 3, 3, 4)
- 30 translucent red acrylic cubes
- 4 Hunter miniatures and 1 Colossus miniature (7-hex base)
- 5 class decks (10 cards each) and 1 Colossus deck (14 cards)
- 4 Rage cards (new)
- 4 Hunter boards with HP and Grip dials (new)
- Exposed, Shield, Bleed and Charged-arrow tokens (new)
- 1 Armor and Vital Strike track (new)
