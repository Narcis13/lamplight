# Lamplight: No-Limit Hold'em 6-max, Backgammon and Gem Duel, multiplayer

People and bots at the same six-seat tables. Cash games at four stakes, Sit & Go tournaments, a
play-money bankroll that follows you around, full hand history with a replayer, lifetime stats,
achievements and a leaderboard. Next to the poker room there are backgammon boards: money games by
the point or matches to N, against a friend or a house bot, from the same lobby and the same bankroll.
And there is Gem Duel, a 1v1 turn-based match-3 in the style of Match Masters, against a friend or a bot.
A Bun server runs the games and keeps everything in SQLite. Browsers only draw what the server tells
them and send back their actions.

```sh
bun install
bun run dev        # http://localhost:3000, hot reload
bun run start      # production mode, same port (PORT=8080 bun run start to change it)
bun test           # poker, backgammon and gem duel engines, bots, and end-to-end network tests (real server, scripted players)
```

## What's in it

- **Cash tables** at $1/$2, $5/$10, $25/$50 and $100/$200. Buy-ins come out of your bankroll and your
  stack goes back into it when you get up.
- **Sit & Go tournaments**: six players, 1,500 chips each, blinds rising every few hands, first place
  takes 65% of the pool and second 35%. Register, and when the countdown ends (or someone presses
  **Start now**) bots fill the empty seats. The lobby always has one open.
- **Bankroll**: $10,000 to start, a daily bonus that grows with your streak, and free chips if you ever
  go broke. Chips on a table are held in escrow, so a server crash never costs anyone their stack.
- **Bots with personalities**: nine of them, from a rock to a maniac to the Professor. They play
  position-aware ranges, read the board, estimate your range from what you've done, and keep notes on
  how *you* play across sessions. They talk, too. Pick casual, regular or sharp bots per table.
- **Hand history and replayer**: every hand is saved. Replay any of them from the hand log or your
  profile, step by step. You only ever see cards that were shown, or that were yours.
- **Profile and leaderboard**: lifetime stats, a winnings graph, Sit & Go record, 20 achievements,
  what the bots think of your game, and the richest players and the bots' own records.
- **Run it twice** at cash tables: when everyone is all in with cards to come, each player is asked
  (bots answer by temperament). If all agree, the rest of the board is dealt twice from the same deck
  and each pot is split in half by run, the odd chip going to the first. Set **Run it twice** to Ask,
  Always or Never in Settings.
- **Time bank**: when your shot clock runs out, your time bank kicks in instead of folding you. It
  starts at 30 seconds (20 at turbo, 45 at relaxed), grows a little with every hand you're dealt, and is
  capped at twice its starting size.
- **At the table**: a pot-odds coach, win odds, emote reactions, chat bubbles, showing your cards after
  a hand, and some confetti when you hit something big.

## Backgammon

Switch the lobby's **Play** tab from Texas Hold'em to **Backgammon**.

- **Money games**: a stake per point ($10 to $1,000). You sit down with forty points' worth of chips;
  each game moves points × cube × stake from the loser to the winner, never more than the loser has in
  front of them. Gammons count double and backgammons triple.
- **Matches**: first to 1, 3, 5 or 7 points. Both players put up the entry and the winner takes both.
  Crawford rule, and a cube that is dead for the leader can't be turned.
- **The doubling cube**: double before you roll, take or pass when doubled, redoubles up to 64.
- **Against a friend or a bot**: open a board with *A friend* as the opponent and send the **Link**, or
  play a house bot (casual, regular or sharp). A bot holding a seat gives it to a person between games
  (between matches in match play).
- **Playing**: click a checker, then where it goes, or drag it; a checker can go the whole roll in one
  move. Double-click plays the bigger die. **Undo** takes back moves until you press **Done** (or turn on
  *Auto-confirm moves*). Keys: Space rolls or confirms, U undoes, D doubles, T/P take or pass.
- **Clocks**: 75, 45 or 25 seconds a turn (Relaxed, Normal, Turbo). Run out and the house plays that turn
  for you; twice in a row sits you out. Drop your connection and the board waits 90 seconds for you,
  then you forfeit. Leaving mid-game resigns it; leaving mid-match forfeits the match.
