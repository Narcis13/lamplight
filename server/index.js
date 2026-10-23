/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · server
   Bun.serve: the client bundle (HTML import), a small JSON API and one
   WebSocket endpoint at /ws for the lobby, the poker tables, the
   backgammon boards and the gem duels (all in the same lobby list).

   Identity: the browser keeps a secret account key in localStorage and
   sends it when it connects. The account id is a hash of that key, so
   ids can be shown to others without letting anyone sign in as you.
   Seats are held by a per-tab token, as before.
   ════════════════════════════════════════════════════════════════════ */
import { cleanName, SPEEDS, STAKES, SNG } from '../shared/engine.js';
import { BG } from '../shared/backgammon.js';
import { M3, own } from '../shared/match3.js';
import { Table } from './table.js';
import { BgTable } from './bgtable.js';
import { M3Table } from './m3table.js';
import { DB } from './db.js';
import homepage from '../client/index.html';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_TABLES = Number(process.env.MAX_TABLES || 24);
const IDLE_TABLE_MS = 5 * 60_000; // tables nobody is watching are closed after this long
const ALLOW_TEST_SPEED = !!process.env.ALLOW_TEST_SPEED;

const db = new DB();
const recovered = db.recover();
if (recovered) console.log(`♠ Returned chips left on tables to ${recovered} bankroll${recovered === 1 ? '' : 's'}`);

const accountId = secret => 'p' + new Bun.CryptoHasher('sha256').update(secret).digest('hex').slice(0, 24);

class Lobby {
  constructor() {
    this.tables = new Map();
    this.seq = 0;
    this.server = null;
    this._t = null;
    this.sockets = new Map(); // account id -> Set(ws)
    setInterval(() => this.sweep(), 30_000).unref?.();
  }
  newId() { return (++this.seq).toString(36) + Math.random().toString(36).slice(2, 6); }
  create(opts) {
    if (this.tables.size >= MAX_TABLES) return null;
    if (opts.game === 'bg') return this.createBg(opts);
    if (opts.game === 'm3') return this.createM3(opts);
    const speed = opts.speed === 'test' && !ALLOW_TEST_SPEED ? 'normal' : opts.speed;
    const mode = opts.mode === 'sng' ? 'sng' : 'cash';
    const t = new Table(this, {
      id: this.newId(),
      // built-in names are ours and may use '&'; anything a player typed is cleaned
      name: opts.builtIn ? String(opts.name) : cleanName(opts.name, 24, mode === 'sng' ? `Sit & Go ${this.seq + 1}` : `Table ${this.seq + 1}`),
      mode,
      stakes: STAKES[opts.stakes] ? opts.stakes : 'micro',
      speed: SPEEDS[speed] ? speed : 'normal',
      buyInBB: [50, 100, 200].includes(Number(opts.buyInBB)) ? Number(opts.buyInBB) : 100,
      fillBots: opts.fillBots !== false,
      bots: Math.max(0, Math.min(5, Number(opts.bots) || 0)),
      skill: ['casual', 'regular', 'sharp'].includes(opts.skill) ? opts.skill : 'regular',
      sngBuyIn: SNG.buyIns.includes(Number(opts.sngBuyIn)) ? Number(opts.sngBuyIn) : 500,
      permanent: !!opts.permanent, auto: !!opts.auto,
      db,
    });
    this.tables.set(t.id, t);
    this.changed();
    return t;
  }
  /** A backgammon board: a money game at a stake per point, or a match to N points. */
  createBg(opts) {
    const speed = opts.speed === 'test' && !ALLOW_TEST_SPEED ? 'normal' : opts.speed;
    const mode = opts.mode === 'match' ? 'match' : 'money';
    const t = new BgTable(this, {
      id: this.newId(),
      name: opts.builtIn ? String(opts.name) : cleanName(opts.name, 24, mode === 'match' ? `Match ${this.seq + 1}` : `Board ${this.seq + 1}`),
      mode, stake: Number(opts.stake), entry: Number(opts.entry), matchTo: Number(opts.matchTo),
      speed: BG.speeds[speed] ? speed : 'normal', bot: opts.bot !== false,
      skill: ['casual', 'regular', 'sharp'].includes(opts.skill) ? opts.skill : 'regular',
      permanent: !!opts.permanent, db,
    });
    this.tables.set(t.id, t);
    this.changed();
    return t;
  }
  /** A gem duel: a match-3 board for two, for an entry (or for free). */
  createM3(opts) {
    const speed = opts.speed === 'test' && !ALLOW_TEST_SPEED ? 'normal' : opts.speed;
    const t = new M3Table(this, {
      id: this.newId(),
      name: opts.builtIn ? String(opts.name) : cleanName(opts.name, 24, `Duel ${this.seq + 1}`),
      format: opts.format, entry: Number(opts.entry), speed: own(M3.speeds, speed) ? speed : 'normal', bot: opts.bot !== false,
      skill: ['casual', 'regular', 'sharp'].includes(opts.skill) ? opts.skill : 'regular',
      permanent: !!opts.permanent, db,
    });
    this.tables.set(t.id, t);
    this.changed();
    return t;
  }
  list() { return [...this.tables.values()].map(t => t.summary()); }
  /** Lobby updates are throttled: a busy table would otherwise flood everyone in the lobby. */
  changed() {
    if (this._t || !this.server) return;
    this._t = setTimeout(() => {
      this._t = null;
      this.server.publish('lobby', JSON.stringify({ e: 'lobby', tables: this.list() }));
    }, 250);
  }
  /** The always-open Sit & Go: once it starts, a fresh one opens for registration. */
  tourneyStarted(t) {
    if (!t.auto) return;
    t.auto = false;
    this.create({ name: t.name, mode: 'sng', speed: t.speed, sngBuyIn: t.tourney.buyIn, skill: t.skillKey, auto: true, permanent: true, builtIn: true });
    t.permanent = false; // the running one closes normally once it's over and nobody is watching
  }
  sweep() {
    const now = Date.now();
    for (const t of this.tables.values()) {
      if (!t.permanent && t.clients.size === 0 && t.emptySince && now - t.emptySince > IDLE_TABLE_MS) {
        if (t.busy()) continue; // a tournament to finish, or someone's chips still on it
        t.close();
        this.tables.delete(t.id);
        this.changed();
      }
    }
  }

