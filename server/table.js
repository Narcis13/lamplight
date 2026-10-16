/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · table
   One six-seat table: owns a Game, the seats, and the sockets watching
   it. The Game's view/panel/log calls are turned into messages here.

   Two kinds of table:
   - cash: blinds never change, buy-ins come out of the bankroll and
     go back into it when you get up. Bots fill open seats if asked.
   - sng: a Sit & Go. Players register, bots fill the rest at the start,
     blinds rise every few hands, the last one standing wins, the top
     two are paid from the prize pool.

   Seat changes (someone sits, leaves, a bot makes room, a rebuy) are
   queued and applied only between hands, in beforeHand().
   ════════════════════════════════════════════════════════════════════ */
import { sleep, secureInt, shuffleArr, PROFILES, SPEEDS, STAKES, SNG, Fmt } from '../shared/engine.js';
import { Game, Player, HandLog } from './game.js';

const DISCONNECT_GRACE = 90_000; // a dropped player keeps the seat this long
const AUTO_ACT_OFFLINE = 1_500; // how fast we act for someone who is offline or away
const SKILL = { casual: 0.35, regular: 0.7, sharp: 1 };
const EMOTES = ['👍', '😂', '😮', '😡', '🔥', '🐟', '🙏', '👏', '🤔', '😎'];
const SNG_FIRST_WAIT = 45_000, SNG_JOIN_WAIT = 20_000; // registration countdown

export class Table {
  constructor(lobby, {
    id, name, mode = 'cash', stakes = 'micro', speed = 'normal', buyInBB = 100, fillBots = true, bots = 5,
    skill = 'regular', sngBuyIn = 500, permanent = false, auto = false, db = null,
  }) {
    this.lobby = lobby; this.db = db;
    this.id = id; this.name = name; this.permanent = permanent; this.auto = auto;
    this.mode = mode === 'sng' ? 'sng' : 'cash';
    this.speed = SPEEDS[speed] ? speed : 'normal';
    this.skillKey = SKILL[skill] != null ? skill : 'regular';
    this.fillBots = this.mode === 'cash' && fillBots;
    this.clients = new Set();
    this.reservations = []; // [{ token, pid, name, seat }]
    this.prompt = null; // { id, seat, resolve, deadline, L, bankFrom }
    this.ritPrompt = null; // { id, seats, answer, finish } while players decide on running it twice
    this.promptSeq = 0;
    this.emptySince = Date.now();
    this.lastSig = '';
    this.waitingMsg = '';
    this.departed = 0; // net of everyone who left, so chips on the table always reconcile with buy-ins
    this.lastHandId = null;
    this.emoteAt = new Map();

    this.log = new HandLog();
    this.log.onStart = no => this.emit({ e: 'logStart', no });
    this.log.onLine = (no, l) => this.emit({ e: 'log', no, ...l });

    const st = this.mode === 'sng' ? { sb: SNG.levels[0][0], bb: SNG.levels[0][1] } : (STAKES[stakes] || STAKES.micro);
    this.stakesKey = STAKES[stakes] ? stakes : 'micro';
    this.game = new Game({ view: this.view(), panel: this, log: this.log, settings: { speed: this.speed, tournament: this.mode === 'sng', runTwice: this.mode === 'cash' }, stakes: st });
    const g = this.game;
    g.buyIn = this.mode === 'sng' ? SNG.chips : buyInBB * g.bb;
    g.players = Array.from({ length: 6 }, (_, i) => Player.empty(i));
    g.button = secureInt(6);
    if (this.mode === 'sng') {
      this.tourney = {
        state: 'registering', buyIn: SNG.buyIns.includes(Number(sngBuyIn)) ? Number(sngBuyIn) : 500,
        level: 0, handsAtLevel: 0, startsAt: 0, startedAt: 0, results: [], places: {},
      };
    } else {
      const seatsForBots = shuffleArr([0, 1, 2, 3, 4, 5]).slice(0, fillBots ? 5 : Math.max(0, Math.min(5, bots)));
      for (const s of seatsForBots) this.placeBot(s);
    }
    setTimeout(() => this.loop(), 0);
  }

  /** Runs the game forever. A bug in one hand must not take the table (or the server) down. */
  async loop() {
    const g = this.game;
    while (!this.closed) {
      try { await g.run(); } catch (err) {
        console.error(`[table ${this.id}] hand ${g.handNo} crashed, refunding the pot`, err);
        for (const p of g.players) { p.stack += p.total; p.total = 0; p.bet = 0; p.folded = true; }
        if (this.prompt) { clearTimeout(this.prompt.timer); this.prompt = null; }
        if (this.ritPrompt) { clearTimeout(this.ritPrompt.timer); this.ritPrompt = null; }
        g.rit = false; g.board2 = null;
        g.street = 'done';
        this.emit({ e: 'toast', msg: 'Something went wrong with that hand. Bets were returned' });
        this.emitEach(ws => this.snapshot(ws));
        await sleep(1000);
      }
      if (!g.running && this.closed) break;
    }
  }

