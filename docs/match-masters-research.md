# Match Masters (Candivore) - Rules Research for a Rules-Faithful Clone

Researched 2026-10-23. Scope: rules only, no art. Every rule bullet starts with the placeholder `[STATUS?]` for the engineer to replace with "Implemented" or "Left out". Bracketed numbers like [1] refer to the Sources section at the end.

## Summary

Match Masters is a live 1v1 turn-based match-3 duel played on one shared **7x7 board with 6 piece colors**. A match is a fixed number of **rounds (most recent sources: 5)**; in each round both players take one timed turn (**~30 s**, timer pauses during animations) consisting of **2 moves** (swaps that form a match of 3+). **Each piece removed is worth 1 point**; the highest total after the last round wins. Matching **4+ pieces of one color grants an extra move** and creates a special piece (4 in a line = Arrow, 5 in a line = Lightning, 5 in an L/T = Bomb). The two player-owned piece colors (your **blue stars**, the opponent's **red circles**) charge each side's pre-picked **Booster** (6 or 7 pieces to charge); activating a charged booster costs no move. Each player also brings **2 one-use Perks** (Hammer and Shuffle are free). The official rules are spread across the Candivore Help Center and "Match Masters Academy" videos (both queried directly); an analyst deconstruction (Naavik) supplies the board size and timer. Genuine gaps: tie handling in 1v1, exact bomb radius, dead-board reshuffle, exact extra-move cap, and swap/animation details.

Reading guide:
- Source tiers: (A) official Candivore help center or video, (B) analyst/press/guide articles, (C) fan wiki, creator videos, SEO guides. Tier is shown in the Sources list.
- Terminology: Candivore uses "turn" and "move" loosely. In this document a **round** = both players act once; a **turn** = one player's action window in a round; a **move** = one swap. Official modifier names mix them ("Sprint: three rounds, two turns"; "Triple Sprint: two rounds, three moves") [5].
- Some sources (the web port on CrazyGames, BlueStacks, old Talk Android guide) describe older or different builds; conflicts are called out inline.

---

## 1. Match format

- [STATUS?] A match is 1v1, live PvP, with both players acting in alternation on the same shared board; opponents are real players, with a computer-controlled fallback only when too few humans are available to start promptly. [51][59][61][37]
- [STATUS?] A match is divided into rounds; in each round each player gets one turn (2 moves by default, see section 2). The player with the most points after the last round wins (see section 10). [40][51][59]
- [STATUS?] Default number of rounds - uncertain: sources disagree and the game has changed over time. 3 rounds ([40], Academy #1, undated; possibly the oldest); 4 rounds ([52], April 2021 guide); 5 rounds ([50], a 2021 gameplay capture announcing "round one ... round four ... final round"; [59] and [60], 2025 articles). Recommended default for a clone: 5. [40][50][52][59][60]
- [STATUS?] Official modifiers override round and move counts, which implies defaults are longer than these presets: "4 Rounds" (four rounds), "5 Rounds" (five rounds), "Sprint" (three rounds, two turns), "Super Sprint" (two rounds, two turns, boosters cost half the energy), "Triple Sprint" (two rounds, three moves), "Tricky Triples" (three rounds, three moves). [5]
- [STATUS?] Who goes first is chosen at random each match, with no bias by league, trophies, or booster. [2]
- [STATUS?] Order within a round - uncertain: in the one captured full match [50] the same player (the narrator, "your turn") acts first in every one of the 5 rounds, with "opponent's turn" following. This suggests first-player is fixed for the whole match rather than alternating by round, but only one observation exists. [50]
- [STATUS?] Per-turn time limit: about 30 seconds ("each player gets two turns over a 30-second timer" and "the current 30-second timer", 2023 analyst article). Uncertain: a browser-port guide claims a 10-second timer, but that is the CrazyGames web port and a weaker source. The timer is shown as a depleting bar. [51][67][52]
- [STATUS?] Both players get the same amount of time each turn. [4]
- [STATUS?] In standard PvP the timer freezes during animations and booster activations (a "freeze feature"), so turns with many boosters or extra moves feel longer. In Showdown, Party, Match Rumble and Speed Solo the timer does NOT stop for animations or boosters (and in Rumble boosters cannot be activated once it hits 0). [4][20][21][23][39]
- [STATUS?] When the timer runs out the player loses their remaining move(s) and the turn passes to the opponent; the sources describe no further penalty. Official tips note it can be worth deliberately skipping a booster activation as time expires to keep it charged for the next round. [52][1]
- [STATUS?] Disconnect handling: if the opponent drops, a countdown clock shows and they have 30 seconds to reconnect or the other player wins by a technical win. [32]
- [STATUS?] Players can concede (leaving the match); a concede gives the other player a win and the maximum "landslide" star result. A white-flag emote alone is not a concede. [12]
- [STATUS?] Each player is always the "blue" player on their own screen and the opponent is always "red"; the colors are mirrored on the opponent's screen. [3]
- [STATUS?] Before the match each player picks one booster and two perks (sections 7-8); the loser of a ranked match loses the booster they brought, the winner keeps it. [51][15]

## 2. Turn structure and moves per turn

- [STATUS?] Each turn gives a player 2 moves. Confirmed by the official Academy video ("each player can make two moves per round"), the analyst deconstruction, a 2021 Talk Android guide, German press and a Chinese article. [40][51][52][59][60]
- [STATUS?] Variants: 3 moves per turn in "Triple Sprint" and "Tricky Triples"; Match Rumble uses a different move budget (a creator video says 5 moves per round - uncertain). The current move count is shown as a bubble indicator above the timer. [5][48][19]
- [STATUS?] A move is a swap of two adjacent pieces that must result in a match of 3 or more same-colored pieces in a row or column; the "Any Move" modifier ("swap freely, no match required") implies that the default rule requires a match. Swapping two special pieces together is also a legal move even when no 3-match exists (official tip: sometimes merging specials is the only move available). What happens visually/mechanically on an invalid swap is not documented. [5][1][42][55]
- [STATUS?] The board is shared: both players see the same board and every action changes it for both sides. Leftover special pieces (and any other unused matches) stay on the board and can be used by the opponent on their turn. [59][61][55]
- [STATUS?] Using a booster or a perk does not consume a move. [41][44][51][52]
- [STATUS?] Board state carries over between rounds (the same shared board continues; boosters stay charged between rounds). This is inferred from "keep your booster ready for the next round" and the shared-board descriptions rather than an explicit rule. [1][4][51]
- [STATUS?] A "booster activation" can happen any number of times in a turn as long as the bar is charged again (it empties on use and refills), unless a modifier such as "Limited Activations" (two per round) applies. [1][41][5][55]
- [STATUS?] Showdown (1v1) and Match Rumble (10-50 players) are variants where players act simultaneously on their own boards within a time/move/round budget, not turn-based; Party is a similar multi-player, budgeted mode. [21][23][20][51]

## 3. Extra moves

- [STATUS?] Matching 4 or more pieces of the same color in a single match grants an extra move (that includes straight lines of 4 or 5, and 5-piece L/T shapes). Confirmed by the official Tips article, Academy videos and independent guides. [1][40][42][52][59][60]
- [STATUS?] Extra moves are announced in play (a voiced "Extra move!") and creators describe chains of consecutive extra moves as the game's signature moment. [50][47]
- [STATUS?] Cap on extra moves - uncertain, sources conflict. [52] says "the max number of moves is two, so you will just retain a move once you obtain the extra move" (i.e. the extra move refunds the spent move; the counter never exceeds 2). A Chinese source similarly says a 4-match "does not consume a move". A creator video says a 4-match gives "a third turn". A 2021 capture shows long uninterrupted chains. No source states an absolute chain limit. Engineering note (inference): "moves_left -= 1; if match_size >= 4 then moves_left += 1" satisfies all of these in the common case. [52][60][48][50]
- [STATUS?] The extra move comes together with a special piece when the match size warrants it (4 in a line -> Arrow, 5 in a line -> Lightning, L/T of 5 -> Bomb); the official Academy video shows "extra move" callouts for both the 4-match and the 5-match. [42]
- [STATUS?] Terminology quirk to avoid confusion: official strategy text also uses "extra moves" to mean *available 4+ matches sitting on the board* ("get rid of extra moves before activating your booster", "match the extra moves higher up on the board first so they do not disturb the ones below"). [1][47]
- [STATUS?] Whether an automatic cascade match of 4+ also grants an extra move is not documented. Cascades are rare by design. [51]
- [STATUS?] Mode-specific extra-move rules (all optional): "Extra Moves"/"Moves Extravaganza" (matching X pieces gives extra moves), "Square Match" (4 in a square gives an extra move and a Crosshair piece), "Match & Hatch" (each extra move also spawns a random special piece), Xtra Tile (Cloud City studio; matching on it gives an extra move with fewer than 4 pieces), Solo Cosmic Rush (extra moves give extra oxygen/time instead). [6][5][53][35]
- [STATUS?] The booster Brocco Boogie's disco-ball swaps do not consume a move; a fan wiki also claims Cleo Cadabra's scarab copy gives a 70% chance of an extra move (low confidence). [10][54]

## 4. Scoring

- [STATUS?] Base rule: every piece removed from the board scores 1 point, regardless of how it was removed (a 3-match = 3, a 4-match = 4, and so on). Confirmed by official Academy ("each piece is worth one point"), analyst and guides. [40][51][52][55]
- [STATUS?] There is no separate size bonus or combo bonus in the base scoring; specials and boosters score only through the extra pieces they remove. Evidence: Firecracker removes 5 pieces = 5 points; Quack Attack (middle row) = 7 points; Laser Beam (a row plus a column on 7x7) = 13 points; Lil' Dragon / Balloon Blast (3 columns) up to 21 points; UFO about 16 points. [51][54] (Uncertain: a BlueStacks guide says specials "grant bonus points" - probably just the extra pieces destroyed. [55])
- [STATUS?] Cascades and chain reactions score the same 1 point per piece removed; the design intentionally makes auto-cascades uncommon (7x7 board, 6 colors, Lightning removing random pieces instead of a color). [51]
- [STATUS?] Standard PvP has no score multiplier that grows late in the match. The strategy guidance for the final turn is only "your last turn is your last chance" (no last-turn bonus). Multipliers exist only as optional modifiers (below). [47][6]
- [STATUS?] Optional modifiers that change scoring (all mode-specific): Rainbow (each color scores differently), Gimme Greens (green = 5), Jungle Jam (green leaves = 3), Yummy Yellows (only yellow scores), Hot Color (colored pieces worth 2/3/4/5 for green/orange/purple/yellow), Mushrooms / Multiplier Madness / Color Climb / Moves Multiplier (resets each round) / Rounds Multiplier / Column Mania / Vertical Rush / Lights Up / Vegas Views (x3 on highlighted spots) / Score Market / Crazy Columns / Bullseye Bash, Best Turn Wins (only your best turn counts), Win by Rounds. [5][6][17][10]
- [STATUS?] Per-color score table - partly uncertain: the official Rainbow modifier only says "each color has a different score". The values green 2 / orange 3 / purple 4 / yellow 5 appear in the Froggy Fu lotus description (which also says points double in Rainbow games) and in the fan wiki's Hot Color description; a creator in a Rainbow-type game says "triangles are worth five each" (yellow triangle). Blue/red are presumably 1. [5][10][54][48]
- [STATUS?] Final score is the sum over all rounds of the points a player earns on their own turns (including points from specials triggered by their moves and boosters). Points are not removed or transferred; the opponent never loses points except in Knockout, where points damage the opponent's health bar. [51][19]

## 5. Special pieces

- [STATUS?] Arrow (a.k.a. "Line Clear", "Column/Row Exploder"): created by matching exactly 4 in a straight line. The orientation follows the matched line (horizontal match -> horizontal arrow, vertical match -> vertical arrow). When the arrow is included in a match of 3+ of its color, it clears its entire row (horizontal) or column (vertical). [1][42][52][53] (Uncertain: BlueStacks wording about left/right/top/bottom placement is garbled. [56])
- [STATUS?] Lightning (the analyst notes it is deliberately NOT a classic color bomb): created by matching 5 in a straight line (horizontal or vertical). When activated it zaps random pieces on the board - 12 random pieces per the 2023 analyst, 13 per the fan wiki (uncertain; plausibly 12 random pieces plus the lightning piece itself). It does not clear one color. [1][51][53][52]
- [STATUS?] Bomb: created by a 5-piece L or T shaped match. When activated it blasts the pieces around it. The exact radius is not stated in any source ("several pieces around", "all pieces within its radius"; the fan wiki says "nearby pieces"). Part of the blast is wasted at a board edge, so it is best used mid-board. [1][42][52][56][53]
- [STATUS?] Creation priority for shapes beyond those listed (6+ in a line, plus-sign crosses, multiple simultaneous matches) is not documented; the official tip only says L/T/more-than-four produce different specials. Uncertain. [47][53]
- [STATUS?] Crosshair: 4 pieces in a 2x2 square; only exists in the optional "Square Match" mode, where it also grants an extra move. [1][5][53]
- [STATUS?] Specials stay on the board, retain the color of the pieces that created them, and are triggered either by (a) including them in a 3+ match of their color or (b) swapping them with another special of ANY color. [52][1][55]
- [STATUS?] Special pieces can chain: an activated special's blast can trigger another special inside its area. [55][56]
- [STATUS?] Any blue pieces caught in a special's blast charge your booster (and red pieces charge the opponent's). [1]
- [STATUS?] An unused special sitting on the board can be used by the opponent on their next turn. [55]
- [STATUS?] Modifier-controlled behavior: "Blow 'Em Up" (specials explode immediately when created), "Special O Rama" (every match creates a special), "Lightning Strike" (all special matches create lightning). [5]
- [STATUS?] Mode- or studio-specific pieces (optional, for reference): Leaf (3 points), Outlaw (points + booster energy), Firework, purple Gem (score grows on each match), Treasure Chest (5 booster energy when it reaches the bottom), Candy/jelly bean (matches both red and blue), Mushroom (multiplier), Hot Color, Crystal (clears its color), Funky Tile (neighbors explode), Xtra Tile (extra move), Laser Beam (passive). [53][17][6]

## 6. Special combos

- [STATUS?] General rule (official): you may swap/combine two special pieces even if they are different colors; this triggers BOTH specials' effects and also collects blue pieces in the radius for booster charge. This also applies to booster-created pieces (Billie Boom's bombs, Monkey Joojoo's skulls, Vinnie Valentine's hearts). [1][47]
- [STATUS?] Arrow + Arrow: clears a row and a column in a cross shape (one row and one column through the swap point). BlueStacks phrases it as "two rows, two columns, or both in a cross, depending on how matched". [52][56][53]
- [STATUS?] Arrow + Bomb: clears three rows or three columns at once (direction follows the arrow) - single-source and from a 2021 blog guide, so uncertain; the official wording ("triggers both specials' effects") could also mean a plain sum of both effects. [52][1]
- [STATUS?] Bomb + Bomb: a much larger explosion radius than a single bomb (no size given). [52]
- [STATUS?] Lightning + Lightning: zaps double the number of random pieces (fan wiki, low confidence). [53]
- [STATUS?] Arrow + Lightning, Bomb + Lightning: no authoritative Match Masters source found. The blog author only guesses "random pieces become arrows". Treat as unknown. [52]
- [STATUS?] Tactical note from the official guide: Lightning is best used when it can hit several other specials, because it can then clear most of the board; clear remaining 4+ matches first. [56]
- [STATUS?] The Detonator perk activates ALL special pieces on the board simultaneously (needs at least one special on board). [8]