  /* accounts */
  track(ws) {
    const id = ws.data.pid;
    if (!this.sockets.has(id)) this.sockets.set(id, new Set());
    this.sockets.get(id).add(ws);
  }
  untrack(ws) {
    const set = this.sockets.get(ws.data.pid);
    if (set) { set.delete(ws); if (!set.size) this.sockets.delete(ws.data.pid); }
  }
  /** Tells every tab of an account what its bankroll looks like now. */
  pushWallet(pid) {
    const set = this.sockets.get(pid);
    if (!set) return;
    const ach = db.checkBankroll(pid);
    const msg = JSON.stringify({ e: 'wallet', wallet: db.wallet(pid) });
    for (const ws of set) {
      send(ws, msg);
      for (const key of ach) send(ws, { e: 'achievement', key, pid, name: ws.data.name, seat: null });
    }
  }
  shutdown() {
    for (const t of this.tables.values()) { t.cashOutAll(); t.close(); }
    db.close();
  }
}

const lobby = new Lobby();
lobby.create({ name: 'The Lamplight', speed: 'normal', stakes: 'micro', buyInBB: 100, fillBots: true, permanent: true, builtIn: true });
lobby.create({ name: 'Night Owls', speed: 'turbo', stakes: 'micro', buyInBB: 100, fillBots: true, permanent: true, builtIn: true });
lobby.create({ name: 'The Back Room', speed: 'normal', stakes: 'low', buyInBB: 100, fillBots: true, skill: 'sharp', permanent: true, builtIn: true });
lobby.create({ name: 'Brass Rail', speed: 'relaxed', stakes: 'mid', buyInBB: 100, fillBots: true, skill: 'sharp', permanent: true, builtIn: true });
lobby.create({ name: 'Sunset Sit & Go', mode: 'sng', speed: 'turbo', sngBuyIn: 500, permanent: true, auto: true, builtIn: true });
lobby.create({ game: 'bg', name: 'The Backgammon Parlor', mode: 'money', stake: 10, speed: 'normal', bot: true, skill: 'regular', permanent: true, builtIn: true });
lobby.create({ game: 'bg', name: 'Tavla House', mode: 'match', matchTo: 5, entry: 500, speed: 'normal', bot: true, skill: 'sharp', permanent: true, builtIn: true });
lobby.create({ game: 'bg', name: 'Open Board', mode: 'money', stake: 10, speed: 'normal', bot: false, permanent: true, builtIn: true });
lobby.create({ game: 'bg', name: 'Friendly Match', mode: 'match', matchTo: 3, entry: 100, speed: 'relaxed', bot: false, permanent: true, builtIn: true });
lobby.create({ game: 'm3', name: 'The Gem Parlor', format: 'classic', entry: 100, speed: 'normal', bot: true, skill: 'regular', permanent: true, builtIn: true });
lobby.create({ game: 'm3', name: 'Sprint Arcade', format: 'sprint', entry: 0, speed: 'turbo', bot: true, skill: 'casual', permanent: true, builtIn: true });
lobby.create({ game: 'm3', name: 'Open Duel', format: 'classic', entry: 100, speed: 'normal', bot: false, permanent: true, builtIn: true });
lobby.create({ game: 'm3', name: 'Friendly Duel', format: 'classic', entry: 0, speed: 'relaxed', bot: false, permanent: true, builtIn: true });

