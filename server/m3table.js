/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel table
   One shared board, two seats, any number of watchers. It speaks the
   same socket language as the poker and backgammon tables (attach,
   detach, sit, leave, onMessage, summary), so the lobby treats all
   three alike.

   A match: each player puts up the entry (it can be free), picks a
   booster, and the two take turns for a set number of rounds; the
   higher score takes both entries, a tie gives each theirs back.
   The server owns the board and every random refill. Each action goes
   out as the full public state plus the event (waves of clears, falls
   and refills) the browsers animate; the turn clock stops while that
   plays.

   A bot can hold a seat. It steps aside for a person between matches.
   ════════════════════════════════════════════════════════════════════ */
import { secureInt, PROFILES, Fmt } from '../shared/engine.js';
import { Duel, M3, BOOSTERS, PERKS, animMs } from '../shared/match3.js';
import { M3Bot } from './m3bot.js';

const DISCONNECT_GRACE = 60_000; // a dropped player keeps the seat this long, then forfeits the match
const AWAY_KICK = 120_000; // between matches, sitting out this long gives up the seat
const AUTO_ACT = 900; // how fast we play for someone who is sitting out
const SKILLS = ['casual', 'regular', 'sharp'];
const LINES = {
  win: ['Good game.', 'That was fun.', 'The board was kind to me.', 'Another?'],
  lose: ['Well played.', 'Nice combos.', 'You earned that one.', 'Rematch?'],
  greet: ['Ready when you are.', 'Let us see those combos.', 'Good luck. You will need it.', 'Shall we?'],
  big: ['Ooh.', 'Now that is a cascade.', 'Not bad at all.'],
};
const EMOTES = ['clap', 'hurry', 'like', 'facepalm', 'cool', 'flag'];
const pick = a => a[secureInt(a.length)];
const boosterKeys = Object.keys(BOOSTERS);

export class M3Table {
  constructor(lobby, {
    id, name, format = 'classic', entry = 100, speed = 'normal', bot = true, skill = 'regular', permanent = false, db = null,
  }) {
    this.lobby = lobby; this.db = db;
    this.id = id; this.name = name; this.permanent = permanent;
    this.game = 'm3';
    this.format = M3.formats[format] ? format : 'classic';
    this.entry = M3.entries.includes(Number(entry)) ? Number(entry) : 100;
    this.speed = M3.speeds[speed] ? speed : 'normal';
    this.withBot = !!bot;
    this.skill = SKILLS.includes(skill) ? skill : 'regular';
    this.clients = new Set();
    this.seats = [null, null];
    this.reservations = []; // [{ token, pid, name, seat, booster }]
    this.emptySince = Date.now();
    this.d = null; // the duel on the board (kept after it ends, so the final board stays up)
    this.matchNo = 0;
    this.result = null;
    this.log = [];
    this.prompt = null; // { seat, deadline, total, timer }
    this.timer = null; // the table's own next step
    this.nextAt = 0;
    this.flow = 0; // bumped whenever a match ends: stale steps check it and stop
    this.waiting = '';
    this.helper = new M3Bot('regular'); // plays for people who are sitting out
    if (this.withBot) this.placeBot(1);
    this.updateWaiting();
    this.tickT = setInterval(() => this.tick(), 2000);
    this.tickT.unref?.();
  }

  get fast() { return this.speed === 'test'; }
  get live() { return !!(this.d && !this.d.over); }
  /** The last move is still playing out: the result isn't settled yet, so no new match can start. */
  get settling() { return !!(this.d && this.d.over && !this.result); }
  /** Pauses between steps, scaled to the table speed. */
  T(k) {
    const base = { start: 900, intro: 2200, handoff: 1300, think: 750, next: 9000 }[k];
    if (this.fast) return Math.min(base, k === 'next' ? 120 : 10);
    return Math.round(base * (this.speed === 'turbo' ? 0.75 : this.speed === 'relaxed' ? 1.2 : 1));
  }
  /** How long the browsers need to play an event back (nothing at test speed). */
  anim(ev) { return this.fast ? 0 : animMs(ev); }

