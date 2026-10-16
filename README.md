# Lamplight: No-Limit Hold'em 6-max, multiplayer

People and bots at the same six-seat tables. Cash games at four stakes, Sit & Go tournaments, a
play-money bankroll that follows you around, full hand history with a replayer, lifetime stats,
achievements and a leaderboard. A Bun server runs the game and keeps everything in SQLite.
Browsers only draw what the server tells them and send back their actions.

```sh
bun install
bun run dev        # http://localhost:3000, hot reload
bun run start      # production mode, same port (PORT=8080 bun run start to change it)
bun test           # engine, bots, and end-to-end network tests (real server, scripted players)
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
