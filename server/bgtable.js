/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · backgammon table
   One board, two seats, any number of watchers. It speaks the same
   socket language as a poker Table (attach, detach, sit, leave,
   onMessage, summary) so the lobby treats both alike.

   Two formats:
   - money: a stake per point. You sit down with forty points' worth of
     chips from your bankroll; each game moves points x cube x stake from
     loser to winner (never more than the loser has in front of them).
   - match: first to N points. Each player puts up the entry and the
     winner takes both. Crawford rule, dead cubes respected.

   The game itself is a small state machine:
     opening -> roll -> (double -> roll) -> move -> roll ... -> over
   Every change goes out as the full public state (backgammon has no
   secrets), plus a short event the browser animates.

   A bot can hold the second seat. It steps aside for a person between
   games (money) or between matches (match).
   ════════════════════════════════════════════════════════════════════ */
import { secureInt, own, PROFILES, Fmt } from '../shared/engine.js';
import {
  BG, WHITE, BLACK, initialPosition, Turn, winnerOf, winKind, KIND_NAME, pipCount, notation,
} from '../shared/backgammon.js';
import { BgBot, evaluate } from './bgbot.js';

const DISCONNECT_GRACE = 90_000; // a dropped player keeps the seat this long, then forfeits
const AWAY_KICK = 120_000; // between games, sitting out or broke this long gives up the seat
const AUTO_ACT = 1_500; // how fast we play for someone who is sitting out
const SKILLS = ['casual', 'regular', 'sharp'];
const LINES = {
  win: ['Good game.', 'Thanks for the game.', 'The dice were kind.', 'Another?'],
  gammon: ['A gammon. Sorry, not sorry.', 'That one got away from you.'],
  lose: ['Well played.', 'Nice game.', 'You earned that one.', 'Rematch?'],
  greet: ['Welcome to the board.', 'Evening. White or black, it is all the same to me.', 'Shall we?'],
  double: ['I think this is worth two.', 'Let us make it interesting.'],
};
const pick = a => a[secureInt(a.length)];

export class BgTable {
  constructor(lobby, {
    id, name, mode = 'money', stake = 10, entry = 500, matchTo = 5, speed = 'normal', bot = true, skill = 'regular',
    permanent = false, db = null,
  }) {
    this.lobby = lobby; this.db = db;
    this.id = id; this.name = name; this.permanent = permanent;
    this.game = 'bg';
    this.mode = mode === 'match' ? 'match' : 'money';
    this.stake = BG.stakes.includes(Number(stake)) ? Number(stake) : BG.stakes[0];
    this.entry = BG.entries.includes(Number(entry)) ? Number(entry) : 500;
    this.matchTo = this.mode === 'match' ? (BG.lengths.includes(Number(matchTo)) ? Number(matchTo) : 5) : 0;
    this.speed = own(BG.speeds, speed) ? speed : 'normal';
    this.withBot = !!bot;
    this.skill = SKILLS.includes(skill) ? skill : 'regular';
    this.clients = new Set();
    this.seats = [null, null];
    this.reservations = []; // [{ token, pid, name, seat }]
    this.emptySince = Date.now();
    this.scores = [0, 0]; this.crawfordUsed = false; this.matchOver = false; this.matchNo = 1;
    this.gameNo = 0;
    this.g = null; // the game on the board (kept after it ends, so the final position stays up)
    this.result = null;
    this.log = [];
    this.prompt = null; // { seat, kind, deadline, total, timer }
    this.timer = null; // the table's own next step
    this.nextAt = 0;
    this.flow = 0; // bumped whenever a game ends: stale bot steps check it and stop
    this.waiting = '';
    this.helper = new BgBot('regular'); // plays for people whose clock ran out
    if (this.withBot) this.placeBot(BLACK);
    this.updateWaiting();
    this.tickT = setInterval(() => this.tick(), 2000);
    this.tickT.unref?.();
  }

  get fast() { return this.speed === 'test'; }
  get buyIn() { return this.mode === 'money' ? this.stake * BG.buyInPoints : this.entry; }
  /** Pauses between steps, scaled to the table speed. */
  T(k) {
    const base = { opening: 1500, think: 650, step: 430, nomove: 1800, autoRoll: 450, cube: 1100, next: 5000, matchNext: 9000, start: 900 }[k];
    if (this.fast) return Math.min(base, k === 'next' || k === 'matchNext' ? 80 : 15);
    return Math.round(base * (this.speed === 'turbo' ? 0.7 : this.speed === 'relaxed' ? 1.25 : 1));
  }
  get live() { return !!(this.g && this.g.phase !== 'over'); }
  /** A match is under way: seats only change once it is over. */
  get midMatch() { return this.mode === 'match' && !this.matchOver && (this.gameNo > 0 && (this.scores[0] || this.scores[1] || this.live)); }