  get g() { return this.game; }
  get T() { return this.game.T; }
  get betweenHands() { const s = this.game.street; return s === 'idle' || s === 'done'; }
  get skill() { return SKILL[this.skillKey]; }
  get stakesLabel() { return this.mode === 'sng' ? `${this.game.sb}/${this.game.bb}` : `${Fmt.usd(this.game.sb)}/${Fmt.usd(this.game.bb)}`; }

  /* ───────────── messaging ───────────── */
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { /* socket gone */ } }
  emit(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) this.send(ws, s);
  }
  /** Personalised message: `fn(ws)` returns the payload for each socket (or null to skip). */
  emitEach(fn) { for (const ws of this.clients) { const m = fn(ws); if (m) this.send(ws, m); } }
  seatOf(ws) { return this.game.players.findIndex(p => p.isHuman && p.token === ws.data.token); }
  playerOf(ws) { const i = this.seatOf(ws); return i >= 0 ? this.game.players[i] : null; }
  toPlayer(p, msg) { this.emitEach(ws => (this.seatOf(ws) === p.seat ? msg : null)); }
  toToken(token, msg) { this.emitEach(ws => (ws.data.token === token ? msg : null)); }

  publicPlayer(p) {
    return {
      seat: p.seat, kind: p.kind, name: p.name, profileKey: p.profileKey, id: p.isHuman ? p.id : null,
      stack: p.stack, bet: p.bet, total: p.total, startStack: p.startStack,
      inHand: p.inHand, folded: p.folded, allIn: p.allIn,
      hasCards: p.inHand && p.hole.length === 2, shown: p.revealed ? p.hole : null,
      tilt: p.brain ? p.brain.tilt : 0, stats: p.stats, buyIns: p.buyIns,
      connected: p.connected, away: p.away, leaving: p.leaving, lastAction: p.lastAction,
      timeBank: p.isHuman ? Math.round((p.timeBank || 0) / 1000) : 0,
    };
  }
  tourneyState() {
    const t = this.tourney;
    if (!t) return null;
    const hpl = SNG.handsPerLevel[this.speed] || 8;
    const lv = SNG.levels[Math.min(t.level + 1, SNG.levels.length - 1)];
    const pool = t.buyIn * 6;
    return {
      state: t.state, buyIn: t.buyIn, pool, payouts: SNG.payouts.map(f => Math.round(pool * f)),
      level: t.level + 1, nextIn: Math.max(0, hpl - t.handsAtLevel), next: lv, startsAt: t.startsAt,
      alive: this.game.players.filter(p => !p.isEmpty && p.stack > 0).length, results: t.results,
    };
  }
  state() {
    const g = this.game;
    return {
      id: this.id, name: this.name, speed: this.speed, fillBots: this.fillBots, mode: this.mode, skill: this.skillKey,
      handNo: g.handNo, button: g.button, sbI: g.sbI, bbI: g.bbI, street: g.street, board: g.board,
      rit: g.rit, board2: g.board2, runTwice: !!g.settings.runTwice,
      currentBet: g.currentBet, lastRaise: g.lastRaise, raiseCount: g.raiseCount, runout: g.runout,
      sb: g.sb, bb: g.bb, buyIn: g.buyIn, stakes: this.stakesLabel,
      players: g.players.map(p => this.publicPlayer(p)),
      reserved: this.reservations.map(r => ({ seat: r.seat, name: r.name })),
      activeSeat: this.activeSeat ?? null, waiting: this.waitingMsg, waitingSub: this.waitingSub || '',
      departed: this.departed, lastHandId: this.lastHandId, tourney: this.tourneyState(),
    };
  }
  /** Everything a client needs to draw the table from scratch (join, reconnect, resync). */
  snapshot(ws) {
    const p = this.playerOf(ws);
    const pending = this.reservations.find(r => r.token === ws.data.token);
    return {
      e: 'snap', s: this.state(),
      me: p ? p.seat : null, hole: p && p.inHand ? p.hole : [],
      pendingSeat: pending ? pending.seat : null,
      log: this.log.hands.slice(0, 12),
      prompt: this.prompt && p && this.prompt.seat === p.seat
        ? { id: this.prompt.id, L: this.prompt.L, ms: Math.max(0, this.prompt.deadline - Date.now()), bank: p.timeBank, banking: !!this.prompt.bankFrom } : null,
      rit: this.ritPrompt && p && this.ritPrompt.seats.includes(p.seat) ? { id: this.ritPrompt.id, ms: this.T.rit } : null,
    };
  }

  /* ───────────── the Game's view ─────────────
     Each call becomes a message. Calls the engine awaits return a delay
     that matches the client's animation, so the table keeps its rhythm. */
  view() {
    const t = this;
    const fast = () => t.speed === 'test';
    const pause = ms => (fast() ? Promise.resolve() : sleep(ms));
    return {
      updateTable(g, why) { t.emit({ e: 'state', s: t.state(), why }); },
      async newHand(g) { t.activeSeat = null; t.emit({ e: 'newHand', s: t.state() }); await pause(280); },
      dealHole(seat, round, c) {
        t.emitEach(ws => ({ e: 'dealHole', seat, round, c: t.seatOf(ws) === seat ? c : null }));
      },
      async dealt(g) { t.emit({ e: 'dealt', s: t.state() }); await pause(520); },
      async dealBoard(cards, start, g, run = 1) {
        t.emit({ e: 'board', cards, start, run, s: t.state() });
        const T = t.T, n = cards.length;
        await pause((T.deal + 40) * n + 240 + (n > 1 ? 95 * n : 0) + 430);
      },
      setActive(seat) { t.activeSeat = seat; t.emit({ e: 'active', seat }); },
      setThinking(seat, ms) { t.emit({ e: 'thinking', seat, ms }); },
      showAction(p, res) { t.emit({ e: 'action', seat: p.seat, res, s: t.state() }); },
      async collectBets(g) {
        t.emit({ e: 'collect', bets: g.players.filter(p => p.bet > 0).map(p => ({ seat: p.seat, amount: p.bet })), s: t.state() });
        await pause(430);
      },
      endStreet(g) { t.emit({ e: 'endStreet', s: t.state() }); },
      reveal(seat, hole) { t.emit({ e: 'reveal', seat, hole }); },
      showEquity(list, run = 1) { t.emit({ e: 'equity', list, run }); },
      highlight(winners, best, g, run = 1) { t.emit({ e: 'highlight', winners, best, run }); },
      runTwice(board) { t.emit({ e: 'rit', board, s: t.state() }); },
      async award(awards, g, run = 1) {
        t.emit({ e: 'award', awards, run });
        await pause(560 + 140 * Math.max(0, awards.length - 1) + 300);
      },
      message(title, sub) { t.emit({ e: 'message', title, sub }); },
      toast(msg) { t.emit({ e: 'toast', msg }); },
      say(p, text) { setTimeout(() => t.emit({ e: 'chat', name: p.name, text, seat: p.seat, bot: true }), fast() ? 0 : 900 + Math.random() * 900); },
      handOver(g) {
        t.activeSeat = null;
        t.afterHand(g);
        t.emit({ e: 'handOver', s: t.state() });
        t.lobby.changed();
      },
    };
  }

  /** Saves the hand, moves stacks into escrow, hands out achievements, keeps the reads. */
  afterHand(g) {
    const T = this.T;
    for (const p of g.players) if (p.isHuman && p.inHand) p.timeBank = Math.min(T.bankMax, (p.timeBank || 0) + T.bankGain);
    const db = this.db;
    if (!db || !g.rec) return;
    try {
      const { id, unlocked } = db.recordHand(g.rec, { tableId: this.id, tableName: this.name, mode: this.mode });
      this.lastHandId = id;
      this.emit({ e: 'handSaved', no: g.rec.no, id });
      for (const p of g.players) {
        if (!p.inHand) continue;
        if (p.isHuman && p.id && this.mode === 'cash') db.checkpoint(p.id, this.id, p.stack);
        if (p.id) db.saveReads(p.id, g.reads.dump(p.id));
      }
      for (const u of unlocked) this.announceAchievement(u.pid, u.key);
    } catch (err) { console.error(`[table ${this.id}] could not save hand ${g.handNo}`, err); }
  }
  announceAchievement(pid, key) {
    const p = this.game.players.find(q => q.isHuman && q.id === pid);
    this.emit({ e: 'achievement', key, name: p ? p.name : '', seat: p ? p.seat : null, pid });
    this.lobby.pushWallet(pid);
  }

  /* ───────────── the Game's panel ───────────── */
  /** Asks a human for a decision. Resolves with their action, or a check/fold when the clock runs out. */
  ask(p, L) {
    return new Promise(resolve => {
      const id = ++this.promptSeq;
      const offline = !p.connected || p.away || p.leaving;
      const ms = offline ? AUTO_ACT_OFFLINE : this.T.clock;
      const auto = { type: L.canCheck ? 'check' : 'fold' };
      const finish = (a, timedOut) => {
        const pr = this.prompt;
        if (!pr || pr.id !== id) return;
        clearTimeout(pr.timer);
        this.prompt = null;
        if (pr.bankFrom) p.timeBank = Math.max(0, p.timeBank - (Date.now() - pr.bankFrom));
        if (timedOut && !offline) {
          p.timeouts++;
          if (p.timeouts >= 2 && !p.away) { p.away = true; this.toPlayer(p, { e: 'away' }); }
        }
        this.emitEach(ws => (this.seatOf(ws) === p.seat ? { e: 'turnOver', id } : null));
        resolve(a);
      };
      // the shot clock ran out: dip into the time bank if there's any left, otherwise check or fold
      const expire = () => {
        const pr = this.prompt;
        if (!pr || pr.id !== id) return;
        if (!pr.bankFrom && !offline && p.connected && !p.away && p.timeBank >= Math.min(1000, this.T.bank)) { // a sliver under a second isn't worth showing
          pr.bankFrom = Date.now();
          pr.deadline = pr.bankFrom + p.timeBank;
          pr.timer = setTimeout(expire, p.timeBank);
          this.emit({ e: 'thinking', seat: p.seat, ms: p.timeBank, bank: true });
          this.toPlayer(p, { e: 'timeBank', id, ms: p.timeBank });
          return;
        }
        finish(auto, true);
      };
      this.prompt = {
        id, seat: p.seat, L, deadline: Date.now() + ms, finish, expire, bankFrom: 0,
        timer: setTimeout(expire, ms),
      };
      this.game.view.setThinking(p.seat, ms);
      if (!offline) this.toPlayer(p, { e: 'yourTurn', id, L, ms, bank: p.timeBank });
    });
  }

  /**
   * Run it twice: ask every person still in the pot. Resolves true only if they all say yes in time.
   * Anyone offline, away or leaving counts as a no.
   */
  askRunTwice(humans) {
    return new Promise(resolve => {
      if (humans.some(p => !p.connected || p.away || p.leaving)) { resolve(false); return; }
      const id = ++this.promptSeq, ms = this.T.rit;
      const yes = new Set();
      const finish = ok => {
        if (!this.ritPrompt || this.ritPrompt.id !== id) return;
        clearTimeout(this.ritPrompt.timer);
        this.ritPrompt = null;
        this.emit({ e: 'ritResult', id, yes: ok });
        resolve(ok);
      };
      const answer = (seat, ok) => {
        if (!ok) return finish(false);
        yes.add(seat);
        if (humans.every(p => yes.has(p.seat))) finish(true);
      };
      this.ritPrompt = { id, seats: humans.map(p => p.seat), answer, finish, timer: setTimeout(() => finish(false), ms) };
      for (const p of humans) this.toPlayer(p, { e: 'ritAsk', id, ms });
    });
  }

  /** A person gets up for good: their stack goes back to their bankroll. */
  removeHuman(p) {
    const g = this.game;
    this.departed += p.stack - p.buyIns;
    if (this.db && p.id) {
      if (this.mode === 'cash') this.db.cashOut(p.id, this.id, p.stack);
      else if (this.tourney.state === 'registering') this.db.cashOut(p.id, this.id, this.tourney.buyIn);
      this.lobby.pushWallet(p.id);
    }
    g.players[p.seat] = Player.empty(p.seat);
  }

  /** Runs between hands: applies queued seat changes and says whether a hand can start. */
  async beforeHand(g) {
    const now = Date.now();
    let changed = false;
    const sng = this.tourney;
    const running = sng && sng.state === 'running';
    // 1. people leaving, and people who dropped and never came back (a running tournament keeps its players)
    if (!running) {
      for (const p of g.players) {
        if (!p.isHuman) continue;
        if (p.leaving || (!p.connected && now - p.disconnectedAt > DISCONNECT_GRACE)) { this.removeHuman(p); changed = true; }
      }
    }
    // 2. reserved seats: an empty seat, or a bot that now makes room
    for (const r of this.reservations.splice(0)) {
      if (sng && sng.state !== 'registering') { this.toToken(r.token, { e: 'error', msg: 'The tournament started without you. Catch the next one.' }); continue; }
      const cur = g.players[r.seat];
      if (cur.isHuman) { const s = this.freeSeat(); if (s < 0) continue; r.seat = s; }
      if (!this.chargeBuyIn(r)) continue;
      if (g.players[r.seat].isBot) this.departed += g.players[r.seat].stack - g.players[r.seat].buyIns;
      const p = new Player(r.seat, r.name, g.buyIn, { kind: 'human', token: r.token, id: r.pid });
      p.timeBank = this.T.bank;
      p.connected = [...this.clients].some(ws => ws.data.token === r.token);
      if (!p.connected) p.disconnectedAt = now;
      g.players[r.seat] = p;
      if (this.db && r.pid) g.reads.load(r.pid, this.db.reads(r.pid));
      changed = true;
      this.emitEach(ws => (ws.data.token === r.token ? this.snapshot(ws) : null));
      this.greet(p);
      if (sng) sng.startsAt = Math.max(sng.startsAt || now + SNG_FIRST_WAIT, now + SNG_JOIN_WAIT);
    }
    // 3. keep the table six-handed with bots, if the table wants that
    if (this.fillBots) for (const p of g.players) if (p.isEmpty) { this.placeBot(p.seat); changed = true; }
    // 4. cash tables: bots reload; humans reload when they asked to
    if (!sng) {
      for (const p of g.players) {
        if (p.isBot && p.stack < g.bb) {
          p.stack += g.buyIn; p.buyIns += g.buyIn;
          this.game.view.toast(`${p.name} rebuys for {$${g.buyIn}}`);
        }
        if (p.isHuman && p.stack === 0) {
          if (p.wantsRebuy) {
            p.wantsRebuy = false;
            if (!this.db || !p.id || this.db.buyIn(p.id, this.id, g.buyIn)) {
              p.stack += g.buyIn; p.buyIns += g.buyIn; p.bustNotified = false; changed = true;
              if (p.id) this.lobby.pushWallet(p.id);
            } else this.toPlayer(p, { e: 'toast', msg: "Your bankroll can't cover a rebuy. Grab free chips in the lobby" });
          } else if (!p.bustNotified && g.handNo > 0) { p.bustNotified = true; this.toPlayer(p, { e: 'busted', buyIn: g.buyIn }); }
        }
      }
    } else if (this.tourneyStep(g)) changed = true;

    const sig = g.players.map(p => `${p.kind}:${p.name}:${p.stack > 0}`).join('|') + (sng ? sng.state : '');
    if (changed || sig !== this.lastSig) { this.lastSig = sig; this.emit({ e: 'state', s: this.state(), why: 'seats' }); this.lobby.changed(); }

    let msg = '', sub = 'The next hand starts as soon as someone sits in';
    const withChips = g.players.filter(p => p.stack > 0 && !p.isEmpty);
    const watchers = g.players.some(p => p.isHuman && p.connected && p.stack > 0 && !p.away);
    if (sng && sng.state === 'registering') {
      const n = g.players.filter(p => p.isHuman).length;
      msg = n ? `${n} ${n === 1 ? 'player' : 'players'} registered` : 'Registration open';
      sub = n ? 'Starts when the countdown ends, or press Start' : 'Sit down to register. Bots fill the empty seats at the start';
    } else if (sng && sng.state === 'finished') {
      msg = 'Tournament over'; sub = sng.results[0] ? `${sng.results[0].name} wins` : '';
    } else if (withChips.length < 2) msg = 'Waiting for players';
    else if (!watchers && !running) msg = g.players.some(p => p.isHuman && p.connected) ? 'Everyone is sitting out' : 'Waiting for players';
    if (msg !== this.waitingMsg || (msg && sub !== this.waitingSub)) {
      this.waitingMsg = msg; this.waitingSub = sub;
      if (msg) { g.street = 'idle'; this.emit({ e: 'message', title: msg, sub, sticky: true }); }
    }
    return !msg;
  }

  /** Takes the buy-in for a reservation from the bankroll. */
  chargeBuyIn(r) {
    if (!this.db || !r.pid) return true;
    const amt = this.tourney ? this.tourney.buyIn : this.game.buyIn;
    if (this.db.buyIn(r.pid, this.id, amt)) { this.lobby.pushWallet(r.pid); return true; }
    this.toToken(r.token, { e: 'error', msg: `Your bankroll can't cover the ${Fmt.usd(amt)} buy-in. Grab free chips in the lobby, or pick lower stakes.` });
    return false;
  }

  greet(p) {
    const bots = this.game.players.filter(q => q.isBot);
    if (!bots.length || Math.random() < 0.35) return;
    const b = bots[secureInt(bots.length)];
    let text = null;
    try { text = b.brain.react({ type: 'greet', name: p.name }); } catch { /* quiet bot */ }
    if (text) this.game.view.say(b, text);
  }

  /* ───────────── Sit & Go ───────────── */
  /** Registration countdown, blind levels, eliminations and the finish. Returns true if seats changed. */
  tourneyStep(g) {
    const t = this.tourney, now = Date.now();
    if (t.state === 'registering') {
      const humans = g.players.filter(p => p.isHuman);
      if (humans.length && (humans.length === 6 || (t.startsAt && now >= t.startsAt) || t.startNow)) { this.startTourney(g); return true; }
      if (!humans.length) t.startsAt = 0;
      return false;
    }
    if (t.state !== 'running') return false;
    let changed = false;
    // eliminations: whoever has no chips left. Busting in the same hand, the bigger starting stack places higher.
    const out = g.players.filter(p => !p.isEmpty && p.stack === 0).sort((a, b) => b.startStack - a.startStack);
    const alive = g.players.filter(p => !p.isEmpty && p.stack > 0).length;
    out.forEach((p, k) => {
      const place = alive + 1 + k;
      this.eliminate(p, place);
      changed = true;
    });
    if (alive <= 1) { this.finishTourney(g); return true; }
    if (g.handNo > 0 && t.lastCounted !== g.handNo) {
      t.lastCounted = g.handNo;
      t.handsAtLevel++;
      const hpl = SNG.handsPerLevel[this.speed] || 8;
      if (t.handsAtLevel >= hpl && t.level < SNG.levels.length - 1) {
        t.level++; t.handsAtLevel = 0;
        [g.sb, g.bb] = SNG.levels[t.level];
        this.emit({ e: 'toast', msg: `Blinds are up: ${g.sb}/${g.bb}` });
        this.emit({ e: 'blindsUp', level: t.level + 1, sb: g.sb, bb: g.bb });
        changed = true;
      }
    }
    return changed;
  }
  startTourney(g) {
    const t = this.tourney;
    for (const p of g.players) if (p.isEmpty) this.placeBot(p.seat);
    for (const p of g.players) { p.stack = SNG.chips; p.buyIns = SNG.chips; p.stats = { hands: 0, vpip: 0, pfr: 0, won: 0, biggest: 0 }; }
    t.state = 'running'; t.startedAt = Date.now(); t.level = 0; t.handsAtLevel = 0;
    [g.sb, g.bb] = SNG.levels[0];
    g.handNo = 0; g.button = secureInt(6);
    this.emit({ e: 'tourneyStart', s: this.state() });
    this.lobby.tourneyStarted(this);
  }
  /** Prize for a finishing place: 65% of the pool for first, the rest for second. */
  prizeFor(place) {
    const pool = this.tourney.buyIn * 6, first = Math.round(pool * SNG.payouts[0]);
    return place === 1 ? first : place === 2 ? pool - first : 0;
  }
  eliminate(p, place) {
    const t = this.tourney, g = this.game;
    const prize = this.prizeFor(place);
    t.results.unshift({ place, name: p.name, kind: p.kind, id: p.id, profile: p.profileKey, prize });
    this.departed += p.stack - p.buyIns;
    if (p.isHuman && this.db && p.id) { this.db.cashOut(p.id, this.id, 0); this.lobby.pushWallet(p.id); } // the buy-in is in the prize pool now
    this.emit({ e: 'eliminated', seat: p.seat, name: p.name, place });
    if (p.isHuman) this.toPlayer(p, { e: 'youPlaced', place, prize, final: false });
    this.game.view.toast(`${p.name} finishes ${ordinal(place)}`);
    g.players[p.seat] = Player.empty(p.seat);
  }
  finishTourney(g) {
    const t = this.tourney;
    const w = g.players.find(p => !p.isEmpty && p.stack > 0);
    if (w) {
      t.results.unshift({ place: 1, name: w.name, kind: w.kind, id: w.id, profile: w.profileKey, prize: this.prizeFor(1) });
      this.departed += w.stack - w.buyIns;
      if (w.isHuman && this.db && w.id) this.db.cashOut(w.id, this.id, 0);
      this.toPlayer(w, { e: 'youPlaced', place: 1, prize: t.results[0].prize, final: true });
      g.players[w.seat] = Player.empty(w.seat);
    }
    t.state = 'finished';
    // pay out
    if (this.db) {
      for (const r of t.results) if (r.kind === 'human' && r.id && r.prize > 0) { this.db.cashOut(r.id, this.id, r.prize); this.lobby.pushWallet(r.id); }
      try {
        const { unlocked } = this.db.recordTournament({ name: this.name, buyIn: t.buyIn, pool: t.buyIn * 6, startedAt: t.startedAt, results: t.results });
        for (const u of unlocked) this.announceAchievement(u.pid, u.key);
      } catch (err) { console.error(`[table ${this.id}] could not save the tournament`, err); }
    }
    this.emit({ e: 'tourneyOver', results: t.results });
    if (w) this.emit({ e: 'message', title: `${w.name} wins the tournament`, sub: `{$${t.results[0].prize}} prize`, sticky: true });
    this.lobby.changed();
  }

  placeBot(seat) {
    const g = this.game;
    const used = new Set(g.players.filter(p => p.isBot).map(p => p.profileKey));
    const free = Object.keys(PROFILES).filter(k => !used.has(k));
    if (!free.length) return false;
    const k = free[secureInt(free.length)];
    g.players[seat] = new Player(seat, PROFILES[k].name, g.buyIn, { kind: 'bot', profile: k, skill: this.skill });
    if (this.db) g.reads.load(`bot:${k}`, this.db.reads(`bot:${k}`));
    return true;
  }
  freeSeat(prefer = -1) {
    const ps = this.game.players, taken = new Set(this.reservations.map(r => r.seat));
    const ok = i => i >= 0 && i < 6 && !taken.has(i) && !ps[i].isHuman;
    if (ok(prefer)) return prefer;
    for (let i = 0; i < 6; i++) if (ok(i) && ps[i].isEmpty) return i;
    for (let i = 0; i < 6; i++) if (ok(i)) return i;
    return -1;
  }

  /* ───────────── sockets ───────────── */
  attach(ws) {
    for (const other of this.clients) {
      if (other !== ws && other.data.token === ws.data.token) { this.send(other, { e: 'replaced' }); this.detach(other); other.close(4000, 'replaced'); }
    }
    this.clients.add(ws);
    ws.data.tableId = this.id;
    const p = this.playerOf(ws);
    if (p) {
      p.connected = true; p.disconnectedAt = 0;
      if (this.tourney && this.tourney.state === 'running' && p.leaving) { p.leaving = false; p.away = false; }
      const pr = this.prompt;
      if (pr && pr.seat === p.seat) { // back in time for their turn: give the clock back
        clearTimeout(pr.timer);
        pr.timer = setTimeout(pr.expire, Math.max(0, pr.deadline - Date.now()));
      }
    }
    this.emptySince = 0;
    this.send(ws, this.snapshot(ws));
    if (p) this.emit({ e: 'state', s: this.state() });
    this.lobby.changed();
  }
  detach(ws) {
    if (!this.clients.delete(ws)) return;
    const p = this.playerOf(ws);
    if (p && ![...this.clients].some(o => o.data.token === ws.data.token)) {
      p.connected = false; p.disconnectedAt = Date.now();
      if (this.prompt && this.prompt.seat === p.seat) {
        // give them a few seconds to come back (a page refresh) before acting for them
        const pr = this.prompt;
        clearTimeout(pr.timer);
        const left = Math.min(pr.deadline - Date.now(), 8000);
        pr.timer = setTimeout(() => pr.finish({ type: pr.L.canCheck ? 'check' : 'fold' }, false), Math.max(0, left));
      }
      this.emit({ e: 'state', s: this.state() });
    }
    this.reservations = this.reservations.filter(r => r.token !== ws.data.token || [...this.clients].some(o => o.data.token === r.token));
    if (!this.clients.size) this.emptySince = Date.now();
    this.lobby.changed();
  }

  /** A watcher asks for a seat. Returns an error string, or null. */
  sit(ws, prefer = -1) {
    if (this.playerOf(ws)) return null;
    if (this.reservations.some(r => r.token === ws.data.token)) return null;
    const pid = ws.data.pid;
    if (pid && (this.game.players.some(p => p.isHuman && p.id === pid) || this.reservations.some(r => r.pid === pid))) {
      return "You're already sitting at this table in another tab.";
    }
    if (this.tourney && this.tourney.state !== 'registering') {
      return this.tourney.state === 'running' ? 'This tournament is under way. Watch it, or join the next one.' : 'This tournament is over.';
    }
    if (this.db && pid) {
      const w = this.db.wallet(pid), amt = this.tourney ? this.tourney.buyIn : this.game.buyIn;
      if (w && w.bankroll < amt) return `Your bankroll (${Fmt.usd(w.bankroll)}) can't cover the ${Fmt.usd(amt)} buy-in. Grab free chips in the lobby, or pick lower stakes.`;
    }
    const seat = this.freeSeat(Number.isInteger(prefer) ? prefer : -1);
    if (seat < 0) return 'This table is full of people. Watch, or try another table.';
    this.reservations.push({ token: ws.data.token, pid, name: ws.data.name, seat });
    this.emit({ e: 'state', s: this.state() });
    this.send(ws, { e: 'pending', seat, now: this.betweenHands });
    this.lobby.changed();
    return null;
  }
  leave(ws) {
    this.reservations = this.reservations.filter(r => r.token !== ws.data.token);
    const p = this.playerOf(ws);
    if (p) {
      if (this.tourney && this.tourney.state === 'running') p.away = true; // your stack stays in and blinds off
      else p.leaving = true;
      if (this.prompt && this.prompt.seat === p.seat) this.prompt.finish({ type: 'fold' }, false);
      if (this.ritPrompt && this.ritPrompt.seats.includes(p.seat)) this.ritPrompt.finish(false);
      this.emit({ e: 'state', s: this.state() });
    }
    this.detach(ws);
  }

  onMessage(ws, m) {
    const p = this.playerOf(ws);
    switch (m.t) {
      case 'act': {
        if (!p || !this.prompt || this.prompt.seat !== p.seat || this.prompt.id !== m.id) return;
        const a = m.a || {};
        const type = ['fold', 'check', 'call', 'raise'].includes(a.type) ? a.type : null;
        if (!type) return;
        p.timeouts = 0; p.away = false;
        this.prompt.finish({ type, to: Number(a.to) || 0 }, false);
        return;
      }
      case 'sit': { const err = this.sit(ws, m.seat); if (err) this.send(ws, { e: 'error', msg: err }); return; }
      case 'rebuy':
        if (p && p.stack === 0 && !this.tourney) { p.wantsRebuy = true; this.send(ws, { e: 'toast', msg: "Rebuy noted. You'll be dealt in next hand" }); }
        return;
      case 'back': if (p) { p.away = false; p.timeouts = 0; this.emit({ e: 'state', s: this.state() }); } return;
      case 'sitOut': if (p) { p.away = true; this.emit({ e: 'state', s: this.state() }); } return;
      case 'start':
        if (p && this.tourney && this.tourney.state === 'registering') { this.tourney.startNow = true; this.emit({ e: 'toast', msg: `${p.name} starts the tournament` }); }
        return;
      case 'rit':
        if (p && this.ritPrompt && this.ritPrompt.id === m.id && this.ritPrompt.seats.includes(p.seat)) this.ritPrompt.answer(p.seat, !!m.yes);
        return;
      case 'show':
        if (p && this.betweenHands && this.game.showAfter(p)) {
          if (this.db && this.lastHandId) this.db.markShown(this.lastHandId, p.seat);
        }
        return;
      case 'emote': {
        if (!p || !EMOTES.includes(m.k)) return;
        const last = this.emoteAt.get(ws.data.token) || 0;
        if (Date.now() - last < 1500) return;
        this.emoteAt.set(ws.data.token, Date.now());
        this.emit({ e: 'emote', seat: p.seat, k: m.k });
        return;
      }
      case 'sync': this.send(ws, this.snapshot(ws)); return;
      case 'chat': {
        const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 160);
        if (text) this.emit({ e: 'chat', name: ws.data.name, text, seat: p ? p.seat : null });
        return;
      }
    }
  }

  /** Something is riding on this table: a tournament to finish, or someone's chips. Idle sweeps leave it open. */
  busy() { return (this.tourney && this.tourney.state === 'running') || this.game.players.some(p => p.isHuman); }

  /** People sitting here right now: cashed out when the server shuts down. */
  cashOutAll() {
    if (!this.db) return;
    for (const p of this.game.players) {
      if (!p.isHuman || !p.id) continue;
      if (this.mode === 'cash') this.db.cashOut(p.id, this.id, p.stack + p.total);
      // a running tournament stays in escrow: the next start refunds the buy-in
    }
  }

  summary() {
    const ps = this.game.players, t = this.tourneyState();
    return {
      id: this.id, name: this.name, speed: this.speed, fillBots: this.fillBots, mode: this.mode, skill: this.skillKey,
      stakes: this.stakesLabel, stakesKey: this.stakesKey, bb: this.game.bb,
      buyIn: this.mode === 'sng' ? this.tourney.buyIn : this.game.buyIn, buyInBB: this.game.buyIn / this.game.bb,
      handNo: this.game.handNo, watchers: this.clients.size, permanent: this.permanent,
      seats: ps.map(p => ({ kind: p.kind, name: p.name, profileKey: p.profileKey })),
      humans: ps.filter(p => p.isHuman).length + this.reservations.length,
      open: this.mode === 'sng' && t.state !== 'registering' ? 0 : ps.filter(p => !p.isHuman).length - this.reservations.length,
      tourney: t && { state: t.state, level: t.level, pool: t.pool, startsAt: t.startsAt, alive: t.alive, winner: t.results.find(r => r.place === 1)?.name || null },
    };
  }

  close() {
    this.closed = true; this.game.stop();
    if (this.prompt) this.prompt.finish({ type: 'fold' }, false);
    if (this.ritPrompt) this.ritPrompt.finish(false);
  }
}

const ordinal = n => n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n] || 'th'); // places run 1 to 6