  /* ───────────── messaging ───────────── */
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* socket gone */ } }
  emit(msg) { const s = JSON.stringify(msg); for (const ws of this.clients) this.send(ws, s); }
  toToken(token, msg) { for (const ws of this.clients) if (ws.data.token === token) this.send(ws, msg); }
  toSeat(i, msg) { const s = this.seats[i]; if (s && s.kind === 'human') this.toToken(s.token, msg); }
  seatOf(ws) { return this.seats.findIndex(s => s && s.kind === 'human' && s.token === ws.data.token); }
  /** Everyone gets the new state, with what just happened. */
  update(ev = null, line = null) {
    if (line) { this.log.push(line); if (this.log.length > 80) this.log.shift(); }
    this.emit({ e: 'm3', s: this.state(), ev, line });
  }
  say(seat, lines, odds = 0.5) {
    const s = this.seats[seat];
    if (!s || s.kind !== 'bot' || Math.random() > odds) return;
    setTimeout(() => this.emit({ e: 'chat', name: s.name, text: pick(lines), seat, bot: true }), this.fast ? 0 : 900 + Math.random() * 900);
  }

  publicSeat(s) {
    return {
      kind: s.kind, name: s.name, id: s.kind === 'human' ? s.id : null, profileKey: s.profileKey || null,
      booster: s.booster, wins: s.wins, connected: s.connected, away: !!s.away,
    };
  }
  state() {
    const d = this.d, p = this.prompt;
    return {
      id: this.id, name: this.name, game: 'm3', format: this.format, entry: this.entry, speed: this.speed, skill: this.skill,
      withBot: this.withBot, matchNo: this.matchNo,
      seats: this.seats.map(s => (s ? this.publicSeat(s) : null)),
      reserved: this.reservations.map(r => ({ seat: r.seat, name: r.name })),
      phase: !d ? 'idle' : d.over ? 'over' : 'play',
      duel: d ? d.toJSON() : null,
      clock: p && p.deadline ? { seat: p.seat, left: Math.max(0, p.deadline - Date.now()), total: p.total } : null,
      result: this.result, waiting: this.waiting,
      nextIn: this.nextAt ? Math.max(0, this.nextAt - Date.now()) : null,
    };
  }
  snapshot(ws) {
    const i = this.seatOf(ws);
    const r = this.reservations.find(x => x.token === ws.data.token);
    return { e: 'm3Snap', s: this.state(), me: i >= 0 ? i : null, pending: r ? r.seat : null, log: this.log.slice(-60) };
  }

  /* ───────────── seats ───────────── */
  placeBot(seat) {
    const other = this.seats[1 - seat];
    const keys = Object.keys(PROFILES).filter(k => !other || other.profileKey !== k);
    const k = keys[secureInt(keys.length)];
    this.seats[seat] = {
      kind: 'bot', name: PROFILES[k].name, profileKey: k, id: null, token: null, wins: 0,
      booster: pick(boosterKeys), connected: true, brain: new M3Bot(this.skill),
    };
  }
  freeSeat(prefer = -1) {
    const taken = new Set(this.reservations.map(r => r.seat));
    const ok = i => (i === 0 || i === 1) && !taken.has(i) && !(this.seats[i] && this.seats[i].kind === 'human');
    if (ok(prefer)) return prefer;
    for (const i of [0, 1]) if (ok(i) && !this.seats[i]) return i;
    for (const i of [0, 1]) if (ok(i)) return i;
    return -1;
  }
  /** A watcher asks for a seat. Returns an error string, or null. */
  sit(ws, prefer = -1, booster = null) {
    if (this.seatOf(ws) >= 0) return null;
    if (this.reservations.some(r => r.token === ws.data.token)) return null;
    const pid = ws.data.pid;
    if (pid && (this.seats.some(s => s && s.kind === 'human' && s.id === pid) || this.reservations.some(r => r.pid === pid))) {
      return "You're already playing at this board in another tab.";
    }
    if (this.db && pid && this.entry) {
      const w = this.db.wallet(pid);
      if (w && w.bankroll < this.entry) return `Your bankroll (${Fmt.usd(w.bankroll)}) can't cover the ${Fmt.usd(this.entry)} entry. Grab free chips in the lobby, or pick a free board.`;
    }
    const seat = this.freeSeat(Number.isInteger(prefer) ? prefer : -1);
    if (seat < 0) return 'Both seats are taken. Watch, or open a board of your own.';
    const r = { token: ws.data.token, pid, name: ws.data.name, seat, booster: BOOSTERS[booster] ? booster : 'ember' };
    // a bot in the middle of a match finishes it first
    if (this.seats[seat] && this.live) {
      this.reservations.push(r);
      this.send(ws, { e: 'pending', seat, now: false, match: true });
      this.update();
      this.lobby.changed();
      return null;
    }
    this.takeSeat(r);
    return null;
  }
  /** Moves a reservation into the seat. Entries are paid when a match starts. */
  takeSeat(r) {
    if (this.seats[r.seat] && this.seats[r.seat].kind === 'bot') this.seats[r.seat] = null;
    const connected = [...this.clients].some(ws => ws.data.token === r.token);
    this.seats[r.seat] = {
      kind: 'human', name: r.name, id: r.pid, token: r.token, profileKey: null, wins: 0, booster: r.booster, paid: false,
      connected, disconnectedAt: connected ? 0 : Date.now(), away: false, awaySince: 0, timeouts: 0,
    };
    for (const ws of this.clients) if (ws.data.token === r.token) this.send(ws, this.snapshot(ws));
    const other = this.seats[1 - r.seat];
    if (other && other.kind === 'bot') this.say(1 - r.seat, LINES.greet, 0.7);
    this.update(null, { t: `${r.name} sits down`, k: 'sys' });
    this.lobby.changed();
    this.maybeStart(this.T('start'));
    return true;
  }
  /** Someone gets up for good. Mid-match that forfeits it. */
  removeHuman(i, why = 'left') {
    const s = this.seats[i];
    if (!s || s.kind !== 'human') return;
    if (this.live) this.forfeit(i, why);
    else if (this.settling) this.matchOver(); // the last move is still playing out: settle it first
    if (s.paid && this.db && s.id) { this.db.cashOut(s.id, this.id, this.entry); this.lobby.pushWallet(s.id); } // only if no match took it
    this.seats[i] = null;
    this.update(null, { t: why === 'gone' ? `${s.name} lost the connection and gives up the seat` : `${s.name} gets up`, k: 'sys' });
    this.lobby.changed();
    if (!this.live) this.maybeStart(this.T('start'));
  }

  /* ───────────── between matches ───────────── */
  settleSeats() {
    if (this.live) return;
    for (const r of this.reservations.splice(0)) {
      const cur = this.seats[r.seat];
      if (cur && cur.kind === 'human') { const s = this.freeSeat(); if (s < 0) { this.toToken(r.token, { e: 'error', msg: 'Someone got to the seat first.' }); continue; } r.seat = s; }
      this.takeSeat(r);
    }
    if (this.withBot) for (const i of [0, 1]) if (!this.seats[i]) this.placeBot(i);
  }
  blocker() {
    const [a, b] = this.seats;
    if (!a || !b) return 'Waiting for an opponent';
    const humans = this.seats.filter(s => s.kind === 'human');
    if (!humans.length) return 'Waiting for a player';
    for (const s of humans) {
      if (!s.connected) return `Waiting for ${s.name} to reconnect`;
      if (s.away) return `${s.name} is sitting out`;
    }
    return '';
  }
  updateWaiting() {
    const msg = this.live ? '' : this.blocker();
    if (msg !== this.waiting) { this.waiting = msg; return true; }
    return false;
  }
  maybeStart(delay = 0) {
    if (this.live || this.settling || this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.live || this.closed) return;
      this.settleSeats();
      const changed = this.updateWaiting();
      if (!this.waiting) { this.newMatch(); return; }
      this.nextAt = 0;
      if (changed) this.update();
      this.lobby.changed();
    }, delay);
  }

  newMatch() {
    // everyone puts up the entry; anyone who can't gives up the seat
    for (const [i, s] of this.seats.entries()) {
      if (s.kind !== 'human' || s.paid || !this.entry) continue;
      if (this.db && s.id && !this.db.buyIn(s.id, this.id, this.entry)) {
        this.toSeat(i, { e: 'error', msg: `Your bankroll can't cover the ${Fmt.usd(this.entry)} entry. Grab free chips in the lobby.` });
        this.seats[i] = null;
        if (this.withBot) this.placeBot(i);
        continue;
      }
      if (s.id) this.lobby.pushWallet(s.id);
      s.paid = true;
    }
    this.updateWaiting();
    if (this.waiting) { this.update(); this.lobby.changed(); return; }
    for (const s of this.seats) if (s.kind === 'bot') s.booster = pick(boosterKeys);
    this.matchNo++;
    this.result = null; this.nextAt = 0;
    const flow = ++this.flow;
    const first = secureInt(2);
    this.between = true; // no moves until the first turn opens
    this.d = new Duel({ format: this.format, first, boosters: this.seats.map(s => s.booster), rng: secureInt });
    const f = M3.formats[this.format];
    this.update({ type: 'start', first, matchNo: this.matchNo }, {
      t: `Match ${this.matchNo}: ${this.seats[0].name} (${BOOSTERS[this.d.boosters[0]].name}) vs ${this.seats[1].name} (${BOOSTERS[this.d.boosters[1]].name}). ${f.rounds} rounds of ${f.moves} moves. ${this.seats[first].name} goes first`,
      k: 'head',
    });
    this.lobby.changed();
    setTimeout(() => { if (flow === this.flow) this.startTurn(); }, this.T('intro'));
  }

  /* ───────────── turns ───────────── */
  startTurn() {
    const d = this.d;
    if (!this.live) return;
    const seat = d.turn, s = this.seats[seat];
    this.between = false;
    this.ask(seat);
    this.update({ type: 'turn', seat, round: d.round }, d.half === 0 ? { t: `Round ${d.round} of ${d.rounds}${d.round === d.rounds ? ', the last' : ''}`, k: 'round' } : null);
    if (s.kind === 'bot' || s.away) this.botStep(seat, this.T('think'));
  }
  /** The bot (or the house, for someone sitting out) takes its next action after `delay`. */
  botStep(seat, delay) {
    const flow = this.flow, d = this.d, round = d.round, half = d.half;
    setTimeout(() => {
      if (flow !== this.flow || !this.live || d.turn !== seat || d.round !== round || d.half !== half) return;
      const s = this.seats[seat];
      if (!s || (s.kind === 'human' && !s.away)) return;
      const brain = s.kind === 'bot' ? s.brain : this.helper;
      const a = brain.choose(d, seat);
      let ev = null;
      if (a && a.t === 'swap') ev = d.swap(seat, a.a, a.b);
      else if (a && a.t === 'boost') ev = d.boost(seat, a.target);
      else if (a && a.t === 'perk') ev = d.perk(seat, a.kind, a.target);
      if (!ev) { console.error(`[m3 ${this.id}] bot action rejected`, a); ev = d.timeout(seat); }
      this.after(seat, ev);
    }, delay);
  }
  /** One player's action went through: tell everyone, then carry on once the browsers have played it. */
  after(seat, ev) {
    const d = this.d, s = this.seats[seat], flow = this.flow;
    const anim = this.anim(ev);
    this.update(ev, this.lineFor(s, ev));
    if (ev.pts >= 25) this.say(1 - seat, LINES.big, 0.4);
    if (d.over) { this.clearPrompt(); setTimeout(() => { if (flow === this.flow) this.matchOver(); }, anim + this.T('start')); return; }
    if (ev.next) {
      this.clearPrompt();
      this.between = true; // the board plays out and the turn is announced before anyone moves again
      setTimeout(() => { if (flow === this.flow) this.startTurn(); }, anim + this.T('handoff'));
      return;
    }
    // the same turn goes on: the clock stood still while the board played out
    const p = this.prompt;
    if (p && p.seat === seat && p.deadline) {
      clearTimeout(p.timer);
      p.deadline += anim;
      p.timer = setTimeout(() => this.expire(p), Math.max(0, p.deadline - Date.now()));
    }
    if (s.kind === 'bot' || s.away) this.botStep(seat, anim + (s.away ? AUTO_ACT : this.T('think')));
  }
  lineFor(s, ev) {
    const bits = [];
    if (ev.type === 'swap') bits.push(ev.combo ? 'combines two specials' : 'swaps');
    else if (ev.type === 'boost') bits.push(`uses ${BOOSTERS[ev.key].name}`);
    else if (ev.type === 'perk') bits.push(`uses the ${PERKS[ev.kind].name}`);
    else if (ev.type === 'timeout') bits.push('runs out of time');
    if (ev.type !== 'timeout') bits.push(`for ${ev.pts} ${ev.pts === 1 ? 'point' : 'points'}`);
    if (ev.waves && ev.waves.length > 1) bits.push(`(${ev.waves.length - 1} cascade${ev.waves.length > 2 ? 's' : ''})`);
    if (ev.extra) bits.push('· extra move');
    if (ev.ready) bits.push('· booster ready');
    return { t: `${s.name} ${bits.join(' ')}`, k: `s${ev.seat}` };
  }

  /* ───────────── the end of a match ───────────── */
  forfeit(seat, why = 'resign') {
    if (!this.live) return;
    const d = this.d;
    this.clearPrompt();
    d.forfeit(seat);
    this.update({ type: 'forfeit', seat }, { t: `${this.seats[seat].name} ${why === 'resign' ? 'resigns' : why === 'gone' ? 'never came back' : 'leaves the match'}`, k: 'sys' });
    this.matchOver(why);
  }
  matchOver(why = null) {
    const d = this.d;
    if (!d || !d.over || this.result) return;
    this.flow++;
    this.clearPrompt();
    const w = d.winner, [A, B] = this.seats;
    const pot = this.entry * 2;
    const kind = d.forfeited != null ? 'forfeit' : w < 0 ? 'draw' : d.landslide ? 'landslide' : 'win';
    if (this.db) {
      this.seats.forEach((s, i) => {
        if (!s || s.kind !== 'human' || !s.id) return;
        const back = !s.paid ? 0 : w < 0 ? this.entry : w === i ? pot : 0;
        this.db.cashOut(s.id, this.id, back);
        this.lobby.pushWallet(s.id);
      });
    }
    for (const s of this.seats) if (s) s.paid = false;
    if (w >= 0 && this.seats[w]) this.seats[w].wins++;
    this.result = {
      winner: w, loser: w >= 0 ? 1 - w : null, kind, scores: d.scores.slice(), landslide: d.landslide, prize: w >= 0 ? pot : this.entry,
      names: [A ? A.name : '', B ? B.name : ''], matchNo: this.matchNo, why,
    };
    this.record(kind);
    const ms = this.T('next');
    this.nextAt = Date.now() + ms; // before the update, so the result card can count down to the next match
    const head = w < 0
      ? `A draw, ${d.scores[0]}-${d.scores[1]}. Entries go back`
      : `${this.seats[w] ? this.seats[w].name : 'Their opponent'} wins ${d.scores[w]}-${d.scores[1 - w]}${kind === 'landslide' ? ', a landslide' : ''}${this.entry ? ` and ${Fmt.usd(pot)}` : ''}`;
    this.update({ type: 'over', result: this.result }, { t: head, k: 'head' });
    if (w >= 0) { this.say(w, LINES.win); this.say(1 - w, LINES.lose); }
    if (w >= 0 && this.seats[w] && this.seats[w].kind === 'human') this.toSeat(w, { e: 'm3Won', prize: this.entry ? pot : 0, landslide: d.landslide });
    this.lobby.changed();
    clearTimeout(this.timer); this.timer = null;
    this.maybeStart(ms);
  }
  who(s) { return s ? { id: s.kind === 'human' ? s.id : `bot:${s.profileKey}`, name: s.name, kind: s.kind } : null; }
  record(kind) {
    if (!this.db) return;
    const d = this.d;
    try {
      const unlocked = this.db.recordM3Match({
        tableId: this.id, tableName: this.name, format: this.format, entry: this.entry,
        seats: this.seats.map(s => this.who(s)), scores: d.scores, winner: d.winner, kind, stats: d.stats,
      });
      for (const u of unlocked) this.announce(u.pid, u.key);
    } catch (err) { console.error(`[m3 ${this.id}] could not save match ${this.matchNo}`, err); }
  }
  announce(pid, key) {
    const s = this.seats.find(x => x && x.kind === 'human' && x.id === pid);
    this.emit({ e: 'achievement', key, name: s ? s.name : '', seat: null, pid });
    this.lobby.pushWallet(pid);
  }

  /* ───────────── clocks ───────────── */
  ask(seat) {
    this.clearPrompt();
    const total = M3.speeds[this.speed].clock * 1000;
    const p = { seat, total, deadline: Date.now() + total, timer: null };
    p.timer = setTimeout(() => this.expire(p), total);
    this.prompt = p;
  }
  clearPrompt() { if (this.prompt) clearTimeout(this.prompt.timer); this.prompt = null; }
  /** Time is up: the rest of the turn is lost. Two in a row and the house plays for them. */
  expire(p) {
    if (this.prompt !== p || !this.live || this.d.turn !== p.seat) return;
    const s = this.seats[p.seat];
    if (s && s.kind === 'human' && !s.away) {
      s.timeouts++;
      if (s.timeouts >= 2) { s.away = true; s.awaySince = Date.now(); this.toSeat(p.seat, { e: 'toast', msg: "You missed two turns, so we're playing for you. Press I'm back to take over" }); }
    }
    this.prompt = null;
    this.after(p.seat, this.d.timeout(p.seat));
  }

  /** Every two seconds: people who dropped and never came back, people sitting out for too long between matches. */
  tick() {
    const now = Date.now();
    for (const i of [0, 1]) {
      const s = this.seats[i];
      if (!s || s.kind !== 'human') continue;
      if (!s.connected && s.disconnectedAt && now - s.disconnectedAt > DISCONNECT_GRACE) { this.removeHuman(i, 'gone'); continue; }
      if (!this.live && s.away && s.awaySince && now - s.awaySince > AWAY_KICK) this.removeHuman(i, 'left');
    }
    if (!this.live && !this.timer && !this.closed && this.seats.some(s => s && s.kind === 'human')) this.maybeStart(0);
  }

  /* ───────────── sockets ───────────── */
  attach(ws) {
    for (const other of this.clients) {
      if (other !== ws && other.data.token === ws.data.token) { this.send(other, { e: 'replaced' }); this.detach(other); other.close(4000, 'replaced'); }
    }
    this.clients.add(ws);
    ws.data.tableId = this.id;
    const i = this.seatOf(ws);
    this.emptySince = 0;
    if (i >= 0) { const s = this.seats[i]; s.connected = true; s.disconnectedAt = 0; }
    this.send(ws, this.snapshot(ws));
    if (i >= 0) { this.updateWaiting(); this.update(); this.maybeStart(this.T('start')); }
    this.lobby.changed();
  }
  detach(ws) {
    if (!this.clients.delete(ws)) return;
    const i = this.seatOf(ws);
    if (i >= 0 && ![...this.clients].some(o => o.data.token === ws.data.token)) {
      // their clock keeps running: a turn they miss is lost, and after the grace period the match is
      const s = this.seats[i];
      s.connected = false; s.disconnectedAt = Date.now();
      this.updateWaiting();
      this.update();
    }
    this.reservations = this.reservations.filter(r => r.token !== ws.data.token || [...this.clients].some(o => o.data.token === r.token));
    if (!this.clients.size) this.emptySince = Date.now();
    this.lobby.changed();
  }
  leave(ws) {
    this.reservations = this.reservations.filter(r => r.token !== ws.data.token);
    const i = this.seatOf(ws);
    if (i >= 0) this.removeHuman(i, 'left');
    this.detach(ws);
  }

  onMessage(ws, m) {
    const i = this.seatOf(ws), s = i >= 0 ? this.seats[i] : null, d = this.d;
    const mine = s && this.live && !this.between && d.turn === i && !s.away;
    const act = ev => {
      if (!ev) { this.send(ws, { e: 'm3', s: this.state(), ev: { type: 'reject', seat: i } }); return; }
      s.timeouts = 0;
      this.after(i, ev);
    };
    const cell = x => (Number.isInteger(x) && x >= 0 && x < 49 ? x : null);
    switch (m.t) {
      case 'swap': if (mine) act(d.swap(i, cell(m.a), cell(m.b))); else if (s) this.send(ws, { e: 'm3', s: this.state(), ev: { type: 'reject', seat: i } }); return;
      case 'boost': if (mine) act(d.boost(i, cell(m.target))); return;
      case 'perk': if (mine) act(d.perk(i, String(m.kind), cell(m.target))); return;
      case 'booster': {
        const key = BOOSTERS[m.key] ? m.key : null;
        if (!key) return;
        if (s) { s.booster = key; this.update(); }
        const r = this.reservations.find(x => x.token === ws.data.token);
        if (r) r.booster = key;
        return;
      }
      case 'resign': if (s && this.live) this.forfeit(i, 'resign'); return;
      case 'sit': { const err = this.sit(ws, m.seat, m.booster); if (err) this.send(ws, { e: 'error', msg: err }); return; }
      case 'back':
        if (s) {
          s.away = false; s.timeouts = 0; s.awaySince = 0;
          this.updateWaiting(); this.update(); this.maybeStart(this.T('start'));
        }
        return;
      case 'sitOut':
        if (s && !s.away) {
          s.away = true; s.awaySince = Date.now(); this.updateWaiting(); this.update();
          if (this.live && d.turn === i && d.moves > 0) this.botStep(i, AUTO_ACT);
        }
        return;
      case 'sync': this.send(ws, this.snapshot(ws)); return;
      case 'chat': {
        const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 160);
        if (text) this.emit({ e: 'chat', name: ws.data.name, text, seat: i >= 0 ? i : null });
        return;
      }
      case 'emote': {
        if (i < 0 || !EMOTES.includes(m.k)) return;
        const now = Date.now();
        if (now - (ws.data.emoteAt || 0) < 1200) return;
        ws.data.emoteAt = now;
        this.emit({ e: 'm3Emote', seat: i, k: m.k });
        return;
      }
    }
  }

  /** Server shutdown: entries stay in escrow and come back on the next start. */
  cashOutAll() {}
  /** Something is riding on this board: don't close it for being idle. */
  busy() { return this.live || this.seats.some(s => s && s.kind === 'human'); }

  summary() {
    const d = this.d;
    return {
      id: this.id, name: this.name, game: 'm3', format: this.format, entry: this.entry, buyIn: this.entry,
      speed: this.speed, skill: this.skill, withBot: this.withBot, permanent: this.permanent, watchers: this.clients.size,
      seats: this.seats.map(s => (s ? { kind: s.kind, name: s.name, profileKey: s.profileKey || null } : { kind: 'empty' })),
      humans: this.seats.filter(s => s && s.kind === 'human').length + this.reservations.length,
      open: this.seats.filter(s => !s || s.kind === 'bot').length - this.reservations.length,
      playing: this.live, scores: d ? d.scores : [0, 0], round: d ? d.round : 0, rounds: M3.formats[this.format].rounds, matchNo: this.matchNo,
    };
  }
  close() {
    this.closed = true; this.flow++;
    this.clearPrompt();
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.tickT);
  }
}
