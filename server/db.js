/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · database
   One SQLite file (bun:sqlite). Accounts and their play-money bankroll,
   every hand ever dealt (for history, stats and the replayer), lifetime
   stats, achievements, Sit & Go results, the bots' records, and the
   reads bots keep on each person.

   Money that sits on a table lives in `escrow`, one row per account per
   table. If the server dies mid-session, the next start returns every
   escrowed chip to its owner's bankroll, so nobody loses a stack to a crash.
   ════════════════════════════════════════════════════════════════════ */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { HandEval, Cards } from '../shared/engine.js';
import { ACH } from '../shared/achievements.js';

export const START_BANKROLL = Number(process.env.START_BANKROLL || 10_000);
const BONUS_EVERY = 20 * 3600_000; // the daily bonus, claimable once every 20 hours
const STREAK_WINDOW = 48 * 3600_000; // claim again within 48 hours to keep the streak
const REFILL_TO = 2_000, REFILL_BELOW = 100, REFILL_EVERY = 10 * 60_000;
const B5 = 759375, B4 = 50625;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  bankroll INTEGER NOT NULL, last_bonus INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0,
  last_refill INTEGER NOT NULL DEFAULT 0,
  hands INTEGER NOT NULL DEFAULT 0, vpip INTEGER NOT NULL DEFAULT 0, pfr INTEGER NOT NULL DEFAULT 0,
  pots_won INTEGER NOT NULL DEFAULT 0, showdowns INTEGER NOT NULL DEFAULT 0, showdowns_won INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0, biggest_pot INTEGER NOT NULL DEFAULT 0, best_score INTEGER NOT NULL DEFAULT -1,
  sng_played INTEGER NOT NULL DEFAULT 0, sng_won INTEGER NOT NULL DEFAULT 0, sng_cashes INTEGER NOT NULL DEFAULT 0,
  sng_net INTEGER NOT NULL DEFAULT 0, reads TEXT
);
CREATE TABLE IF NOT EXISTS bots (
  key TEXT PRIMARY KEY, hands INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL DEFAULT 0,
  pots_won INTEGER NOT NULL DEFAULT 0, biggest_pot INTEGER NOT NULL DEFAULT 0, busted INTEGER NOT NULL DEFAULT 0,
  sng_won INTEGER NOT NULL DEFAULT 0, reads TEXT
);
CREATE TABLE IF NOT EXISTS escrow (
  player_id TEXT NOT NULL, table_id TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (player_id, table_id)
);
CREATE TABLE IF NOT EXISTS hands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, table_id TEXT, table_name TEXT, mode TEXT, hand_no INTEGER,
  started_at INTEGER, ended_at INTEGER, sb INTEGER, bb INTEGER, pot INTEGER, board TEXT, summary TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS hand_players (
  hand_id INTEGER NOT NULL, player_id TEXT, seat INTEGER NOT NULL, name TEXT, kind TEXT, mode TEXT,
  start_stack INTEGER, net INTEGER, won INTEGER, showdown INTEGER, hole TEXT, score INTEGER,
  PRIMARY KEY (hand_id, seat)
);
CREATE INDEX IF NOT EXISTS hp_player ON hand_players (player_id, hand_id DESC);
CREATE TABLE IF NOT EXISTS achievements (
  player_id TEXT NOT NULL, key TEXT NOT NULL, unlocked_at INTEGER NOT NULL, hand_id INTEGER,
  PRIMARY KEY (player_id, key)
);
CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, buy_in INTEGER, prize_pool INTEGER,
  started_at INTEGER, ended_at INTEGER, results TEXT
);
CREATE TABLE IF NOT EXISTS tournament_entries (
  tourney_id INTEGER NOT NULL, player_id TEXT, name TEXT, kind TEXT, place INTEGER, prize INTEGER
);
CREATE INDEX IF NOT EXISTS te_player ON tournament_entries (player_id);
CREATE TABLE IF NOT EXISTS bg_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, table_id TEXT, table_name TEXT, mode TEXT, ended_at INTEGER,
  white_id TEXT, white_name TEXT, black_id TEXT, black_name TEXT, winner INTEGER, points INTEGER, cube INTEGER,
  kind TEXT, stake INTEGER, amount INTEGER, turns INTEGER
);
CREATE INDEX IF NOT EXISTS bg_white ON bg_games (white_id, id DESC);
CREATE INDEX IF NOT EXISTS bg_black ON bg_games (black_id, id DESC);
CREATE TABLE IF NOT EXISTS bg_stats (
  player_id TEXT PRIMARY KEY, name TEXT, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
  gammons INTEGER NOT NULL DEFAULT 0, backgammons INTEGER NOT NULL DEFAULT 0, points_won INTEGER NOT NULL DEFAULT 0,
  points_lost INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
  matches_won INTEGER NOT NULL DEFAULT 0
);
`;

const json = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const cat = score => Math.floor(score / B5);
const high = score => Math.floor(score / B4) % 15;

export class DB {
  constructor(path = process.env.DB_PATH || 'data/lamplight.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;');
    this.db.exec(SCHEMA);
    const q = sql => this.db.query(sql);
    this.q = {
      get: q('SELECT * FROM players WHERE id = $id'),
      insert: q(`INSERT INTO players (id, name, created_at, last_seen, bankroll) VALUES ($id, $name, $now, $now, $bankroll)`),
      seen: q('UPDATE players SET name = $name, last_seen = $now WHERE id = $id'),
      bank: q('UPDATE players SET bankroll = bankroll + $amt WHERE id = $id'),
      escrowOf: q('SELECT amount FROM escrow WHERE player_id = $pid AND table_id = $tid'),
      escrowAdd: q(`INSERT INTO escrow (player_id, table_id, amount) VALUES ($pid, $tid, $amt)
        ON CONFLICT (player_id, table_id) DO UPDATE SET amount = amount + excluded.amount`),
      escrowSet: q('UPDATE escrow SET amount = $amt WHERE player_id = $pid AND table_id = $tid'),
      escrowDel: q('DELETE FROM escrow WHERE player_id = $pid AND table_id = $tid'),
      escrowSum: q('SELECT COALESCE(SUM(amount), 0) AS s FROM escrow WHERE player_id = $pid'),
      hand: q(`INSERT INTO hands (table_id, table_name, mode, hand_no, started_at, ended_at, sb, bb, pot, board, summary, data)
        VALUES ($tid, $tname, $mode, $no, $start, $end, $sb, $bb, $pot, $board, $summary, $data)`),
      handPlayer: q(`INSERT INTO hand_players (hand_id, player_id, seat, name, kind, mode, start_stack, net, won, showdown, hole, score)
        VALUES ($hid, $pid, $seat, $name, $kind, $mode, $start, $net, $won, $showdown, $hole, $score)`),
      stats: q(`UPDATE players SET hands = hands + 1, vpip = vpip + $vpip, pfr = pfr + $pfr, pots_won = pots_won + $won,
        showdowns = showdowns + $sd, showdowns_won = showdowns_won + $sdw, net = net + $net,
        biggest_pot = MAX(biggest_pot, $pot), best_score = MAX(best_score, $score) WHERE id = $id`),
      botUpsert: q(`INSERT INTO bots (key, hands, net, pots_won, biggest_pot, busted) VALUES ($key, 1, $net, $won, $pot, $busted)
        ON CONFLICT (key) DO UPDATE SET hands = hands + 1, net = net + excluded.net, pots_won = pots_won + excluded.pots_won,
        biggest_pot = MAX(biggest_pot, excluded.biggest_pot), busted = busted + excluded.busted`),
      ach: q('INSERT OR IGNORE INTO achievements (player_id, key, unlocked_at, hand_id) VALUES ($pid, $key, $now, $hid)'),
      achOf: q('SELECT key, unlocked_at, hand_id FROM achievements WHERE player_id = $pid ORDER BY unlocked_at'),
      readsGet: q('SELECT reads FROM players WHERE id = $id'),
      readsSet: q('UPDATE players SET reads = $reads WHERE id = $id'),
      botReadsGet: q('SELECT reads FROM bots WHERE key = $key'),
      botReadsSet: q(`INSERT INTO bots (key, reads) VALUES ($key, $reads) ON CONFLICT (key) DO UPDATE SET reads = excluded.reads`),
      recent: q(`SELECT hp.hand_id AS id, hp.net, hp.won, hp.showdown, hp.hole, hp.score, hp.mode, h.table_name, h.ended_at,
        h.board, h.pot, h.bb, h.summary FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
        WHERE hp.player_id = $pid ORDER BY hp.hand_id DESC LIMIT $limit`),
      series: q(`SELECT hand_id AS id, net FROM hand_players WHERE player_id = $pid AND mode = 'cash' ORDER BY hand_id DESC LIMIT 2000`),
      handById: q('SELECT * FROM hands WHERE id = $id'),
      handUpdate: q('UPDATE hands SET data = $data WHERE id = $id'),
      tourney: q(`INSERT INTO tournaments (name, buy_in, prize_pool, started_at, ended_at, results) VALUES ($name, $buyIn, $pool, $start, $end, $results)`),
      entry: q(`INSERT INTO tournament_entries (tourney_id, player_id, name, kind, place, prize) VALUES ($tid, $pid, $name, $kind, $place, $prize)`),
      sngStats: q(`UPDATE players SET sng_played = sng_played + 1, sng_won = sng_won + $won, sng_cashes = sng_cashes + $cash,
        sng_net = sng_net + $net WHERE id = $id`),
      botSng: q(`INSERT INTO bots (key, sng_won) VALUES ($key, 1) ON CONFLICT (key) DO UPDATE SET sng_won = sng_won + 1`),
      sngHistory: q(`SELECT t.id, t.name, t.buy_in, t.prize_pool, t.ended_at, e.place, e.prize FROM tournament_entries e
        JOIN tournaments t ON t.id = e.tourney_id WHERE e.player_id = $pid ORDER BY t.id DESC LIMIT 12`),
    };
    this.q.bgGame = q(`INSERT INTO bg_games (table_id, table_name, mode, ended_at, white_id, white_name, black_id, black_name, winner, points, cube, kind, stake, amount, turns)
      VALUES ($tid, $tname, $mode, $now, $wid, $wname, $bid, $bname, $winner, $points, $cube, $kind, $stake, $amount, $turns)`);
    this.q.bgStat = q(`INSERT INTO bg_stats (player_id, name, games, wins, gammons, backgammons, points_won, points_lost, net)
      VALUES ($id, $name, 1, $win, $gammon, $bg, $won, $lost, $net)
      ON CONFLICT (player_id) DO UPDATE SET name = excluded.name, games = games + 1, wins = wins + excluded.wins,
        gammons = gammons + excluded.gammons, backgammons = backgammons + excluded.backgammons,
        points_won = points_won + excluded.points_won, points_lost = points_lost + excluded.points_lost, net = net + excluded.net`);
    this.q.bgMatch = q(`INSERT INTO bg_stats (player_id, name, matches, matches_won) VALUES ($id, $name, 1, $won)
      ON CONFLICT (player_id) DO UPDATE SET name = excluded.name, matches = matches + 1, matches_won = matches_won + excluded.matches_won`);
    this.q.bgOf = q('SELECT * FROM bg_stats WHERE player_id = $id');
    this.q.bgRecent = q('SELECT * FROM bg_games WHERE white_id = $id OR black_id = $id ORDER BY id DESC LIMIT 12');
    this.tx = {
      hand: this.db.transaction((rec, meta) => this._recordHand(rec, meta)),
      tourney: this.db.transaction(t => this._recordTournament(t)),
      bgGame: this.db.transaction(g => this._recordBgGame(g)),
      bgMatch: this.db.transaction(m => this._recordBgMatch(m)),
    };
  }
  close() { try { this.db.close(); } catch { /* already closed */ } }

  /* ───────────── accounts & bankroll ───────────── */
  account(id, name) {
    const now = Date.now();
    let row = this.q.get.get({ id });
    if (!row) { this.q.insert.run({ id, name, now, bankroll: START_BANKROLL }); row = this.q.get.get({ id }); }
    else if (name && name !== row.name) { this.q.seen.run({ id, name, now }); row.name = name; }
    else this.q.seen.run({ id, name: row.name, now });
    return row;
  }
  /** What the client shows in its header: bankroll, chips on tables, whether free chips are available. */
  wallet(id) {
    const r = this.q.get.get({ id });
    if (!r) return null;
    const now = Date.now(), inPlay = this.q.escrowSum.get({ pid: id }).s;
    const streak = now - r.last_bonus < STREAK_WINDOW ? r.streak : 0;
    return {
      id: r.id, name: r.name, bankroll: r.bankroll, inPlay,
      bonus: { ready: now - r.last_bonus >= BONUS_EVERY, at: r.last_bonus + BONUS_EVERY, amount: this.bonusAmount(streak + 1), streak },
      refill: r.bankroll + inPlay < REFILL_BELOW && now - r.last_refill >= REFILL_EVERY,
    };
  }
  bonusAmount(streak) { return 1000 + 250 * Math.min(Math.max(streak, 1) - 1, 8); }
  claimBonus(id) {
    const r = this.q.get.get({ id }), now = Date.now();
    if (!r || now - r.last_bonus < BONUS_EVERY) return null;
    const streak = now - r.last_bonus < STREAK_WINDOW ? r.streak + 1 : 1;
    const amount = this.bonusAmount(streak);
    this.db.query('UPDATE players SET bankroll = bankroll + $amount, last_bonus = $now, streak = $streak WHERE id = $id').run({ id, amount, now, streak });
    return { amount, streak };
  }
  refill(id) {
    const w = this.wallet(id);
    if (!w || !w.refill) return null;
    const amount = REFILL_TO - w.bankroll;
    this.db.query('UPDATE players SET bankroll = $to, last_refill = $now WHERE id = $id').run({ id, to: REFILL_TO, now: Date.now() });
    return { amount };
  }

  /** Moves money from a bankroll onto a table. False when the bankroll can't cover it. */
  buyIn(pid, tid, amt) {
    return this.db.transaction(() => {
      const r = this.q.get.get({ id: pid });
      if (!r || r.bankroll < amt) return false;
      this.q.bank.run({ id: pid, amt: -amt });
      this.q.escrowAdd.run({ pid, tid, amt });
      return true;
    })();
  }
  /** After every hand: what this account now has on this table. */
  checkpoint(pid, tid, amt) { this.q.escrowSet.run({ pid, tid, amt }); }
  /** Off the table and back into the bankroll. */
  cashOut(pid, tid, amt) {
    this.db.transaction(() => {
      this.q.escrowDel.run({ pid, tid });
      if (amt > 0) this.q.bank.run({ id: pid, amt });
    })();
  }
  /** Server start: whatever was left on tables when we last stopped goes home. */
  recover() {
    const rows = this.db.query('SELECT player_id, SUM(amount) AS s FROM escrow GROUP BY player_id').all();
    this.db.transaction(() => {
      for (const r of rows) this.q.bank.run({ id: r.player_id, amt: r.s });
      this.db.exec('DELETE FROM escrow');
    })();
    return rows.length;
  }

  /* ───────────── reads (what bots know about people) ───────────── */
  reads(id) {
    if (id.startsWith('bot:')) return json(this.q.botReadsGet.get({ key: id.slice(4) })?.reads);
    return json(this.q.readsGet.get({ id })?.reads);
  }
  saveReads(id, data) {
    if (!data) return;
    const reads = JSON.stringify(data);
    if (id.startsWith('bot:')) this.q.botReadsSet.run({ key: id.slice(4), reads });
    else this.q.readsSet.run({ id, reads });
  }

  /* ───────────── hands ───────────── */
  /** Saves a finished hand. Returns { id, unlocked: [{ pid, key }] }. */
  recordHand(rec, meta) { return this.tx.hand(rec, meta); }
  _recordHand(rec, { tableId, tableName, mode }) {
    const now = Date.now();
    const scores = rec.scores || {};
    const pot = rec.potTotal || 0;
    const winnersBySeat = {};
    for (const p of rec.pots) {
      const share = Math.floor(p.amount / p.winners.length);
      for (const s of p.winners) winnersBySeat[s] = (winnersBySeat[s] || 0) + share;
    }
    const byName = s => rec.seats.find(x => x.seat === s)?.name;
    const main = rec.pots[0];
    const summary = {
      winners: main ? main.winners.map(byName) : [],
      hand: main && main.score != null ? HandEval.describe(main.score) : null,
    };
    const hid = Number(this.q.hand.run({
      tid: tableId, tname: tableName, mode, no: rec.no, start: rec.startedAt, end: rec.endedAt || now,
      sb: rec.sb, bb: rec.bb, pot, board: JSON.stringify(rec.board), summary: JSON.stringify(summary), data: JSON.stringify(rec),
    }).lastInsertRowid);

    const preflop = rec.events.filter(e => e.k === 'act' && e.street === 'preflop');
    const busted = rec.seats.filter(s => rec.end[s.seat] === 0);
    const unlocked = [];
    for (const s of rec.seats) {
      const start = s.stack, end = rec.end[s.seat] ?? start, net = end - start;
      const won = winnersBySeat[s.seat] || 0;
      const sd = s.seat in scores ? 1 : 0;
      const score = scores[s.seat] ?? null;
      const hole = rec.hole[s.seat] || [];
      this.q.handPlayer.run({
        hid, pid: s.id, seat: s.seat, name: s.name, kind: s.kind, mode, start, net, won: won > 0 ? 1 : 0, showdown: sd,
        hole: JSON.stringify(hole), score,
      });
      const vpip = preflop.some(e => e.s === s.seat && (e.type === 'call' || e.type === 'raise' || e.type === 'bet')) ? 1 : 0;
      const pfr = preflop.some(e => e.s === s.seat && (e.type === 'raise' || e.type === 'bet')) ? 1 : 0;
      if (s.kind === 'bot' && s.profile) {
        this.q.botUpsert.run({ key: s.profile, net: mode === 'cash' ? net : 0, won: won > 0 ? 1 : 0, pot: mode === 'cash' ? won : 0, busted: 0 });
        continue;
      }
      if (s.kind !== 'human' || !s.id) continue;
      this.q.stats.run({
        id: s.id, vpip, pfr, won: won > 0 ? 1 : 0, sd, sdw: sd && won > 0 ? 1 : 0,
        net: mode === 'cash' ? net : 0, pot: mode === 'cash' ? won : 0, score: sd && won > 0 ? score : -1,
      });
      // achievements
      const row = this.q.get.get({ id: s.id });
      const keys = [];
      const c = score != null ? cat(score) : -1;
      if (won) {
        if (row.pots_won >= 1) keys.push('first_pot');
        if (sd) {
          if (c === 6) keys.push('full_house');
          if (c === 7) keys.push('quads');
          if (c === 8) keys.push(high(score) === 14 ? 'royal' : 'straight_flush');
          if ((c === 4 || c === 8) && high(score) === 5) keys.push('wheel');
        }
        if (hole.length === 2) {
          const r = hole.map(Cards.rank).sort((a, b) => a - b);
          if (r[0] === 2 && r[1] === 7 && Cards.suit(hole[0]) !== Cards.suit(hole[1])) keys.push('hammer');
        }
        if (!sd && rec.events.some(e => e.k === 'act' && e.s === s.seat && e.street === 'river' && (e.type === 'bet' || e.type === 'raise'))) keys.push('bluff');
        if (pot >= 100 * rec.bb) keys.push('big_pot');
        if (start > 0 && end >= 2 * start) keys.push('double_up');
        for (const b of busted) {
          if (b.profile === 'shark') keys.push('shark_hunter');
          if (b.profile === 'pro') keys.push('professor');
        }
      } else if (sd) {
        if (c >= 6) keys.push('bad_beat');
        if (hole.length === 2 && Cards.rank(hole[0]) === 14 && Cards.rank(hole[1]) === 14) keys.push('cracked');
      }
      if (row.hands >= 100) keys.push('hands_100');
      if (row.hands >= 1000) keys.push('hands_1000');
      if (row.showdowns_won >= 10) keys.push('showdown_10');
      for (const key of keys) if (this.unlock(s.id, key, hid)) unlocked.push({ pid: s.id, key });
    }
    for (const b of busted) if (b.kind === 'bot' && b.profile) this.db.query('UPDATE bots SET busted = busted + 1 WHERE key = $key').run({ key: b.profile });
    return { id: hid, unlocked };
  }
  unlock(pid, key, hid = null) {
    if (!ACH[key]) return false;
    return this.q.ach.run({ pid, key, now: Date.now(), hid }).changes > 0;
  }
  /** The bankroll milestone is checked whenever money lands in the bankroll. */
  checkBankroll(pid) {
    const w = this.wallet(pid);
    return w && w.bankroll + w.inPlay >= 50_000 && this.unlock(pid, 'high_roller') ? ['high_roller'] : [];
  }

  /** A shown card in the replayer only if its owner showed it, or the viewer held it. */
  hand(id, viewer) {
    const h = this.q.handById.get({ id });
    if (!h) return null;
    const rec = json(h.data);
    if (!rec) return null;
    const mine = rec.seats.find(s => s.id && s.id === viewer)?.seat ?? null;
    const hole = {};
    for (const [seat, cards] of Object.entries(rec.hole)) if (rec.shown.includes(+seat) || +seat === mine) hole[seat] = cards;
    return { ...rec, hole, id: h.id, tableName: h.table_name, mode: h.mode, mine };
  }
  /** A player turned their cards over after the hand was saved. */
  markShown(id, seat) {
    const h = this.q.handById.get({ id });
    const rec = h && json(h.data);
    if (!rec || rec.shown.includes(seat)) return;
    rec.shown.push(seat);
    this.q.handUpdate.run({ id, data: JSON.stringify(rec) });
  }

  /* ───────────── tournaments ───────────── */
  recordTournament(t) { return this.tx.tourney(t); }
  _recordTournament({ name, buyIn, pool, startedAt, results }) {
    const tid = Number(this.q.tourney.run({ name, buyIn, pool, start: startedAt, end: Date.now(), results: JSON.stringify(results) }).lastInsertRowid);
    const unlocked = [];
    for (const r of results) {
      this.q.entry.run({ tid, pid: r.id, name: r.name, kind: r.kind, place: r.place, prize: r.prize });
      if (r.kind === 'bot' && r.place === 1 && r.profile) this.q.botSng.run({ key: r.profile });
      if (r.kind !== 'human' || !r.id) continue;
      this.q.sngStats.run({ id: r.id, won: r.place === 1 ? 1 : 0, cash: r.prize > 0 ? 1 : 0, net: r.prize - buyIn });
      if (r.prize > 0 && this.unlock(r.id, 'sng_cash')) unlocked.push({ pid: r.id, key: 'sng_cash' });
      if (r.place === 1 && this.unlock(r.id, 'sng_win')) unlocked.push({ pid: r.id, key: 'sng_win' });
    }
    return { id: tid, unlocked };
  }

  /* ───────────── backgammon ───────────── */
  /** Saves a finished game. Seats are { id, name, kind } (bots as 'bot:<key>'). Returns unlocked achievements. */
  recordBgGame(g) { return this.tx.bgGame(g); }
  _recordBgGame({ tableId, tableName, mode, stake, seats, winner, points, cube, kind, mult, amount, turns }) {
    const [w, b] = seats;
    this.q.bgGame.run({
      tid: tableId, tname: tableName, mode, now: Date.now(), wid: w.id, wname: w.name, bid: b.id, bname: b.name,
      winner, points, cube, kind, stake, amount, turns,
    });
    const unlocked = [];
    seats.forEach((s, i) => {
      const won = i === winner, real = kind !== 'drop' && kind !== 'resign' && kind !== 'forfeit';
      this.q.bgStat.run({
        id: s.id, name: s.name, win: won ? 1 : 0, gammon: won && real && mult === 2 ? 1 : 0, bg: won && real && mult === 3 ? 1 : 0,
        won: won ? points : 0, lost: won ? 0 : points, net: mode === 'money' ? (won ? amount : -amount) : 0,
      });
      if (!won || s.kind !== 'human') return;
      const keys = ['bg_first'];
      if (real && mult === 2) keys.push('bg_gammon');
      if (real && mult === 3) keys.push('bg_backgammon');
      if (cube >= 4) keys.push('bg_cube');
      for (const key of keys) if (this.unlock(s.id, key)) unlocked.push({ pid: s.id, key });
    });
    return unlocked;
  }
  recordBgMatch(m) { return this.tx.bgMatch(m); }
  _recordBgMatch({ winner, loser }) {
    const unlocked = [];
    if (winner) this.q.bgMatch.run({ id: winner.id, name: winner.name, won: 1 });
    if (loser) this.q.bgMatch.run({ id: loser.id, name: loser.name, won: 0 });
    if (winner && winner.kind === 'human' && this.unlock(winner.id, 'bg_match')) unlocked.push({ pid: winner.id, key: 'bg_match' });
    return unlocked;
  }
  /** One player's backgammon record and last few games, or null if they have never played. */
  bgRecord(id) {
    const r = this.q.bgOf.get({ id });
    const recent = this.q.bgRecent.all({ id }).map(g => {
      const seat = g.white_id === id ? 0 : 1;
      return {
        id: g.id, table: g.table_name, at: g.ended_at, mode: g.mode, won: g.winner === seat, points: g.points, cube: g.cube, kind: g.kind,
        amount: g.mode === 'money' ? (g.winner === seat ? g.amount : -g.amount) : 0, opponent: seat === 0 ? g.black_name : g.white_name,
      };
    });
    if (!r && !recent.length) return null;
    return {
      games: r?.games || 0, wins: r?.wins || 0, gammons: r?.gammons || 0, backgammons: r?.backgammons || 0,
      pointsWon: r?.points_won || 0, pointsLost: r?.points_lost || 0, net: r?.net || 0, matches: r?.matches || 0, matchesWon: r?.matches_won || 0,
      recent,
    };
  }

  /* ───────────── profile & leaderboards ───────────── */
  profile(id) {
    const r = this.q.get.get({ id });
    if (!r) return null;
    const series = this.q.series.all({ pid: id }).reverse();
    let run = 0;
    const graph = series.map(x => (run += x.net));
    const recent = this.q.recent.all({ pid: id, limit: 30 }).map(h => ({
      id: h.id, net: h.net, won: !!h.won, showdown: !!h.showdown, hole: json(h.hole) || [], mode: h.mode,
      table: h.table_name, at: h.ended_at, board: json(h.board) || [], pot: h.pot, bb: h.bb,
      hand: h.score != null && h.score >= 0 ? HandEval.describe(h.score) : null, summary: json(h.summary),
    }));
    return {
      wallet: this.wallet(id),
      stats: {
        hands: r.hands, vpip: r.vpip, pfr: r.pfr, potsWon: r.pots_won, showdowns: r.showdowns, showdownsWon: r.showdowns_won,
        net: r.net, biggestPot: r.biggest_pot, bestHand: r.best_score >= 0 ? HandEval.describe(r.best_score) : null,
        sngPlayed: r.sng_played, sngWon: r.sng_won, sngCashes: r.sng_cashes, sngNet: r.sng_net, since: r.created_at,
      },
      reads: json(r.reads),
      achievements: this.q.achOf.all({ pid: id }),
      graph, recent, sng: this.q.sngHistory.all({ pid: id }), bg: this.bgRecord(id),
    };
  }
  leaderboard() {
    const top = (order, where = 'hands > 0') => this.db.query(
      `SELECT p.id, p.name, p.bankroll + COALESCE((SELECT SUM(amount) FROM escrow e WHERE e.player_id = p.id), 0) AS worth,
        p.net, p.hands, p.biggest_pot, p.sng_won, p.sng_played FROM players p WHERE ${where} ORDER BY ${order} LIMIT 10`).all();
    return {
      worth: top('worth DESC', '1'),
      winners: top('net DESC'),
      pots: top('biggest_pot DESC', 'biggest_pot > 0'),
      sng: top('sng_won DESC, sng_played ASC', 'sng_played > 0'),
      bots: this.db.query('SELECT key, hands, net, pots_won, biggest_pot, busted, sng_won FROM bots WHERE hands > 0 ORDER BY net DESC').all(),
      bg: this.db.query(`SELECT s.player_id AS id, COALESCE(p.name, s.name) AS name, s.games, s.wins, s.gammons, s.backgammons, s.net, s.matches, s.matches_won,
        CASE WHEN s.player_id LIKE 'bot:%' THEN substr(s.player_id, 5) ELSE NULL END AS bot
        FROM bg_stats s LEFT JOIN players p ON p.id = s.player_id WHERE s.games > 0 ORDER BY s.wins DESC, s.games ASC LIMIT 10`).all(),
      totals: this.db.query('SELECT (SELECT COUNT(*) FROM hands) AS hands, (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM tournaments) AS tournaments, (SELECT COUNT(*) FROM bg_games) AS bgGames').get(),
    };
  }
}