- **Resigning** gives your opponent what the game is worth right now: the cube, doubled for a gammon
  (nothing borne off yet) or tripled for a backgammon (a checker still on the bar or in their home board).
  The dialog tells you which before you confirm.
- Results go to your profile (record, gammons, points, money) and a Backgammon leaderboard, with five
  achievements of their own.

## Gem Duel

Switch the lobby's **Play** tab to **Gem Duel**. It follows the rules of Match Masters (researched, with
sources, in [`docs/match-masters-research.md`](docs/match-masters-research.md)), with its own look, boosters
and sounds, all drawn and synthesized in code.

- **One board, two players, turn by turn.** A 7x7 board of six kinds of gem. Classic is five rounds; in each
  round both players take one turn of two moves. Sprint is three rounds, Triples three rounds of three moves.
  Who goes first is drawn at random and stays the same every round.
- **A move** swaps two neighbours to line up three or more of a kind. Every gem cleared, by anything, is a point.
  A match of four or more gives you the move back. The highest score after the last round wins; a tie is a draw.
- **Specials**: four in a line makes an arrow (clears its row or column, along the line it came from), an L or T
  of five a bomb (the 3x3 around it), five in a line lightning (zaps twelve gems at random). They go off when
  matched, when caught in a blast, or when you swap two of them together for a combo: arrow+arrow a cross,
  arrow+bomb three rows or columns, bomb+bomb a 5x5 blast, lightning+lightning 24 zaps, lightning+arrow five
  arrows, lightning+bomb four bombs. Specials stay on the board for whoever uses them first.
- **Your colour.** The blue gems are yours and the red ones your opponent's (each player sees it that way round).
  Clearing your own colour on your turn charges your **booster**; clearing theirs keeps theirs empty. Pick one of six
  before the match: Ember Burst, Lantern Sweep (6 gems each), Twin Beams, Prism Wand, Volt Arc, Trick Hat (7).
  Boosters and the two **perks** (a Hammer for one gem and a Shuffle, once each per match) never cost a move.
- **Entries**: free, or $100 to $2,500 from your bankroll; the winner takes both, a draw gives both back.
- **Against a friend or a bot**: open a duel with *A friend* as the opponent and send the **Link**, or play a house
  bot (casual, regular or sharp). A bot holding a seat gives it to a person between matches.
- **Playing**: drag or swipe a gem onto a neighbour, or click one and then the other. B fires your booster, H picks up the
  hammer, S shuffles. Six emotes, chat and a match log.
- **The clock**: 45, 30 or 20 seconds a turn (Relaxed, Normal, Turbo). It stands still while the board plays out. Run
  out and you lose the rest of that turn; twice in a row and the house plays for you until you press **I'm back**.
  Drop your connection and you have 60 seconds to come back; leaving mid-match forfeits it.
- The server owns the board and every gem that drops in. Browsers only animate what it sends, wave by wave.
- Results go to your profile and a Gem Duel leaderboard, with four achievements of their own.

## Playing with other people

- **Same network:** start the server and have friends open `http://<your-computer's-LAN-IP>:3000`.
  The server listens on `0.0.0.0` by default (`HOST` changes that).
- **Over the internet:** run it on any host that has Bun (a VPS, Fly.io, Railway, Render…) behind HTTPS.
  WebSockets follow the page's scheme (`wss://` on HTTPS). For a quick test from home, a tunnel such as
  `cloudflared tunnel --url http://localhost:3000` gives you a public HTTPS link.
- In the lobby, **Link** copies a URL that drops a friend straight onto that table.
- Your **account** is a secret key in the browser's `localStorage`, shared by every tab. A **private
  window** is a different account, which is the easy way to play against yourself on one machine.
  Each tab still holds its own seat, and refreshing a tab keeps your seat.

## How a table works

- Six seats. A seat holds a person, a bot, or nobody. With "Fill open seats with bots" on (the default),
  a bot gets up whenever a person sits down, so the game stays six-handed.