## 7. Boosters

- [STATUS?] Each player chooses exactly 1 booster before the match from their owned collection (30+ exist; the store lists "20+"). Each player's booster has its own charging bar (blue stars for yours, red circles for the opponent's). (The Booster Stakes Multiplier lets players risk 2-5 boosters for multiplied rewards but the boosters "will be used normally in game", i.e. still only one active.) [51][61][14]
- [STATUS?] Charging: each blue star piece you clear fills your booster bar (the opponent charges theirs by clearing red circles). A booster costs 6 or 7 pieces to charge: Firecracker, Quack Attack and Sweep It cost 6, everything else listed costs 7. Costs change over time and by mode, so keep them as data. [61][41][51][9][10][11][54]
- [STATUS?] Any removal of your blue pieces counts, including as a side-effect of specials or boosters (Brocco Boogie: a direct match between a disco ball and a blue piece does not charge, but blues removed as collateral do). [1][10]
- [STATUS?] When the bar is full the player can activate the booster on their own turn; it empties and starts refilling; activation costs no move. A booster can be re-activated repeatedly if the bar refills ("snowballing", e.g. UFO SE clearing blues recharges itself). [41][1][51][55]
- [STATUS?] Players also clear the opponent's color to deny charging: matching red circles prevents the opponent from charging, which is a core tactic. [41][47]
- [STATUS?] Fan wiki claim: charge over the required amount is wasted (a full bar gains nothing from further stars). Low confidence. [54]
- [STATUS?] Booster effects are randomized per activation, so identical activations yield different results. [37]
- [STATUS?] Booster tiers from the official help center: Bronze (Firecracker, Color Splash, Quack Attack), Silver (Crazy Rocket, The Jelly, Mystery Hat), Gold (Laser Beam, Lil' Dragon, Mastermind, Magic Wand, Sweep It!, Balloon Blast), Diamond 1 (High Voltage, Crazy Clovers, Mr. Appleberry, Colonel McQuack), Diamond 2 (Foxy Roxy, UFO, Queen Cobra, Butler Bot, All Aboard), Diamond 3 (Woolly Workout, Doctor Color, El Magneto, Vinnie Valentine, Checkmate Charles), Legendary (Monkey Joojoo, Billie Boom, Brocco Boogie, Cleo Cadabra, Mixy Meow, Froggy Fu), plus Special Edition (SE) upgrades of Jelly, Sweep It, El Magneto, Doctor Color, All Aboard, UFO, Vinnie Valentine, Foxy Roxy. [9][10]
- [STATUS?] Consumption: losing a match consumes the booster you brought (winner keeps theirs); Booster Shields prevent that loss; free Bronze boosters regenerate over time. [51][15]
- [STATUS?] Example - Firecracker (Bronze, 6 pieces): fireworks fall at a random spot and explode for a small blast; the fan wiki says a 5-piece plus shape = 5 points. Starter booster. [9][54][51]
- [STATUS?] Example - Quack Attack (Bronze, 6): a duck sweeps the centre row (row 4 of 7, 7 points). [9][54][51]
- [STATUS?] Example - Sweep It! (Gold, 6): sweeps all pieces of one random color to the side, setting up matches and specials. [9][54]
- [STATUS?] Example - Color Splash (Bronze, 7): repaints some random pieces with a random color, possibly creating automatic matches and specials. [9]
- [STATUS?] Example - Crazy Rocket (Silver, 7): one big explosion removing every piece in the blast. [9]
- [STATUS?] Example - The Jelly (Silver, 7): choose a piece; jelly spreads from it and removes every piece it covers. [9]
- [STATUS?] Example - Mystery Hat (Silver, 7): pops out 3 special pieces that vanish at the end of your turn if unused. [9][54]
- [STATUS?] Example - Laser Beam (Gold, 7): choose a row and an adjacent column to eliminate (13 points on 7x7). [9][51]
- [STATUS?] Example - Lil' Dragon (Gold, 7): after activation you make a match and the dragon burns pieces around it (fan wiki: 3 columns/21 points; horizontal burns left-to-right, vertical top-to-bottom). [9][54]
- [STATUS?] Example - Magic Wand (Gold, 7): pick a color and remove every piece of it. [9]
- [STATUS?] Example - Mastermind (Gold, 7): an owl finds and makes matches for you. [9]
- [STATUS?] Example - Balloon Blast (Gold, 7): wipes a random portion of random columns. [9]
- [STATUS?] Example - High Voltage (Diamond 1, 7): pick a piece; every piece of the same color in its row or column is zapped (needs at least 2 such pieces). [10]
- [STATUS?] Example - UFO (Diamond 2, 7): abducts random colors from the board (about 16 points). [10][51]
- [STATUS?] Example - Doctor Color (Diamond 3, 7): converts one color into another to create big same-color groups and specials (SE: +32 points reported). [10][51]
- [STATUS?] Example - Queen Cobra (Diamond 2, 7): copies columns next to the originals. [10]
- [STATUS?] Example - Billie Boom (Legendary, 7): robot removes a random color, then bombs drop after every move you make that turn. [10]
- [STATUS?] Example - Monkey Joojoo (Legendary, 7): skulls travel across the board, removing every piece they touch; a new skull replaces each exploded one. [10]
- [STATUS?] Example - Brocco Boogie (Legendary, 7): clears a few pieces then spawns disco balls; sliding a disco ball toward a color clears all of that color and costs no move. [10]
- [STATUS?] Example - Froggy Fu (Legendary, 7): kicks out pieces then lotus flowers appear; matches inside a lotus score green 2 / orange 3 / purple 4 / yellow 5 per piece. [10]
- [STATUS?] Using a booster never costs a move; some boosters require a follow-up choice (pick a piece, color, column) as part of the activation. [41][51][9][10]
- [STATUS?] Optional charge modifiers: Boosted (-1 cost), Super Sprint (half cost), Ramp Up (cost rises with each activation), Limited Activations (max 2 per round), Rainbow Energy (colors charge differently), Red Alert (red matches charge the opponent), Shared Energy (blue and red both charge you), Energized (two random colors charge the bar). [5][6]

## 8. Perks

- [STATUS?] Each player picks 2 perks per match; each perk can be used once per match; using a perk never costs a move. [7][1][44][51]
- [STATUS?] Hammer (remove one chosen piece) and Shuffle (reshuffle all pieces) are the two free default perks; everything else is a premium perk acquired with coins/prizes and unlocked by trophies/league. [7][8][54]
- [STATUS?] Perk consumption - uncertain, sources conflict: the help center says unused perks are not removed from inventory, the Academy video says premium perks are deducted once the match begins even if unused, and the fan wiki says free perks are never lost but premium ones are lost on a loss. [7][44][54]
- [STATUS?] "Perk Reload" modifier reloads perks at the start of each round. [5]
- [STATUS?] Perks that spawn board advantages (closest analogue to "start with specials / extra charge"): Create Lightning (2 lightning pieces), Bomb Delivery (a bomb in the middle of the board), Star Maker (adds blue stars, can create blue specials), Energy Boost (next match of ANY color charges the booster as if it were blue), Detonator (activate all specials). All are activated manually during your turn, not granted at match start. [8]
- [STATUS?] Other perks: Mini Mastermind (rearranges pieces into several matches; fan wiki: up to 3), Mini Wand (remove all pieces of a random color), Mini Cobra (clone a chosen column to its right, or left if rightmost), Mini Cleo (scarab duplicates a chosen piece), Checkerboard (two random colors in a checkerboard pattern), Teleport (swap any two pieces), Remove Cross (clear the row and column of a chosen piece). [8][54]
- [STATUS?] Third-party trophy unlock thresholds for perks (low confidence): Mini Mastermind 675, Bomb Delivery 900, Create Lightning 1,500, Detonator 1,950, Mini Wand 2,425, Remove Cross 2,950, Energy Boost 3,400, Star Maker 4,000, Teleport 6,000, Mini Cobra 10,000, Checkerboard 16,000, Mini Cleo 30,000. [64]

## 9. Board

- [STATUS?] Board size is 7 columns x 7 rows. Stated by the analyst deconstruction and corroborated by point values: Laser Beam (one row + one column) = 13 = 7+7-1; three columns = 21 = 3x7; middle row = 7. A "Super Sized" modifier exists with a larger board (dimensions not given). [51][5][54]
- [STATUS?] 6 colors/shapes: the two player-owned pieces (blue star = you, red circle = opponent) plus four neutral colors - green, orange, purple, yellow (fan wiki shapes: purple square, green rhombus, yellow triangle, orange inverted triangle). "5 Colors" removes one color; "7 Colors" adds white. [51][5][3][54][10]
- [STATUS?] Gravity pulls pieces down and new pieces enter from the top; "Anti Gravity" is a modifier that reverses this. [51][5]
- [STATUS?] Cascades (auto-matches after refill) can occur but are unlikely, which gives players control; whether the generator suppresses cascades or it is just probability is not stated. [51]
- [STATUS?] Showdown starts both players on the same starter board; in PvP the initial layout is the same for both because the board is shared. [21]
- [STATUS?] Obstacles/blockers: none in the base rule set. Optional modifiers add frozen pieces, zappers, funky tiles, jelly zones, skulls, hearts, bandits, treasure chests, etc. Studios (themed arenas) each add one mixer, unlocked by trophy count. [5][6][17]
- [STATUS?] No-move boards - uncertain: no source describes automatic reshuffling. The only documented tools are the manual Shuffle perk and the official note that sometimes the only available move is to merge specials. A clone needs its own dead-board policy. [8][1]
- [STATUS?] Pieces matched or removed by any effect (specials, boosters, perks) are refilled the same way as normal matches. [51]

## 10. Win condition and ties

- [STATUS?] The player with the highest total score after the final round wins. [51][59][60]
- [STATUS?] Ties in a 1v1 match - not documented in any source found. Known tie handling elsewhere: event leaderboards (Star Race, Score Smash, Fire Starter) rank the player who reached the score first higher; Party mode shows the correct finishing position on ties; Match Rumble has a tiebreaker round whose points do not count for the leaderboard. No evidence of sudden death in standard 1v1. [36][23]
- [STATUS?] Winner receives trophies, stars and coins and keeps their booster; loser loses trophies and the booster used (unless shielded) and still gets 1 star. [51][12][15]
- [STATUS?] Stars: win = 2 stars; "Landslide" win = 3 stars when beating the opponent by more than 30% of their score (older sources say "by over 30 points"); loss = 1 star (no star if you concede or lose via technical issue; older Academy said a loss by 10+ points gave 0). [12][43][52]
- [STATUS?] Trophy deltas: roughly +25 to +50 for a win and -5 to -15 for a loss, scaled by rank and by opponent trophies and booster rarity (older: +25/-5). [51][52]
- [STATUS?] Coin rewards for a win scale by the defeated opponent's booster tier: below Grand Master 5/10/15/20/30 for Bronze/Silver/Gold/Diamond/Legendary-SE, doubled from Grand Master up. [13]
- [STATUS?] Alternate win conditions in optional modes: Knockout (points damage the opponent's health bar; first to 0 HP loses, landslide needs a 30% HP margin), Win by Rounds (most rounds won), Best Turn Wins (best single turn). [19][12][6]

## 11. Modes

- [STATUS?] Classic "Play" (ranked ladder): standard PvP for trophies; early game uses no modifiers, and modifiers/studios unlock progressively. Home screen also offers Daily Mode (Master league, 4,000 trophies) and Change Mode (Legend league). [28][17][51]
- [STATUS?] Daily Mode: each day a new combination of rules and up to three modifiers; trophies and event points still count. [6][28]
- [STATUS?] Game modifiers can be combined (up to three at once). Full list is in [5] and [6]; a clone's first modifiers could be rounds/moves variants (4 Rounds, 5 Rounds, Sprint, Super Sprint, Triple Sprint, Tricky Triples), 5/7 Colors, Square Match, Super Sized, Boosted, Limited Activations. [5][6]
- [STATUS?] Showdown: simultaneous 1v1 on the same starting board, each on their own timer; timer never stops. Overtime offer exists to buy extra moves/time after a loss (test only). [21][22]
- [STATUS?] Knockout: scoring depletes opponent health; first to 0 HP wins. [19]
- [STATUS?] Party: multi-player simultaneous; top 50% (green zone) keep boosters; 3 stars only for 1st. [20]
- [STATUS?] Match Rumble: 10-50 players, several rounds, bottom scores (red zone) eliminated each round; top 3 keep boosters; timer never stops. [23]
- [STATUS?] Tournaments: knockout brackets of 4/8/16/32 players, same booster and perks all tournament; individual matches count for stars and trophies unless marked unranked. [24][45]
- [STATUS?] Friendly challenges: private game code or link; no trophy gain/loss and no booster win/loss. [26]
- [STATUS?] Booster Clash (Saturdays, entry ticket): same-tier boosters; the winner keeps the loser's booster; shields do not apply. [25]
- [STATUS?] Adventure modes (lives and a level trail), Solo modes (Quest, Speed, Cosmic Rush, Perfect Heist, Score Rally, Mutation Lab, Booster Run), mini-games (Roll & Run, Matchinko, Space Chase, Token Rush) and team events (Team vs Team, Team Box, Star Heroes, Sticker Mania, Team Solo). [27][29][36][38][61]
- [STATUS?] No "Super Round" or end-of-match bonus turn exists in the sources; the only round-scaling rules are the "Rounds Multiplier" and "Moves Multiplier" modifiers. [6][47]

## 12. Progression and meta (clone should leave out)

- [STATUS?] Trophies set rank, unlock studios/modifiers, boosters and features; leagues (Master 4,000 / Grand Master 10,000 / Supreme Master 20,000 / Legend 30,000 / Supreme Legend 50,000 / Ultimate Legend 100,000+) with monthly seasons and promotion at rank 10. [18][17][51]
- [STATUS?] Currencies and collectibles: coins, stars, entry tickets, event points, lives, spins, piñatas, stamps, credits, sticker albums (trade/duplicates), outfits, showoffs, emotes, cosmetic capsules, badges. [29][30]
- [STATUS?] Boosters are an economy item: acquired from boxes/spins/events/store; Booster Shields, Booster Stakes Multiplier (x2-x5 rewards), On Fire (win 3 in a row: double trophies and coins), Premium Pass. [14][15][16][29]
- [STATUS?] Teams (chat, donation requests, weekly Team Box), star races and leaderboards, tutorial series "Match Masters Academy". [29][36][43]
- [STATUS?] Monetization: coin bundles, spins and offers; boosters purchasable. A clone has no need for any of this. [61][29]

## 13. Feel and presentation (copy in spirit, not assets)

- [STATUS?] Game-show theme (marketing uses a purple/pink palette), themed "studios" (arenas) per trophy tier, avatar outfits with voiced reactions (hello/happy/sad/angry) and six quick emotes (default set includes clap, hurry up, like, facepalm, swag, surrender); an opponent who gives up auto-plays the surrender emote and walks away. [51][30][54][12]
- [STATUS?] Turn hand-off is announced out loud and on screen: "Round N" -> "Your turn" -> "Opponent's turn" ... "Final round". Extra moves trigger a voiced "Extra move!" and the booster-full state triggers "Booster ready!". [50]
- [STATUS?] Timer: a bar that depletes; the opponent's timer is visible during their turn; a green clock indicates disconnect; the turn timer pauses while an animation or booster plays (except in the realtime modes). [52][32][4][33]
- [STATUS?] The booster bar: blue stars fill the player's bar and red circles fill the opponent's; both bars are visible; a booster character appears with a catch-phrase animation on activation (e.g. "Joo Joo Time!"), and effects play out before play resumes. [61][41][54]
- [STATUS?] Colors are always blue (you) vs red (opponent), and a Color Blind Assist toggle swaps to a high-contrast scheme; pieces also differ by shape. [3][31][54]
- [STATUS?] Score feedback: each turn's earned score pops up and stays visible; end screen shows a "You win" banner with star count and a cosmetic winning "showoff" animation. [36][29][54]
- [STATUS?] The swap animation, falling-piece physics and sound design are not documented in any source; copy from general match-3 conventions. (Gap.)

## 14. Gaps and conflicts at a glance

- Default rounds per match: 3 / 4 / 5 (5 most recent).
- Turn timer: 30 s (2023 analyst) vs 10 s (web-port guide).
- Extra-move cap: "max two, retain a move" vs "third turn" vs unbounded chains.
- Lightning count: 12 vs 13 random pieces.
- Bomb radius: unspecified. Arrow+Bomb: unverified single source.
- Ties in 1v1: unspecified. Dead-board reshuffle: unspecified.
- Perk consumption when unused: conflicting.
- First-player alternation across rounds: unknown beyond one capture.

---

## Sources

Tiers: (A) official Candivore; (B) analyst/press/guide; (C) fan wiki, creator video, SEO page. "Help Center" = candivore.zendesk.com/hc/en-us/articles/... (read directly through the Help Center's public pages/API on 2026-10-23, so contents were current as of the "updated" stamps in October 2026).

1. (A) Match Masters Tips and Tricks - https://candivore.zendesk.com/hc/en-us/articles/6793235546650-Match-Masters-Tips-and-Tricks - extra move on 4+, special-creation shapes, combine specials of any color, 2 perks, booster tips, last-turn guidance.
2. (A) How do you decide which player makes the first move? - https://candivore.zendesk.com/hc/en-us/articles/11322801467418-How-do-you-decide-which-player-makes-the-first-move - first player random.
3. (A) Why am I always on the blue side? - https://candivore.zendesk.com/hc/en-us/articles/11256851460762-Why-am-I-always-on-the-blue-side-Why-do-I-always-have-the-blue-pieces - you blue, opponent red.
4. (A) Different Timer/Round Lengths - https://candivore.zendesk.com/hc/en-us/articles/10915397660314-Different-Timer-Round-Lengths - equal time per turn; freeze during animations/boosters.
5. (A) List of Modifiers - https://candivore.zendesk.com/hc/en-us/articles/5365904366490-List-of-Modifiers - round/move presets, color counts, charge modifiers, special-piece modifiers.
6. (A) List of Daily Modes - https://candivore.zendesk.com/hc/en-us/articles/6277172215834-List-of-Daily-Modes - daily-mode modifiers and variants (Win by Rounds, Best Turn Wins, etc.).
7. (A) Perks - Explanation - https://candivore.zendesk.com/hc/en-us/articles/4449473012634-Perks-Explanation - 2 perks, free Hammer/Shuffle, inventory rule.
8. (A) Perk articles - Hammer https://candivore.zendesk.com/hc/en-us/articles/360019518059-Hammer ; Shuffle https://candivore.zendesk.com/hc/en-us/articles/360019518099-Shuffle ; Detonator https://candivore.zendesk.com/hc/en-us/articles/360019531620-Detonator ; Mini Mastermind https://candivore.zendesk.com/hc/en-us/articles/360019583039-Mini-Mastermind ; Mini Wand https://candivore.zendesk.com/hc/en-us/articles/360019458520-Mini-Wand ; Mini Cobra https://candivore.zendesk.com/hc/en-us/articles/5216729748122-Mini-Cobra ; Mini Cleo https://candivore.zendesk.com/hc/en-us/articles/5216713769626-Mini-Cleo ; Energy Boost https://candivore.zendesk.com/hc/en-us/articles/5216715052058-Energy-Boost ; Star Maker https://candivore.zendesk.com/hc/en-us/articles/360019456760-Star-Maker ; Create Lightning https://candivore.zendesk.com/hc/en-us/articles/360019583339-Create-Lightning ; Checkerboard https://candivore.zendesk.com/hc/en-us/articles/5216785409946-Checkerboard ; Teleport https://candivore.zendesk.com/hc/en-us/articles/360019531840-Teleport ; Remove Cross https://candivore.zendesk.com/hc/en-us/articles/5216784220826-Remove-Cross ; Bomb Delivery https://candivore.zendesk.com/hc/en-us/articles/360019521139-Bomb-Delivery - perk effects.
9. (A) Bronze/Silver/Gold booster articles - Firecracker https://candivore.zendesk.com/hc/en-us/articles/5238615861914-Firecracker ; Color Splash https://candivore.zendesk.com/hc/en-us/articles/5238568806938-Color-Splash ; Quack Attack https://candivore.zendesk.com/hc/en-us/articles/5237991131034-Quack-Attack ; Crazy Rocket https://candivore.zendesk.com/hc/en-us/articles/5238426114330-Crazy-Rocket ; The Jelly https://candivore.zendesk.com/hc/en-us/articles/5238390569370-The-Jelly ; Mystery Hat https://candivore.zendesk.com/hc/en-us/articles/5238293716122-Mystery-Hat ; Laser Beam https://candivore.zendesk.com/hc/en-us/articles/5238255682586-Laser-Beam ; Lil' Dragon https://candivore.zendesk.com/hc/en-us/articles/360019659960-Lil-Dragon ; Mastermind https://candivore.zendesk.com/hc/en-us/articles/360019700779-Mastermind ; Magic Wand https://candivore.zendesk.com/hc/en-us/articles/360019700759-Magic-Wand ; Sweep it! https://candivore.zendesk.com/hc/en-us/articles/360019700719-Sweep-it ; Balloon Blast https://candivore.zendesk.com/hc/en-us/articles/360019700699-Balloon-Blast - effects and "costs N pieces to activate".
10. (A) Diamond/Legendary/SE booster articles - High Voltage https://candivore.zendesk.com/hc/en-us/articles/360019660160-High-Voltage ; Crazy Clovers https://candivore.zendesk.com/hc/en-us/articles/360019700899-Crazy-Clovers ; Mr. Appleberry https://candivore.zendesk.com/hc/en-us/articles/360019709799-Mr-Appleberry ; Colonel McQuack https://candivore.zendesk.com/hc/en-us/articles/360019815819-Colonel-McQuack ; Foxy Roxy https://candivore.zendesk.com/hc/en-us/articles/360019770400-Foxy-Roxy ; UFO https://candivore.zendesk.com/hc/en-us/articles/360019660080-UFO ; Queen Cobra https://candivore.zendesk.com/hc/en-us/articles/360019764220-Queen-Cobra ; Butler Bot https://candivore.zendesk.com/hc/en-us/articles/360019668960-Butler-Bot ; All Aboard https://candivore.zendesk.com/hc/en-us/articles/360019709879-All-Aboard ; El Magneto https://candivore.zendesk.com/hc/en-us/articles/360019711259-El-Magneto ; Doctor Color https://candivore.zendesk.com/hc/en-us/articles/360019815699-Doctor-Color ; Woolly Workout https://candivore.zendesk.com/hc/en-us/articles/360019770420-Woolly-Workout ; Vinnie Valentine https://candivore.zendesk.com/hc/en-us/articles/360019770440-Vinnie-Valentine ; Checkmate Charles https://candivore.zendesk.com/hc/en-us/articles/5527644886682-Checkmate-Charles ; Monkey Joojoo https://candivore.zendesk.com/hc/en-us/articles/360019770460-Monkey-Joojoo ; Billie Boom https://candivore.zendesk.com/hc/en-us/articles/360020402519-Billie-Boom ; Brocco Boogie https://candivore.zendesk.com/hc/en-us/articles/4405415101466-Brocco-Boogie ; Cleo Cadabra https://candivore.zendesk.com/hc/en-us/articles/4943601891866-Cleo-Cadabra ; Mixy Meow https://candivore.zendesk.com/hc/en-us/articles/6664403959194-Mixy-Meow ; Froggy Fu https://candivore.zendesk.com/hc/en-us/articles/10721263732378-Froggy-Fu ; UFO SE https://candivore.zendesk.com/hc/en-us/articles/4419288346138-UFO-SE ; Doctor Color SE https://candivore.zendesk.com/hc/en-us/articles/4409444018586-Doctor-Color-SE ; Foxy Roxy SE https://candivore.zendesk.com/hc/en-us/articles/5216406065818-Foxy-Roxy-SE ; All Aboard SE https://candivore.zendesk.com/hc/en-us/articles/4414254932634-All-Aboard-SE ; El Magneto SE https://candivore.zendesk.com/hc/en-us/articles/4409370784154-El-Magneto-SE ; Vinnie Valentine SE https://candivore.zendesk.com/hc/en-us/articles/4410421030426-Vinnie-Valentine-SE ; Jelly SE https://candivore.zendesk.com/hc/en-us/articles/8498360198938-Jelly-SE ; Sweep It SE https://candivore.zendesk.com/hc/en-us/articles/7217312412570-Sweep-It-SE - effects, 7-piece costs, snowballing, disco-ball/no-move rule.
11. (A) Why did the activation cost of boosters change? - https://candivore.zendesk.com/hc/en-us/articles/11256878410138-Why-did-the-activation-cost-of-boosters-change - costs vary over time and by mode.
12. (A) Stars - https://candivore.zendesk.com/hc/en-us/articles/360019600139-Stars - stars per result, landslide at over 30% score margin, concede rules.
13. (A) Coins - https://candivore.zendesk.com/hc/en-us/articles/360019827339-Coins - coin rewards by defeated booster tier.
14. (A) Booster Stakes Multiplier - https://candivore.zendesk.com/hc/en-us/articles/6352690476314-Booster-Stakes-Multiplier-x2-x3-x4-x5 - risk 2-5 boosters for multiplied rewards; perks used once.
15. (A) Booster Shields - https://candivore.zendesk.com/hc/en-us/articles/4459933100954-Booster-Shields - shield protects booster on a loss.
16. (A) On Fire - https://candivore.zendesk.com/hc/en-us/articles/360019782980-On-Fire - 3-win streak doubles trophies/coins.
17. (A) Game Modes Unlocked - https://candivore.zendesk.com/hc/en-us/articles/9363812490266-Game-Modes-Unlocked - studios and trophy thresholds.
18. (A) Seasonal Leagues - https://candivore.zendesk.com/hc/en-us/articles/4410516827930-Seasonal-Leagues - league thresholds and season rules.
19. (A) Knockout - https://candivore.zendesk.com/hc/en-us/articles/8899151027482-Knockout - health-bar mode, moves bubble indicator.
20. (A) Party - https://candivore.zendesk.com/hc/en-us/articles/8896228231066-Party - top 50% keep boosters.
21. (A) Showdown - https://candivore.zendesk.com/hc/en-us/articles/7217395480346-Showdown - simultaneous play on same starter board.
22. (A) Showdown Overtime - https://candivore.zendesk.com/hc/en-us/articles/11155572062362-Showdown-Overtime - buy extra moves/time.
23. (A) Match Rumble - https://candivore.zendesk.com/hc/en-us/articles/4702557650458-Match-Rumble - green/red zones, tie-break round, timer never stops.
24. (A) Tournaments - https://candivore.zendesk.com/hc/en-us/articles/360019633139-Tournaments - bracket structure.
25. (A) Booster Clash - https://candivore.zendesk.com/hc/en-us/articles/4705552363802-Booster-Clash - winner keeps loser's booster.
26. (A) Challenging Friends - https://candivore.zendesk.com/hc/en-us/articles/360019546260-Challenging-Friends - friendly challenge, no booster loss.
27. (A) Adventure Mode - https://candivore.zendesk.com/hc/en-us/articles/360019588320-Adventure-Mode - lives and trail.
28. (A) Play Mode https://candivore.zendesk.com/hc/en-us/articles/360019633119-Play-Mode ; Daily Mode https://candivore.zendesk.com/hc/en-us/articles/360019588380-Daily-Mode ; Multiple Daily Modes https://candivore.zendesk.com/hc/en-us/articles/4702601002138-Multiple-Daily-Modes ; Game Modifiers https://candivore.zendesk.com/hc/en-us/articles/360019633219-Game-Modifiers - mode unlocks and modifiers.
29. (A) Currencies - https://candivore.zendesk.com/hc/en-us/articles/9913122404122-Currencies - full list of in-game currencies/items.
30. (A) Emotes - https://candivore.zendesk.com/hc/en-us/articles/4459940205466-Emotes - six default emotes, chat button.
31. (A) Color Blind Assist - https://candivore.zendesk.com/hc/en-us/articles/6518120100122-Color-Blind-Assist - high-contrast toggle.
32. (A) Opponent Plays Offline - https://candivore.zendesk.com/hc/en-us/articles/360019673879-Opponent-Plays-Offline - 30-second reconnect, technical win.
33. (A) Opponent Timer Visual Issues - https://candivore.zendesk.com/hc/en-us/articles/360019673899-Opponent-Timer-Visual-Issues - opponent's timer is visible.
34. (A) Booster Power Up - https://candivore.zendesk.com/hc/en-us/articles/10013694509466-Booster-Power-Up - limited-time upgraded boosters (left out).
35. (A) Solo Cosmic Rush - https://candivore.zendesk.com/hc/en-us/articles/4702613000730-Solo-Cosmic-Rush - extra moves give extra time in that solo mode.
36. (A) Recent Updates & New Versions - https://candivore.zendesk.com/hc/en-us/articles/10541323790106-Recent-Updates-New-Versions - release notes (tie display in Party, score pop-up in Showdown).
37. (A) FAQs - https://candivore.zendesk.com/hc/en-us/articles/11256836261274-Why-do-my-opponents-have-more-extra-moves ; https://candivore.zendesk.com/hc/en-us/articles/11256817511194-Are-there-any-bots-or-AI-opponents-in-Match-Masters ; https://candivore.zendesk.com/hc/en-us/articles/11256825401242-I-couldn-t-match-the-blue-pieces-How-can-I-use-my-booster ; https://candivore.zendesk.com/hc/en-us/articles/11256831250586-How-come-I-activated-my-booster-but-I-didn-t-get-any-good-moves-or-the-right-colors - bots fallback, booster randomness.
38. (A) Mutation Lab - https://candivore.zendesk.com/hc/en-us/articles/5636666988442-Mutation-Lab - per-round mutations (left out).
39. (A) Solo Speed - https://candivore.zendesk.com/hc/en-us/articles/9051995921050-Solo-Speed - faster timer.
40. (A) Match Masters Academy #1 (YouTube) - https://www.youtube.com/watch?v=ccvbCWEhMxw - official rules: two-player, three rounds, two moves per round, 1 point per piece, 4-match = extra move (captions read via YouTube).
41. (A) Match Masters Academy #2 - Boosters - https://www.youtube.com/watch?v=sb85NrREIz8 - blue stars charge, red circles charge opponent, no move cost, repeat use.
42. (A) Match Masters Academy #3 - Special Pieces - https://www.youtube.com/watch?v=8pVCmXMCChU - arrow/lightning/bomb creation and extra move.
43. (A) Match Masters Academy #7 - Stars - https://www.youtube.com/watch?v=MzBG9yG34_s - older star thresholds (30 points, 10 points).
44. (A) Match Masters Academy #20 - Perks - https://www.youtube.com/watch?v=-7tcMVDEIGM - two perks, once each, no move cost, premium perk deduction.
45. (A) Match Masters Academy #11 - Tournaments - https://www.youtube.com/watch?v=MvuFmlszokQ - tournament knockout structure.
46. (A) Academy #8 Trophies https://www.youtube.com/watch?v=pwFJr8ICt2c ; #18 Masters League https://www.youtube.com/watch?v=acTnkQOQ8ag ; #19 Star Levels https://www.youtube.com/watch?v=G7_4UdkG0Cw - trophy/league progression.
47. (A, probably official channel) Top 10 PRO Tips & Tricks to ALWAYS WIN in Match Masters! - https://www.youtube.com/watch?v=HEVUBe_ibf8 - extra move chains, combos of any color, last-turn advice, deny red pieces.
48. (C) Pro Tips and Tricks to Win Every Game in Match Masters (sponsored creator) - https://www.youtube.com/watch?v=0iZRRndYVhk - tournament 3 rounds x 2 turns, Rumble 5 moves, 4-match = third turn, triangle = 5.
49. (C) 5 Pro Tips & Tricks to Win More in Match Masters - https://www.youtube.com/watch?v=dC1bYXCS2k8 - timer keeps running in Showdown/Rumble.
50. (C) Match Masters, How to get more Extra Move, 12 Extra Moves (2021) - https://www.youtube.com/watch?v=atwoaLzvQOI - round announcements, "your turn/opponent's turn" order, 5 rounds, extra-move chain callouts.
51. (B) Match Masters: A Global Success No One Believed In (Naavik deconstruction) - https://naavik.co/deep-dives/match-masters-deconstruction/ - 7x7, 6 colors, 30 s timer, 1 point per piece, Lightning = 12 random pieces, booster/perk basics, trophies, rewards.
52. (B) Match Masters Guide: Tips, Tricks and Strategies - Talk Android (April 2021) - https://www.talkandroid.com/9244-match-masters-guide-tips-tricks-and-strategies/ - 4 rounds, move cap of two, point per piece, combos, trophies/coins/stars.
53. (C) Fan wiki - Special Pieces - https://match-masters.fandom.com/wiki/Special_Pieces - Column/Row Exploder, Lightning 13 pieces, mode-specific pieces (page text read through the wiki's api.php).
54. (C) Fan wiki other pages (read through the wiki's api.php): https://match-masters.fandom.com/wiki/Perks ; /wiki/Boosters ; /wiki/Firecracker ; /wiki/Quack_Attack ; /wiki/Sweep_It ; /wiki/Billie_Boom ; /wiki/Brocco_Boogie ; /wiki/Cleo_Cadabra ; /wiki/Mixy_Meow ; /wiki/Monkey_Joo_Joo ; /wiki/High_Voltage ; /wiki/Foxy_Roxy ; /wiki/Lil'_Dragon ; /wiki/Magic_Wand ; /wiki/Mystery_Hat ; /wiki/Paint_Bucket ; /wiki/Balloon_Blast! ; /wiki/The_Jelly ; /wiki/Checkmate_Charles ; /wiki/Valentine_Vinnie ; /wiki/Booster_Shield ; /wiki/Outfits_and_Showoffs ; /wiki/Match_Masters_Wiki - piece shapes, booster behavior details, 21-point values, emotes, surrender.
55. (B) BlueStacks - Beginner guide - https://www.bluestacks.com/blog/game-guides/match-masters/mmt-beginner-guide-en.html - two "turns" per round, 4+ extra turn, 1 point per tile, specials usable by opponent.
56. (B) BlueStacks - Combos guide EN https://www.bluestacks.com/blog/game-guides/match-masters/mmt-combos-guide-en.html and DE https://www.bluestacks.com/de/blog/game-guides/match-masters/mmt-combos-guide-de.html - special shapes, arrow+arrow, bomb/lightning tips.
57. (B) BlueStacks - Boosts and tools guide - https://www.bluestacks.com/blog/game-guides/match-masters/mmt-boosts-tools-guide-en.html - booster charging, activation takes no turn, Shuffle/Hammer as tools.
58. (B) BlueStacks - Tips and tricks - https://www.bluestacks.com/blog/game-guides/match-masters/mmt-tips-tricks-en.html - opened; only legacy rating-milestone and energy notes, no rules used.
59. (B) Giga.de - https://www.giga.de/games/match-masters-stellt-euch-match-3-duellen-in-echtzeit--01K8848E2Q2QCEZADP46XQ3FE1 (2 moves, 5 rounds, extra move for 4+) and https://www.giga.de/games/match-masters-mit-diesen-5-profi-tricks-meistert-ihr-jede-runde--01K8THDQPAF1AKCBQ4T1K95XXN (two actions per turn, few seconds per move).
60. (B) Baijing (Chinese) - https://www.baijing.cn/article/53749 - 5 rounds, 2 moves, specials, skill cards; sibling article https://www.baijing.cn/article/41021 was only seen in search results (the claim that a 4-match "does not consume a move" came from a search summary of the baijing results, unverified).
61. (A/B) App Store listing - https://apps.apple.com/app/1138264921 - blue stars/red circles, 20+ boosters, modes, version notes.
62. (C) matchmasterscoin.com booster list - https://matchmasterscoin.com/match-masters-booster-list/ - tier names only.
63. (C) simplegameguide.com booster list - https://simplegameguide.com/boosters-list-match-masters/ - tier names; "7 blue stars" claim.
64. (C) allloot perks list - https://allloot.com/match-masters-perks-list/ - perk unlock thresholds, free vs premium.
65. (C) buspins game modes - https://www.buspins.site/match-masters-game-modes/ - modifiers recap, timers.
66. (C) CrazyGames web port (a different product) - https://www.crazygames.com/game/match-masters-jiy - "4+ gives extra moves"; also describes sparks/Center Stage, not representative of mobile.
67. (C) browsergamers.gg - https://browsergamers.gg/game/match-masters - claims a 10-second timer (web port, low confidence).
68. (C) Yandex portal summary - https://portal.yandex.com.tr/yaozet/games/match-masters-game-strategy-guide-nTlYHjgp - low-value generic tips; no rule detail used.