  /* ───────────── messaging ───────────── */
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* socket gone */ } }
  emit(msg) { const s = JSON.stringify(msg); for (const ws of this.clients) this.send(ws, s); }
  toToken(token, msg) { for (const ws of this.clients) if (ws.data.token === token) this.send(ws, msg); }
  toSeat(i, msg) { const s = this.seats[i]; if (s && s.kind === 'human') this.toToken(s.token, msg); }
  seatOf(ws) { return this.seats.findIndex(s => s && s.kind === 'human' && s.token === ws.data.token); }
  /** Everyone gets the new state, with what just happened. */
  update(ev = null, line = null) {
    if (line) { this.log.push(line); if (this.log.length > 80) this.log.shift(); }
    this.emit({ e: 'bg', s: this.state(), ev, line });
  }
  say(seat, lines) {
    const s = this.seats[seat];
    if (!s || s.kind !== 'bot' || Math.random() < 0.45) return;
    setTimeout(() => this.emit({ e: 'chat', name: s.name, text: pick(lines), seat, bot: true }), this.fast ? 0 : 700 + Math.random() * 900);
  }

  publicSeat(s) {
    return {
      kind: s.kind, name: s.name, id: s.kind === 'human' ? s.id : null, profileKey: s.profileKey || null,
      stack: s.kind === 'human' && this.mode === 'money' ? s.stack : null, net: s.kind === 'human' ? s.stack - s.buyIns : s.net,
      connected: s.connected, away: !!s.away, broke: !!s.broke,
    };
  }
  state() {
    const g = this.g, p = this.prompt;
    return {
      id: this.id, name: this.name, game: 'bg', mode: this.mode, stake: this.stake, entry: this.entry, matchTo: this.matchTo,
      speed: this.speed, skill: this.skill, withBot: this.withBot, buyIn: this.buyIn,
      seats: this.seats.map(s => (s ? this.publicSeat(s) : null)),
      reserved: this.reservations.map(r => ({ seat: r.seat, name: r.name })),
      scores: this.scores, matchOver: this.matchOver, crawford: !!(g && g.crawford), gameNo: this.gameNo,
      phase: g ? g.phase : 'idle', turn: g ? g.turn : null,
      pos: g ? g.pos : initialPosition(), dice: g ? g.dice : null,
      turnState: g && g.phase === 'move' && g.turnObj ? g.turnObj.toJSON() : null,
      cube: g ? g.cube : { value: 1, owner: null }, offerBy: g ? g.offerBy : null, opening: g ? g.opening : null,
      canDouble: g && g.phase === 'roll' ? this.canDouble(g.turn) : false,
      pips: g ? [pipCount(g.pos, WHITE), pipCount(g.pos, BLACK)] : [167, 167],
      clock: p && p.deadline ? { seat: p.seat, kind: p.kind, left: Math.max(0, p.deadline - Date.now()), total: p.total } : null,
      result: this.result, waiting: this.waiting,
      nextIn: this.nextAt ? Math.max(0, this.nextAt - Date.now()) : null,
    };
  }
  snapshot(ws) {
    const i = this.seatOf(ws);
    const r = this.reservations.find(x => x.token === ws.data.token);
    return { e: 'bgSnap', s: this.state(), me: i >= 0 ? i : null, pending: r ? r.seat : null, log: this.log.slice(-60) };
  }

  /* ───────────── seats ───────────── */
  placeBot(seat) {
    const other = this.seats[1 - seat];
    const keys = Object.keys(PROFILES).filter(k => !other || other.profileKey !== k);
    const k = keys[secureInt(keys.length)];
    this.seats[seat] = {
      kind: 'bot', name: PROFILES[k].name, profileKey: k, id: null, token: null, stack: 0, buyIns: 0, net: 0,
      connected: true, brain: new BgBot(this.skill),
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
  sit(ws, prefer = -1) {
    if (this.seatOf(ws) >= 0) return null;
    if (this.reservations.some(r => r.token === ws.data.token)) return null;
    const pid = ws.data.pid;
    if (pid && (this.seats.some(s => s && s.kind === 'human' && s.id === pid) || this.reservations.some(r => r.pid === pid))) {
      return "You're already sitting at this board in another tab.";
    }
    if (this.db && pid) {
      const w = this.db.wallet(pid);
      if (w && w.bankroll < this.buyIn) return `Your bankroll (${Fmt.usd(w.bankroll)}) can't cover the ${Fmt.usd(this.buyIn)} ${this.mode === 'match' ? 'entry' : 'buy-in'}. Grab free chips in the lobby, or pick lower stakes.`;
    }
    const seat = this.freeSeat(Number.isInteger(prefer) ? prefer : -1);
    if (seat < 0) return 'Both seats are taken. Watch, or open a board of your own.';
    const r = { token: ws.data.token, pid, name: ws.data.name, seat };
    // a bot in the middle of a game (or a match) finishes it first
    const busy = this.seats[seat] && (this.mode === 'match' ? this.midMatch : this.live);
    if (busy) {
      this.reservations.push(r);
      this.send(ws, { e: 'pending', seat, now: false, match: this.mode === 'match' });
      this.update();
      this.lobby.changed();
      return null;
    }
    return this.takeSeat(r, true) ? null : this.lastError;
  }
  /** Moves a reservation into the seat: charges the buy-in or entry first. `quiet` leaves the error for the caller to send. */
  takeSeat(r, quiet = false) {
    if (this.db && r.pid) {
      if (!this.db.buyIn(r.pid, this.id, this.buyIn)) {
        this.lastError = `Your bankroll can't cover the ${Fmt.usd(this.buyIn)} ${this.mode === 'match' ? 'entry' : 'buy-in'}. Grab free chips in the lobby.`;
        if (!quiet) this.toToken(r.token, { e: 'error', msg: this.lastError });
        return false;
      }
      this.lobby.pushWallet(r.pid);
    }
    const connected = [...this.clients].some(ws => ws.data.token === r.token);
    this.seats[r.seat] = {
      kind: 'human', name: r.name, id: r.pid, token: r.token, profileKey: null,
      stack: this.mode === 'money' ? this.buyIn : 0, buyIns: this.mode === 'money' ? this.buyIn : 0, net: 0,
      paid: this.mode === 'match', connected, disconnectedAt: connected ? 0 : Date.now(), away: false, awaySince: 0, timeouts: 0, broke: false,
    };
    for (const ws of this.clients) if (ws.data.token === r.token) this.send(ws, this.snapshot(ws));
    const other = this.seats[1 - r.seat];
    if (other && other.kind === 'bot') this.say(1 - r.seat, LINES.greet);
    this.update(null, { t: `${r.name} sits down`, k: 'sys' });
    this.lobby.changed();
    this.maybeStart(this.T('start'));
    return true;
  }
  /** Someone gets up for good. Mid-game that is a resignation; mid-match, a forfeit of the match. */
  removeHuman(i, why = 'left') {
    const s = this.seats[i];
    if (!s || s.kind !== 'human') return;
    if (this.mode === 'match' && this.midMatch) this.forfeitMatch(i, why);
    else if (this.live) this.resign(i, why);
    const refund = this.mode === 'money' ? s.stack : s.paid ? this.entry : 0;
    if (this.db && s.id) { this.db.cashOut(s.id, this.id, refund); this.lobby.pushWallet(s.id); }
    this.seats[i] = null;
    this.update(null, { t: why === 'gone' ? `${s.name} lost the connection and gives up the seat` : `${s.name} gets up`, k: 'sys' });
    this.lobby.changed();
    if (!this.live) this.maybeStart(this.T('start'));
  }

  /* ───────────── between games ───────────── */
  /** Applies seat changes that wait for a break in play. */
  settleSeats() {
    if (this.live || (this.mode === 'match' && this.midMatch)) return;
    for (const r of this.reservations.splice(0)) {
      const cur = this.seats[r.seat];
      if (cur && cur.kind === 'human') { const s = this.freeSeat(); if (s < 0) { this.toToken(r.token, { e: 'error', msg: 'Someone got to the seat first.' }); continue; } r.seat = s; }
      if (this.seats[r.seat] && this.seats[r.seat].kind === 'bot') this.seats[r.seat] = null;
      if (!this.takeSeat(r) && this.withBot && !this.seats[r.seat]) this.placeBot(r.seat);
    }
    if (this.withBot) for (const i of [0, 1]) if (!this.seats[i]) this.placeBot(i);
  }
  /** Why the next game can't start yet, or '' if it can. */
  blocker() {
    const [a, b] = this.seats;
    if (!a || !b) return 'Waiting for an opponent';
    const humans = this.seats.filter(s => s.kind === 'human');
    if (!humans.length) return 'Waiting for a player';
    for (const s of humans) {
      if (!s.connected) return `Waiting for ${s.name} to reconnect`;
      if (s.away) return `${s.name} is sitting out`;
      if (this.mode === 'money' && s.stack < this.stake) return `Waiting for ${s.name} to rebuy`;
    }
    return '';
  }
  updateWaiting() {
    const msg = this.live ? '' : this.blocker();
    if (msg !== this.waiting) { this.waiting = msg; return true; }
    return false;
  }
  /** Starts the next game after `delay`, once nothing stands in the way. */
  maybeStart(delay = 0) {
    if (this.live || this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.live || this.closed) return;
      this.settleSeats();
      for (const [i, s] of this.seats.entries()) {
        if (s && s.kind === 'human' && this.mode === 'money' && s.stack < this.stake && !s.broke) {
          s.broke = true; s.awaySince = Date.now();
          this.toSeat(i, { e: 'bgBusted', buyIn: this.buyIn });
        }
      }
      const changed = this.updateWaiting();
      if (!this.waiting) { this.newGame(); return; }
      this.nextAt = 0;
      if (changed) this.update();
      this.lobby.changed();
    }, delay);
  }

  newGame() {
    if (this.mode === 'match' && this.matchOver) {
      // a fresh match: everyone puts up the entry again
      for (const [i, s] of this.seats.entries()) {
        if (!s || s.kind !== 'human' || s.paid) continue;
        if (this.db && s.id && !this.db.buyIn(s.id, this.id, this.entry)) {
          this.toSeat(i, { e: 'error', msg: `Your bankroll can't cover the ${Fmt.usd(this.entry)} entry for another match.` });
          this.seats[i] = null;
          if (this.withBot) this.placeBot(i);
          continue;
        }
        if (s.id) this.lobby.pushWallet(s.id);
        s.paid = true;
      }
      if (this.blocker()) { this.updateWaiting(); this.update(); return; }
      this.scores = [0, 0]; this.crawfordUsed = false; this.matchOver = false; this.matchNo++; this.gameNo = 0;
    }
    this.gameNo++;
    this.result = null; this.nextAt = 0; this.waiting = '';
    const flow = ++this.flow;
    let crawford = false;
    if (this.mode === 'match' && !this.crawfordUsed && this.scores.some(x => x === this.matchTo - 1)) { crawford = true; this.crawfordUsed = true; }
    let a, b;
    do { a = 1 + secureInt(6); b = 1 + secureInt(6); } while (a === b);
    this.g = {
      no: this.gameNo, pos: initialPosition(), phase: 'opening', turn: a > b ? WHITE : BLACK, dice: null, turnObj: null,
      cube: { value: 1, owner: null }, offerBy: null, opening: [a, b], crawford, startedAt: Date.now(), turns: 0,
    };
    const [w, k] = this.seats;
    const head = this.mode === 'match' ? `Game ${this.gameNo}, match to ${this.matchTo} (${this.scores[0]}-${this.scores[1]})${crawford ? ', Crawford game' : ''}` : `Game ${this.gameNo}`;
    this.update({ type: 'opening', dice: [a, b] }, { t: `${head}. Opening roll: ${w.name} ${a}, ${k.name} ${b}`, k: 'head' });
    this.lobby.changed();
    setTimeout(() => {
      if (flow !== this.flow) return;
      this.g.dice = [a, b];
      this.beginMove(this.g.turn, [a, b]);
    }, this.T('opening'));
  }

  /* ───────────── turns ───────────── */
  canDouble(seat) {
    const g = this.g;
    if (!g || g.phase !== 'roll' || g.turn !== seat || g.crawford) return false;
    if (g.cube.value >= BG.maxCube) return false;
    if (g.cube.owner != null && g.cube.owner !== seat) return false;
    if (this.mode === 'match' && this.scores[seat] + g.cube.value >= this.matchTo) return false; // dead cube
    return true;
  }
  startTurn(seat) {
    const g = this.g, flow = this.flow;
    g.turn = seat; g.phase = 'roll'; g.dice = null; g.turnObj = null; g.offerBy = null;
    const s = this.seats[seat];
    if (s.kind === 'bot') {
      this.update();
      setTimeout(() => {
        if (flow !== this.flow) return;
        const away = this.mode === 'match' ? this.matchTo - this.scores[seat] : null;
        if (this.canDouble(seat) && s.brain.wantsDouble(g.pos, seat, { cube: g.cube.value, matchAway: away })) this.offerDouble(seat);
        else this.roll(seat);
      }, this.T('think'));
      return;
    }
    if (!this.canDouble(seat)) {
      // nothing to decide before the roll: roll for them
      this.update();
      setTimeout(() => { if (flow === this.flow && g.phase === 'roll' && g.turn === seat) this.roll(seat); }, this.T('autoRoll'));
      return;
    }
    this.ask(seat, 'roll');
    this.update();
  }
  roll(seat) {
    const g = this.g;
    if (!g || g.phase !== 'roll' || g.turn !== seat) return;
    this.clearPrompt();
    this.beginMove(seat, [1 + secureInt(6), 1 + secureInt(6)]);
  }
  beginMove(seat, dice) {
    const g = this.g, flow = this.flow;
    g.turn = seat; g.dice = dice; g.phase = 'move'; g.turns++;
    g.turnObj = new Turn(g.pos, seat, dice);
    const s = this.seats[seat];
    if (g.turnObj.required === 0) {
      this.update({ type: 'roll', seat, dice, none: true });
      setTimeout(() => { if (flow === this.flow) this.endTurn(); }, this.T('nomove'));
      return;
    }
    if (s.kind === 'bot') {
      this.update({ type: 'roll', seat, dice });
      const moves = s.brain.choose(g.pos, seat, dice);
      this.playSteps(seat, moves, flow);
      return;
    }
    this.ask(seat, 'move');
    this.update({ type: 'roll', seat, dice });
  }
  /** Plays a list of single moves one at a time, so the board can animate each, then ends the turn. */
  playSteps(seat, moves, flow, first = this.T('think')) {
    const g = this.g;
    let k = 0;
    const step = () => {
      if (flow !== this.flow || g.phase !== 'move' || g.turn !== seat) return;
      if (k >= moves.length) { this.endTurn(); return; }
      const m = moves[k++];
      const ok = g.turnObj.legal().find(x => x.from === m.from && x.to === m.to && x.die === m.die);
      if (!ok) { console.error(`[bg ${this.id}] bot move out of step`, m); this.autoFinish(seat); this.endTurn(); return; }
      g.turnObj.apply(ok); g.pos = g.turnObj.pos;
      this.update({ type: 'move', seat, moves: [ok] });
      if (winnerOf(g.pos) >= 0) { this.endTurn(); return; }
      setTimeout(step, this.T('step'));
    };
    setTimeout(step, first);
  }
  /** Finishes whatever is left of a turn the way the helper bot would. */
  autoFinish(seat) {
    const g = this.g, t = g.turnObj;
    if (!t || t.done) return [];
    let best = null, bestS = -Infinity;
    for (const e of t.fork().endings()) {
      const sc = evaluate(e.pos, seat);
      if (sc > bestS) { bestS = sc; best = e; }
    }
    const extra = best ? best.moves.slice(t.moves.length) : [];
    for (const m of extra) t.apply(m);
    g.pos = t.pos;
    return extra;
  }
  endTurn() {
    const g = this.g;
    if (!g || g.phase !== 'move') return;
    this.clearPrompt();
    const t = g.turnObj, seat = g.turn, s = this.seats[seat];
    g.pos = t.pos;
    const played = notation(seat, t.moves);
    const line = { t: `${s.name} ${t.dice[0]}-${t.dice[1]}: ${played || "can't move"}`, k: seat === WHITE ? 'w' : 'b' };
    this.log.push(line); if (this.log.length > 80) this.log.shift();
    this.emit({ e: 'bgLine', line });
    const w = winnerOf(g.pos);
    if (w >= 0) { const mult = winKind(g.pos, w); this.gameOver(w, mult * g.cube.value, KIND_NAME[mult], mult); return; }
    this.startTurn(1 - seat);
  }

  /* ───────────── the cube ───────────── */
  offerDouble(seat) {
    const g = this.g, flow = this.flow;
    if (!this.canDouble(seat)) return false;
    this.clearPrompt();
    g.phase = 'double'; g.offerBy = seat;
    const other = 1 - seat, o = this.seats[other];
    this.say(seat, LINES.double);
    if (o.kind === 'bot') {
      this.update({ type: 'double', seat, value: g.cube.value * 2 }, { t: `${this.seats[seat].name} doubles to ${g.cube.value * 2}`, k: 'cube' });
      setTimeout(() => {
        if (flow !== this.flow || g.phase !== 'double') return;
        if (o.brain.takes(g.pos, other)) this.take(other); else this.drop(other);
      }, this.T('cube'));
    } else {
      this.ask(other, 'double');
      this.update({ type: 'double', seat, value: g.cube.value * 2 }, { t: `${this.seats[seat].name} doubles to ${g.cube.value * 2}`, k: 'cube' });
    }
    return true;
  }
  take(seat) {
    const g = this.g;
    if (!g || g.phase !== 'double' || g.offerBy !== 1 - seat) return;
    this.clearPrompt();
    g.cube = { value: g.cube.value * 2, owner: seat };
    const doubler = g.offerBy;
    g.offerBy = null;
    this.log.push({ t: `${this.seats[seat].name} takes. The cube is on ${g.cube.value}`, k: 'cube' });
    this.emit({ e: 'bgLine', line: this.log.at(-1) });
    this.startTurn(doubler); // the doubler rolls; they can't double again
  }
  drop(seat) {
    const g = this.g;
    if (!g || g.phase !== 'double' || g.offerBy !== 1 - seat) return;
    this.clearPrompt();
    this.gameOver(g.offerBy, g.cube.value, 'drop', 1);
  }
  resign(seat, why = 'resign') {
    const g = this.g;
    if (!this.live) return;
    const w = 1 - seat, mult = winKind(g.pos, w);
    this.gameOver(w, mult * g.cube.value, why === 'resign' ? 'resign' : 'forfeit', mult);
  }
  /** A match player walks away: the opponent wins the match (and the game in progress, if any). */
  forfeitMatch(seat) {
    const w = 1 - seat;
    if (this.live) { this.flow++; this.clearPrompt(); this.g.phase = 'over'; }
    this.scores[w] = Math.max(this.scores[w], this.matchTo);
    this.result = {
      winner: w, loser: seat, points: 0, cube: this.g ? this.g.cube.value : 1, kind: 'forfeit', mult: 1, amount: 0,
      scores: this.scores.slice(), matchOver: true, gameNo: this.gameNo, names: this.seats.map(s => s && s.name),
    };
    this.finishMatch(w);
    this.update({ type: 'over', result: this.result }, { t: `${this.seats[seat].name} leaves the match. ${this.seats[w].name} wins it`, k: 'head' });
    this.scheduleNext(true);
  }

  /* ───────────── the end of a game ───────────── */
  gameOver(w, points, kind, mult) {
    const g = this.g;
    this.flow++;
    this.clearPrompt();
    g.phase = 'over'; g.offerBy = null;
    const l = 1 - w, W = this.seats[w], L = this.seats[l];
    let amount = 0, matchOver = false;
    if (this.mode === 'money') {
      amount = points * this.stake;
      if (L.kind === 'human') amount = Math.min(amount, L.stack);
      if (L.kind === 'human') L.stack -= amount; else L.net -= amount;
      if (W.kind === 'human') W.stack += amount; else W.net += amount;
      for (const s of [W, L]) if (s.kind === 'human' && this.db && s.id) this.db.checkpoint(s.id, this.id, s.stack);
    } else {
      this.scores[w] += points;
      matchOver = this.scores[w] >= this.matchTo;
    }
    this.result = {
      winner: w, loser: l, points, cube: g.cube.value, kind, mult, amount, scores: this.scores.slice(), matchOver,
      gameNo: this.gameNo, names: [this.seats[0].name, this.seats[1].name],
    };
    this.record(w, points, kind, mult, amount);
    if (matchOver) this.finishMatch(w);
    const what = kind === 'drop' ? `${L.name} passes` : kind === 'resign' ? `${L.name} resigns` : kind === 'forfeit' ? `${L.name} forfeits` : `${W.name} bears off`;
    const worth = `${points} ${points === 1 ? 'point' : 'points'}${this.mode === 'money' ? ` (${Fmt.usd(amount)})` : ''}`;
    const sort = mult === 3 && kind !== 'drop' ? ', a backgammon' : mult === 2 && kind !== 'drop' ? ', a gammon' : '';
    this.update({ type: 'over', result: this.result }, { t: `${what}. ${W.name} wins ${worth}${sort}${matchOver ? `, and the match ${this.scores[w]}-${this.scores[l]}` : ''}`, k: 'head' });
    this.say(w, mult >= 2 ? LINES.gammon : LINES.win);
    this.say(l, LINES.lose);
    this.lobby.changed();
    this.scheduleNext(matchOver);
  }
  scheduleNext(matchOver) {
    const ms = this.T(matchOver ? 'matchNext' : 'next');
    this.nextAt = Date.now() + ms;
    clearTimeout(this.timer); this.timer = null;
    this.maybeStart(ms);
  }
  finishMatch(w) {
    this.matchOver = true;
    const W = this.seats[w], L = this.seats[1 - w];
    if (this.db) {
      if (W && W.kind === 'human' && W.id) { this.db.cashOut(W.id, this.id, this.entry * 2); this.lobby.pushWallet(W.id); }
      if (L && L.kind === 'human' && L.id) { this.db.cashOut(L.id, this.id, 0); this.lobby.pushWallet(L.id); }
    }
    for (const s of [W, L]) if (s) s.paid = false;
    if (this.db) {
      try {
        const unlocked = this.db.recordBgMatch({ winner: this.who(W), loser: this.who(L), entry: this.entry, matchTo: this.matchTo, scores: this.scores });
        for (const u of unlocked) this.announce(u.pid, u.key);
      } catch (err) { console.error(`[bg ${this.id}] could not save the match`, err); }
    }
    if (W && W.kind === 'human') this.toSeat(w, { e: 'bgMatchWon', prize: this.entry * 2, scores: this.scores.slice() });
  }
  who(s) { return s ? { id: s.kind === 'human' ? s.id : `bot:${s.profileKey}`, name: s.name, kind: s.kind } : null; }
  record(w, points, kind, mult, amount) {
    if (!this.db) return;
    try {
      const unlocked = this.db.recordBgGame({
        tableId: this.id, tableName: this.name, mode: this.mode, stake: this.mode === 'money' ? this.stake : 0,
        seats: this.seats.map(s => this.who(s)), winner: w, points, cube: this.g.cube.value, kind, mult, amount, turns: this.g.turns,
      });
      for (const u of unlocked) this.announce(u.pid, u.key);
    } catch (err) { console.error(`[bg ${this.id}] could not save game ${this.gameNo}`, err); }
  }
  announce(pid, key) {
    const s = this.seats.find(x => x && x.kind === 'human' && x.id === pid);
    this.emit({ e: 'achievement', key, name: s ? s.name : '', seat: null, pid });
    this.lobby.pushWallet(pid);
  }

  /* ───────────── clocks ───────────── */
  ask(seat, kind) {
    this.clearPrompt();
    const s = this.seats[seat];
    const total = Math.round(BG.speeds[this.speed].clock * (kind === 'move' ? 1 : 0.6));
    const p = { seat, kind, total, deadline: 0, timer: null };
    this.prompt = p;
    if (!s.connected && !s.away) return; // offline: the seat waits for them (and forfeits after the grace period)
    const ms = s.away ? AUTO_ACT : total;
    p.deadline = Date.now() + ms;
    p.timer = setTimeout(() => this.expire(p), ms);
  }
  clearPrompt() { if (this.prompt) clearTimeout(this.prompt.timer); this.prompt = null; }
  expire(p) {
    if (this.prompt !== p) return;
    const s = this.seats[p.seat];
    if (s && s.kind === 'human' && !s.away) {
      s.timeouts++;
      if (s.timeouts >= 2) { s.away = true; s.awaySince = Date.now(); this.toSeat(p.seat, { e: 'toast', msg: "You missed two turns, so we're playing for you. Press I'm back to take over" }); }
    }
    this.autoPlay(p.seat, p.kind);
  }
  /** Plays for someone who ran out of time or is sitting out. */
  autoPlay(seat, kind) {
    const g = this.g;
    if (!g) return;
    this.clearPrompt();
    if (kind === 'roll' && g.phase === 'roll' && g.turn === seat) this.roll(seat);
    else if (kind === 'move' && g.phase === 'move' && g.turn === seat) {
      const extra = this.autoFinish(seat);
      if (extra.length) this.update({ type: 'move', seat, moves: extra });
      this.endTurn();
    } else if (kind === 'double' && g.phase === 'double' && g.offerBy === 1 - seat) {
      if (this.helper.takes(g.pos, seat)) this.take(seat); else this.drop(seat);
    }
  }
  /** Gives a prompt a fresh clock: someone came back. */
  restartPrompt(seat) {
    const p = this.prompt;
    if (p && p.seat === seat) this.ask(seat, p.kind);
  }

  /** Every two seconds: people who dropped and never came back, people sitting out for too long between games. */
  tick() {
    const now = Date.now();
    for (const i of [0, 1]) {
      const s = this.seats[i];
      if (!s || s.kind !== 'human') continue;
      if (!s.connected && s.disconnectedAt && now - s.disconnectedAt > DISCONNECT_GRACE) { this.removeHuman(i, 'gone'); continue; }
      if (!this.live && (s.away || s.broke) && s.awaySince && now - s.awaySince > AWAY_KICK) this.removeHuman(i, 'left');
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
    if (i >= 0) {
      const s = this.seats[i];
      const was = s.connected;
      s.connected = true; s.disconnectedAt = 0;
      if (!was) this.restartPrompt(i);
    }
    this.send(ws, this.snapshot(ws));
    if (i >= 0) { this.updateWaiting(); this.update(); this.maybeStart(this.T('start')); }
    this.lobby.changed();
  }
  detach(ws) {
    if (!this.clients.delete(ws)) return;
    const i = this.seatOf(ws);
    if (i >= 0 && ![...this.clients].some(o => o.data.token === ws.data.token)) {
      const s = this.seats[i];
      s.connected = false; s.disconnectedAt = Date.now();
      const p = this.prompt;
      if (p && p.seat === i && !s.away) { clearTimeout(p.timer); p.timer = null; p.deadline = 0; } // their clock stops until they come back
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
    const i = this.seatOf(ws), s = i >= 0 ? this.seats[i] : null, g = this.g;
    const mine = s && g && g.turn === i;
    const touch = () => { s.timeouts = 0; };
    switch (m.t) {
      case 'roll': if (mine && g.phase === 'roll') { touch(); this.roll(i); } return;
      case 'double': if (mine && this.canDouble(i)) { touch(); this.offerDouble(i); } return;
      case 'take': if (s && g && g.phase === 'double' && g.offerBy === 1 - i) { touch(); this.take(i); } return;
      case 'drop': if (s && g && g.phase === 'double' && g.offerBy === 1 - i) { touch(); this.drop(i); } return;
      case 'move': {
        if (!mine || g.phase !== 'move') return;
        const at = x => (x === 'bar' || x === 'off' ? x : Number.isInteger(x) && x >= 0 && x < 24 ? x : null);
        const from = at(m.from), to = at(m.to);
        if (from == null || to == null) return;
        const path = g.turnObj.play(from, to);
        if (!path) { this.send(ws, { e: 'bg', s: this.state(), ev: { type: 'reject' } }); return; }
        touch();
        g.pos = g.turnObj.pos;
        if (winnerOf(g.pos) >= 0) { this.update({ type: 'move', seat: i, moves: path }); this.endTurn(); return; }
        this.update({ type: 'move', seat: i, moves: path });
        return;
      }
      case 'undo':
        if (mine && g.phase === 'move' && g.turnObj.moves.length) { g.turnObj.undo(); g.pos = g.turnObj.pos; touch(); this.update({ type: 'undo', seat: i }); }
        return;
      case 'done': if (mine && g.phase === 'move' && g.turnObj.done) { touch(); this.endTurn(); } return;
      case 'resign': if (s && this.live) this.resign(i, 'resign'); return;
      case 'sit': { const err = this.sit(ws, m.seat); if (err) this.send(ws, { e: 'error', msg: err }); return; }
      case 'rebuy': {
        if (!s || this.mode !== 'money' || s.stack >= this.stake) return;
        if (this.db && s.id && !this.db.buyIn(s.id, this.id, this.buyIn)) { this.send(ws, { e: 'error', msg: "Your bankroll can't cover a rebuy. Grab free chips in the lobby." }); return; }
        s.stack += this.buyIn; s.buyIns += this.buyIn; s.broke = false; s.awaySince = 0;
        if (s.id) this.lobby.pushWallet(s.id);
        this.updateWaiting(); this.update(null, { t: `${s.name} rebuys for ${Fmt.usd(this.buyIn)}`, k: 'sys' });
        this.maybeStart(this.T('start'));
        return;
      }
      case 'back':
        if (s) { s.away = false; s.timeouts = 0; s.awaySince = 0; this.restartPrompt(i); this.updateWaiting(); this.update(); this.maybeStart(this.T('start')); }
        return;
      case 'sitOut': if (s) { s.away = true; s.awaySince = Date.now(); this.updateWaiting(); this.update(); } return;
      case 'sync': this.send(ws, this.snapshot(ws)); return;
      case 'chat': {
        const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 160);
        if (text) this.emit({ e: 'chat', name: ws.data.name, text, seat: i >= 0 ? i : null });
        return;
      }
    }
  }

  /** Server shutdown: money on the board goes home. Match entries stay in escrow and come back on the next start. */
  cashOutAll() {
    if (!this.db) return;
    for (const s of this.seats) if (s && s.kind === 'human' && s.id && this.mode === 'money') this.db.cashOut(s.id, this.id, s.stack);
  }
  /** Something is riding on this board: don't close it for being idle. */
  busy() { return this.live || this.seats.some(s => s && s.kind === 'human'); }

  summary() {
    return {
      id: this.id, name: this.name, game: 'bg', mode: this.mode, stake: this.stake, entry: this.entry, matchTo: this.matchTo,
      speed: this.speed, skill: this.skill, withBot: this.withBot, buyIn: this.buyIn, permanent: this.permanent, watchers: this.clients.size,
      seats: this.seats.map(s => (s ? { kind: s.kind, name: s.name, profileKey: s.profileKey || null } : { kind: 'empty' })),
      humans: this.seats.filter(s => s && s.kind === 'human').length + this.reservations.length,
      open: this.seats.filter(s => !s || s.kind === 'bot').length - this.reservations.length,
      playing: this.live, scores: this.scores, gameNo: this.gameNo, matchOver: this.matchOver,
    };
  }
  close() {
    this.closed = true; this.flow++;
    this.clearPrompt();
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.tickT);
  }
}