- Seat changes, rebuys and leaving take effect between hands. Sitting down mid-hand saves the seat and
  deals you in on the next one.
- Every decision has a shot clock (15 to 30 seconds by table speed), then your time bank. Running out of
  both checks or folds for you; missing two turns in a row sits you out until you press **I'm back**.
- If you disconnect, your seat is held for 90 seconds; your turns are checked or folded meanwhile.
  In a running tournament your seat is held until you come back or bust.
- Cash hands only run while at least one person with chips is connected and not sitting out, so a table
  of bots never burns CPU on its own. Idle tables close after five minutes (the built-in ones stay).
- Other players' hole cards never leave the server until showdown. Watchers see only card backs.

## Data

Everything lives in one SQLite file, `data/lamplight.sqlite` (set `DB_PATH` to move it, `:memory:` for
a throwaway run). `START_BANKROLL` changes what new accounts start with. Stopping the server with
Ctrl-C cashes everyone out first; if it dies instead, the next start returns escrowed chips.

## Layout

| Path | What it is |
| --- | --- |
| `shared/engine.js` | Pure logic for both sides: cards, hand evaluator, equity, pots, stakes, tournament schedule, speeds |
| `shared/profiles.js` | The bot personalities |
| `shared/achievements.js` | The achievement list (the server awards them, the client draws them) |
| `shared/backgammon.js` | Backgammon rules for both sides: positions, legal moves (both dice, the larger-die rule, bearing off), turns with undo, gammons |
| `server/bgtable.js` | A backgammon board: two seats, money and match play, the cube, clocks, reconnects, bankroll moves |
| `server/bgbot.js` | The backgammon bot: scores every ending a roll allows (race, points, primes, shots) and makes cube decisions |
| `client/bg.jsx`, `client/bg.css` | The backgammon room: the board (SVG with animated checkers), players, controls, log and chat |
| `shared/match3.js` | Gem Duel rules for both sides: the board, swaps, matches, specials and combos, cascades, boosters, perks, turns, scoring, and the animation schedule |
| `server/m3table.js` | A gem duel: two seats, entries, the turn clock, reconnects, the server's own random refills |
| `server/m3bot.js` | The gem duel bot: tries every swap, booster target and the hammer on a copy with its own refills |
| `client/m3.jsx`, `client/m3.css` | The gem duel room: players, scores, booster meters, perks, banners, log and chat |
| `client/m3board.js`, `client/m3sfx.js` | The gem board on canvas (gems, effects, particles, swipe and click input) and its synthesized sounds |
| `docs/match-masters-research.md` | What Match Masters does, with sources, and which of it Gem Duel does |
| `server/game.js` | The authoritative engine: `Game`, `Player`, `HandLog`, and the per-hand record |
| `server/bots.js` | The bots' brains and the table's reads on every player |
| `server/table.js` | A table: seats, sockets, shot clock, reconnects, bankroll moves, Sit & Go lifecycle |
| `server/db.js` | SQLite: accounts, bankroll and escrow, hands, stats, achievements, tournaments, leaderboards |
| `server/index.js` | `Bun.serve`: HTML import for the client, `/api/tables`, `/api/leaderboard`, `/ws` |
| `client/app.js` | Mirrors server state and plays server events back in order, so animations never overlap |
| `client/view.js` | The table renderer (seat rotation keeps *you* at the bottom), sounds, drawer, celebrations |
| `client/panel.js` | Your controls: bet sizing, pre-actions, the clock, the pot-odds coach |
| `client/lobby.jsx` | The React lobby: bankroll, tables and tournaments, leaderboard, profile |
| `client/screens.jsx`, `client/replay.jsx` | Profile, leaderboard and the hand replayer |
| `legacy/` | The original single-player build this was split from |

The client works out your hand name and win odds locally from your own cards; nothing about other
players' cards is needed for that.

`bun run build` makes a prebuilt bundle in `dist/`; start it with `bun run start:dist` (it must run from
inside `dist/`). `bun run start` works without a build step.