const send = (ws, m) => { try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch { /* closed */ } };

function onMessage(ws, raw) {
  let m;
  try { m = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  const cur = ws.data.tableId ? lobby.tables.get(ws.data.tableId) : null;
  const pid = ws.data.pid;

  switch (m.t) {
    case 'hello': // name changes from the lobby
      ws.data.name = cleanName(m.name);
      db.account(pid, ws.data.name);
      send(ws, { e: 'wallet', wallet: db.wallet(pid) });
      return;
    case 'create': {
      const t = lobby.create({ ...(m.opts || {}), permanent: false, auto: false, builtIn: false });
      if (!t) return send(ws, { e: 'error', msg: 'The room is full of tables right now. Join one of these instead.' });
      send(ws, { e: 'created', id: t.id });
      return;
    }
    case 'join': {
      const t = lobby.tables.get(String(m.id));
      if (!t) return send(ws, { e: 'error', msg: 'That table has closed.', gone: true });
      if (m.name) { ws.data.name = cleanName(m.name); db.account(pid, ws.data.name); }
      if (cur && cur !== t) cur.leave(ws);
      ws.unsubscribe('lobby');
      t.attach(ws);
      if (m.sit) {
        const err = t.sit(ws, Number.isInteger(m.seat) ? m.seat : -1, m.booster);
        if (err) send(ws, { e: 'error', msg: err });
      }
      return;
    }
    case 'leave':
      if (cur) cur.leave(ws);
      ws.data.tableId = null;
      ws.subscribe('lobby');
      send(ws, { e: 'lobby', tables: lobby.list() });
      return;
    case 'profile': {
      const id = typeof m.id === 'string' && m.id ? m.id : pid;
      const data = db.profile(id);
      if (data && id !== pid) { delete data.wallet; delete data.reads; data.recent = []; } // someone else's: public stats only
      send(ws, { e: 'profile', id, mine: id === pid, data });
      return;
    }
    case 'leaderboard': send(ws, { e: 'leaderboard', data: db.leaderboard() }); return;
    case 'hand': {
      const data = db.hand(Number(m.id), pid);
      send(ws, { e: 'hand', id: Number(m.id), data });
      return;
    }
    case 'bonus': {
      const r = db.claimBonus(pid);
      send(ws, r ? { e: 'bonus', ...r } : { e: 'error', msg: 'Your next bonus is not ready yet.' });
      lobby.pushWallet(pid);
      return;
    }
    case 'refill': {
      const r = db.refill(pid);
      send(ws, r ? { e: 'bonus', amount: r.amount, refill: true } : { e: 'error', msg: 'Free chips are for empty bankrolls.' });
      lobby.pushWallet(pid);
      return;
    }
    default:
      if (cur) cur.onMessage(ws, m);
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  development: process.env.NODE_ENV !== 'production' && { hmr: true, console: true },
  routes: {
    '/': homepage,
    '/api/tables': { GET: () => Response.json(lobby.list()) },
    '/api/leaderboard': { GET: () => Response.json(db.leaderboard()) },
    '/api/health': () => new Response('ok'),
    '/ws': (req, server) => {
      const url = new URL(req.url);
      const token = String(url.searchParams.get('token') || '');
      if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) return new Response('bad token', { status: 400 });
      const key = String(url.searchParams.get('key') || '');
      const pid = accountId(/^[A-Za-z0-9-]{16,64}$/.test(key) ? `key:${key}` : `tok:${token}`);
      const name = cleanName(url.searchParams.get('name'));
      const ok = server.upgrade(req, { data: { token, pid, name, tableId: null } });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    },
  },
  fetch() { return new Response('Not found', { status: 404 }); },
  websocket: {
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      db.account(ws.data.pid, ws.data.name);
      lobby.track(ws);
      ws.subscribe('lobby');
      send(ws, { e: 'wallet', wallet: db.wallet(ws.data.pid) });
      send(ws, { e: 'lobby', tables: lobby.list() });
    },
    message: onMessage,
    close(ws) {
      lobby.untrack(ws);
      const t = ws.data.tableId && lobby.tables.get(ws.data.tableId);
      if (t) t.detach(ws);
    },
  },
});
lobby.server = server;

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log('\n♠ Cashing everyone out and closing up');
    lobby.shutdown();
    server.stop(true);
    process.exit(0);
  });
}

console.log(`♠ Lamplight is dealing at ${server.url}  (LAN: http://<this-machine-ip>:${server.port})`);

export { server, lobby };
