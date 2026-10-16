/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · server engine
   The authoritative game. It talks to the outside world only through
   the `view`, `panel` and `log` objects it is given: the Table wires
   those to WebSocket clients, the tests wire them to no-ops.

   Every hand also produces a structured record (`this.rec`): who sat
   where, every action, every card, every pot. The Table saves it to
   the database, and the replayer draws hands from it.
   ════════════════════════════════════════════════════════════════════ */
import {
  clamp, sleep, Cards, Deck, HandEval, Equity, PotManager, PROFILES, STREETS, SPEEDS,
} from '../shared/engine.js';
import { BotBrain, TableReads } from './bots.js';

const POS_NAMES = { 2: ['SB', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['CO', 'BTN', 'SB', 'BB'], 5: ['HJ', 'CO', 'BTN', 'SB', 'BB'], 6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] };
const $ = n => `{$${n}}`; // money token: each client formats it in its own units

/* ───────────── players ─────────────
   kind: 'human' | 'bot' | 'empty'. An empty seat is a Player with no chips,
   so the engine's fixed six-seat loops simply skip it.
   id: the account id for people, `bot:<profile>` for bots. Reads, stats and
   the database all key on it.                                          */
class Player {
  constructor(seat, name, stack, { kind = 'bot', profile = null, token = null, id = null, skill = 0.7 } = {}) {
    this.seat = seat; this.name = name; this.stack = stack; this.kind = kind;
    this.profileKey = profile; this.profile = profile ? PROFILES[profile] : null;
    this.brain = profile ? new BotBrain(profile, skill) : null;
    this.id = id || (profile ? `bot:${profile}` : null);
    this.token = token;
    this.connected = kind === 'human'; this.disconnectedAt = 0;
    this.away = false; this.timeouts = 0; this.leaving = false; this.wantsRebuy = false; this.bustNotified = false;
    this.buyIns = stack;
    this.stats = { hands: 0, vpip: 0, pfr: 0, won: 0, biggest: 0 };
    this.resetHand();
  }
  static empty(seat) { return new Player(seat, '', 0, { kind: 'empty' }); }
  get isHuman() { return this.kind === 'human'; }
  get isBot() { return this.kind === 'bot'; }
  get isEmpty() { return this.kind === 'empty'; }
  resetHand() {
    this.hole = []; this.bet = 0; this.total = 0;
    this.acted = false; this.locked = false; this.allIn = false; this.revealed = false;
    this.lastAction = null; this.flags = { vpip: false, pfr: false, sawFlop: false, showdown: false };
    this.inHand = this.stack > 0; this.folded = !this.inHand; this.startStack = this.stack;
  }
  get active() { return this.inHand && !this.folded; }
  get canAct() { return this.active && !this.allIn; }
  get net() { return this.stack + this.total - this.buyIns; }
}

/* ───────────── the game ───────────── */
class Game {
  constructor({ view, panel, log, settings, headless = false, stakes = { sb: 1, bb: 2 } }) {
    Object.assign(this, { view, panel, log, settings, headless });
    this.sb = stakes.sb; this.bb = stakes.bb; this.buyIn = 100 * this.bb;
    this.players = []; this.button = 0; this.handNo = 0; this.board = [];
    this.street = 'idle'; this.running = false; this.runout = false;
    this.sbI = -1; this.bbI = -1; this.currentBet = 0; this.lastRaise = this.bb; this.raiseCount = 0;
    this.reads = new TableReads();
    this.actions = []; this.pfAggressor = -1; this.streetAggressor = -1;
    this.rit = false; this.board2 = null;
    this.rec = null;
  }
  get T() { return SPEEDS[this.settings.speed] || SPEEDS.normal; }
  wait(ms) { return this.headless || ms <= 0 ? Promise.resolve() : sleep(ms); }

  /* helpers */
  get pot() { return this.players.reduce((s, p) => s + p.total, 0); }
  get collected() { return this.players.reduce((s, p) => s + p.total - p.bet, 0); }
  activeCount() { return this.players.filter(p => p.active).length; }
  canActCount() { return this.players.filter(p => p.canAct).length; }
  nextWhere(i, pred) {
    for (let k = 1; k <= 6; k++) { const j = (i + k) % 6; if (pred(this.players[j])) return j; }
    return -1;
  }
  distFromButton(s) { return (s - this.button + 5) % 6; }
  totalChips() { return this.players.reduce((s, p) => s + p.stack + p.total, 0); }
  totalBuyIns() { return this.players.reduce((s, p) => s + p.buyIns, 0); }
  /** Positions of everyone dealt in this hand, by seat: UTG … BTN, SB, BB. */
  positions() {
    const order = [];
    let i = this.sbI;
    for (let k = 0; k < 6 && i >= 0; k++) {
      if (this.players[i].inHand) order.push(i);
      i = (i + 1) % 6;
      if (i === this.sbI) break;
    }
    // order starts at the small blind: rotate so the list ends with SB, BB
    const n = order.length, names = POS_NAMES[n] || [];
    const out = {};
    const hu = n === 2;
    order.forEach((seat, k) => { out[seat] = hu ? (seat === this.button ? 'SB' : 'BB') : names[(k + n - 2) % n]; });
    return out;
  }

  /**
   * Main loop. Between hands the panel gets a chance to change seats and
   * decide whether a hand can start (enough players, someone watching).
   */
  async run(maxHands = Infinity) {
    this.running = true;
    while (this.running && this.handNo < maxHands) {
      const ready = await this.panel.beforeHand(this);
      if (!this.running) break;
      if (!ready) { await sleep(this.headless ? 0 : 400); continue; }
      await this.playHand();
      await this.wait(this.T.between);
    }
    this.running = false;
  }
  stop() { this.running = false; }

  /* ── one hand ── */
  async playHand() {
    this.handNo++;
    for (const p of this.players) p.resetHand();
    this.board = []; this.deck = new Deck(); this.street = 'preflop';
    this.currentBet = 0; this.lastRaise = this.bb; this.raiseCount = 0; this.runout = false;
    this.actions = []; this.pfAggressor = -1; this.streetAggressor = -1;
    this.rit = false; this.board2 = null;
    this.button = this.nextWhere(this.button, p => p.inHand);
    const seated = this.players.filter(p => p.inHand);
    const hu = seated.length === 2;
    this.sbI = hu ? this.button : this.nextWhere(this.button, p => p.inHand);
    this.bbI = this.nextWhere(this.sbI, p => p.inHand);
    this.pos = this.positions();
    this.rec = {
      no: this.handNo, startedAt: Date.now(), sb: this.sb, bb: this.bb, button: this.button, sbI: this.sbI, bbI: this.bbI,
      seats: seated.map(p => ({ seat: p.seat, id: p.id, name: p.name, kind: p.kind, profile: p.profileKey, stack: p.stack, pos: this.pos[p.seat] })),
      hole: {}, events: [], board: [], pots: [], shown: [], end: {},
    };

    this.log.startHand(this);
    await this.view.newHand(this);
    await this.wait(this.T.beat);

    this.post(this.players[this.sbI], this.sb, 'small blind');
    this.post(this.players[this.bbI], this.bb, 'big blind');
    this.currentBet = this.bb; this.lastRaise = this.bb;
    this.view.updateTable(this, 'blinds');
    await this.wait(this.T.beat);

    // deal two rounds, starting left of the button
    const order = [];
    let i = this.button;
    for (let k = 0; k < seated.length; k++) { i = this.nextWhere(i, p => p.inHand); order.push(this.players[i]); }
    for (let round = 0; round < 2; round++) {
      for (const p of order) {
        const c = this.deck.draw();
        p.hole.push(c);
        this.view.dealHole(p.seat, round, c);
        await this.wait(this.T.deal);
      }
    }
    for (const p of order) this.rec.hole[p.seat] = p.hole.slice();
    await this.wait(250);
    await this.view.dealt(this);

    await this.bettingRound(this.nextWhere(this.bbI, p => p.canAct));

    for (const [name, n] of STREETS) {
      if (this.activeCount() <= 1) break;
      await this.endStreet();
      if (!this.runout && this.canActCount() <= 1) {
        this.runout = true;
        this.log.line('Players are all in, cards on their backs');
        this.view.message('All in', 'Running it out');
        await this.revealAll();
        this.showRunoutEquity();
        if (this.settings.runTwice && this.board.length < 5 && (await this.askRunTwice())) {
          this.rit = true;
          this.board2 = this.board.slice();
          this.rec.ritFrom = this.board.length;
          this.log.line('Everyone agrees to run it twice');
          this.view.runTwice(this.board2, this);
          this.view.message('Running it twice', 'Each run is worth half the pot');
        }
        await this.wait(this.T.runout);
      }
      this.street = name;
      this.streetAggressor = -1;
      this.deck.burn();
      const cards = [];
      for (let k = 0; k < n; k++) cards.push(this.deck.draw());
      this.board.push(...cards);
      if (name === 'flop') for (const p of this.players) if (p.active) p.flags.sawFlop = true;
      this.rec.events.push({ k: 'street', name, cards });
      this.log.street(name, this.board);
      await this.view.dealBoard(cards, this.board.length - n, this);
      if (this.runout) { this.showRunoutEquity(); await this.wait(this.T.runout); }
      else await this.bettingRound(this.nextWhere(this.button, p => p.canAct));
    }
    await this.endStreet();
    if (this.rit) await this.dealSecondRun();
    if (this.activeCount() === 1) await this.awardUncontested();
    else await this.showdown();
    this.finishHand();
    return true;
  }

  /**
   * Everyone is all in with cards to come. Run it twice only if every player in the pot agrees:
   * bots answer by temperament, people get a short prompt (or their standing preference).
   */
  async askRunTwice() {
    const live = this.players.filter(p => p.active);
    for (const p of live) {
      if (!p.isBot) continue;
      let yes = true;
      try { yes = p.brain.runTwice ? p.brain.runTwice({ pot: this.pot, bb: this.bb }) : true; } catch { yes = false; }
      if (!yes) { this.log.line(`${p.name} wants to run it once`, 'muted'); return false; }
    }
    const humans = live.filter(p => p.isHuman);
    if (!humans.length) return true;
    if (!this.panel.askRunTwice) return false;
    const yes = await this.panel.askRunTwice(humans, this);
    if (!yes) this.log.line('Running it once', 'muted');
    return yes;
  }

  /** The second board: the same shared cards, then fresh ones from the same deck. */
  async dealSecondRun() {
    for (const [name, n] of STREETS) {
      const need = name === 'flop' ? 3 : name === 'turn' ? 4 : 5;
      if (this.board2.length >= need) continue;
      this.deck.burn();
      const cards = [];
      for (let k = 0; k < n; k++) cards.push(this.deck.draw());
      this.board2.push(...cards);
      this.rec.events.push({ k: 'street', name, cards, run: 2 });
      this.log.street(name, this.board2, 2);
      await this.view.dealBoard(cards, this.board2.length - n, this, 2);
      this.showRunoutEquity(2);
      await this.wait(this.T.runout);
    }
    return true;
  }

  post(p, amt, label) {
    const a = Math.min(amt, p.stack);
    this.pay(p, a);
    if (p.stack === 0) p.allIn = true;
    p.lastAction = { type: 'blind', to: p.bet };
    this.rec.events.push({ k: 'blind', s: p.seat, a });
    this.log.line(`${p.name} posts the ${label}, ${$(a)}`);
  }
  pay(p, amt) {
    amt = Math.min(amt, p.stack);
    p.stack -= amt; p.bet += amt; p.total += amt;
    return amt;
  }

  legal(p) {
    const toCall = Math.max(0, this.currentBet - p.bet);
    const callAmt = Math.min(toCall, p.stack);
    const maxTo = p.bet + p.stack;
    const othersCanRespond = this.players.some(q => q !== p && q.canAct);
    const canRaise = !p.locked && othersCanRespond && maxTo > this.currentBet;
    const minTo = Math.min(this.currentBet + this.lastRaise, maxTo);
    return { toCall, callAmt, canCheck: toCall === 0, canRaise, minTo, maxTo, isBet: this.currentBet === 0 };
  }

  roundComplete() {
    const actors = this.players.filter(p => p.canAct);
    if (actors.length === 0) return true;
    if (actors.length === 1) return actors[0].bet >= this.currentBet;
    return actors.every(p => p.acted && p.bet === this.currentBet);
  }

  async bettingRound(start) {
    if (start < 0) return;
    let i = start;
    for (let guard = 0; guard < 400; guard++) {
      if (this.activeCount() <= 1 || this.roundComplete()) return;
      const p = this.players[i];
      if (p.canAct && (!p.acted || p.bet < this.currentBet)) await this.act(p);
      i = (i + 1) % 6;
    }
    console.warn('betting round guard tripped');
  }

  async act(p) {
    const L = this.legal(p);
    this.view.setActive(p.seat);
    let a;
    if (p.isHuman) {
      a = await this.panel.ask(p, L, this);
    } else {
      const ctx = this.botContext(p, L);
      const think = this.thinkTime(p, L);
      this.view.setThinking(p.seat, think);
      await this.wait(30);
      try { a = p.brain.decide(ctx); } catch (err) { console.error('bot decision failed', err); a = null; }
      await this.wait(think);
    }
    this.view.setThinking(p.seat, 0);
    this.view.setActive(null);
    const ctxLite = { street: this.street, toCall: L.toCall, raiseCount: this.raiseCount, pfAggressor: this.pfAggressor, streetAggressor: this.streetAggressor, bb: this.bb, pot: this.pot };
    const res = this.apply(p, a);
    this.actions.push({ street: this.street, seat: p.seat, id: p.id, type: res.type, to: res.to, paid: res.paid, allIn: res.allIn, facing: L.toCall });
    this.rec.events.push({ k: 'act', s: p.seat, type: res.type, to: res.to, paid: res.paid, allIn: res.allIn, street: this.street });
    try { this.reads.onAction(p, res, ctxLite); } catch (err) { console.error('reads failed', err); }
    this.log.action(p, res);
    this.view.showAction(p, res, this);
    if (p.isBot && res.allIn && this.view.say) {
      let text = null;
      try { text = p.brain.react({ type: 'allin', bb: this.bb, pot: this.pot }); } catch { /* quiet bot */ }
      if (text) this.view.say(p, text);
    }
  }

  apply(p, a) {
    const L = this.legal(p);
    let type = a && ['fold', 'check', 'call', 'raise'].includes(a.type) ? a.type : (L.canCheck ? 'check' : 'fold');
    if (type === 'check' && !L.canCheck) type = 'call';
    if (type === 'call' && L.canCheck) type = 'check';
    if (type === 'raise' && !L.canRaise) type = L.canCheck ? 'check' : 'call';
    let paid = 0, label = type;
    switch (type) {
      case 'fold': p.folded = true; break;
      case 'check': break;
      case 'call': paid = this.pay(p, L.callAmt); break;
      case 'raise': {
        const to = Math.round(clamp(Number(a.to) || L.minTo, L.minTo, L.maxTo));
        const raiseSize = to - this.currentBet;
        const full = raiseSize >= this.lastRaise;
        label = L.isBet ? 'bet' : 'raise';
        paid = this.pay(p, to - p.bet);
        if (full) {
          this.lastRaise = raiseSize;
          for (const q of this.players) if (q !== p && q.canAct) { q.acted = false; q.locked = false; }
        } else {
          // short all-in: players who already acted may only call or fold
          for (const q of this.players) if (q !== p && q.canAct && q.bet < to) { if (q.acted) q.locked = true; q.acted = false; }
        }
        this.currentBet = to;
        this.raiseCount++;
        this.streetAggressor = p.seat;
        if (this.street === 'preflop') this.pfAggressor = p.seat;
        break;
      }
    }
    p.acted = true;
    if (p.stack === 0 && !p.folded) p.allIn = true;
    if (this.street === 'preflop' && (type === 'call' || type === 'raise')) {
      p.flags.vpip = true;
      if (type === 'raise') p.flags.pfr = true;
    }
    const res = { type: label, paid, to: p.bet, allIn: p.allIn && type !== 'fold' && type !== 'check' };
    p.lastAction = res;
    return res;
  }

  thinkTime(p, L) {
    const base = this.T.think;
    const weight = L.toCall > 0 ? 1 + Math.min(1.2, L.callAmt / Math.max(this.pot, 1)) : 0.8;
    // nobody left to watch this pot closely: speed the bots up
    const watched = this.players.some(q => q.isHuman && q.active && q.connected) ? 1 : 0.55;
    return Math.round(base * weight * watched * (0.6 + Math.random() * 0.8));
  }

  /**
   * Everything a bot may know when it decides: its own cards, the public
   * table, what each opponent did this hand, and the table's reads on them.
   */
  botContext(p, L) {
    const order = [];
    let i = this.button;
    for (let k = 0; k < 6; k++) { i = (i + 1) % 6; if (this.players[i].active) order.push(i); }
    const idx = order.indexOf(p.seat);
    const position = order.length > 1 ? idx / (order.length - 1) : 1;
    const isUnopened = this.street === 'preflop' && this.raiseCount === 0;
    const limpers = isUnopened
      ? this.players.filter(q => q.seat !== this.sbI && q.seat !== this.bbI && q.active && q.bet === this.bb).length
      : 0;
    const villains = this.players.filter(q => q !== p && q.active).map(q => ({
      seat: q.seat, id: q.id, name: q.name, kind: q.kind, profile: q.profileKey,
      stack: q.stack, bet: q.bet, total: q.total, allIn: q.allIn, pos: this.pos[q.seat],
      acted: q.acted, lastAction: q.lastAction,
      stats: this.reads.get(q.id),
    }));
    const effStack = Math.max(0, ...villains.map(v => Math.min(v.stack + v.bet, p.stack + p.bet)));
    return {
      street: this.street, hole: p.hole, board: this.board,
      toCall: L.toCall, callAmt: L.callAmt, canCheck: L.canCheck, canRaise: L.canRaise, minTo: L.minTo, maxTo: L.maxTo, isBet: L.isBet,
      pot: this.pot, currentBet: this.currentBet, lastRaise: this.lastRaise, bb: this.bb, sb: this.sb,
      stack: p.stack, bet: p.bet, total: p.total, seat: p.seat, button: this.button,
      opponents: this.activeCount() - 1, raiseCount: this.raiseCount,
      position, posName: this.pos[p.seat], isUnopened, limpers,
      villains, effStack,
      actions: this.actions.slice(),
      pfAggressor: this.pfAggressor, streetAggressor: this.streetAggressor,
      tournament: !!this.settings.tournament,
      skill: p.brain ? p.brain.skill : 0.7,
    };
  }

  async endStreet() {
    const bettors = this.players.filter(p => p.bet > 0).sort((a, b) => b.bet - a.bet);
    if (bettors.length) {
      const top = bettors[0], second = bettors[1] ? bettors[1].bet : 0;
      if (top.bet > second) {
        const ex = top.bet - second;
        top.bet -= ex; top.total -= ex; top.stack += ex;
        if (top.stack > 0) top.allIn = false;
        this.rec.events.push({ k: 'return', s: top.seat, a: ex });
        this.log.line(`Uncalled ${$(ex)} returned to ${top.name}`);
      }
      this.view.updateTable(this);
      if (this.players.some(p => p.bet > 0)) await this.view.collectBets(this);
    }
    for (const p of this.players) { p.bet = 0; p.acted = false; p.locked = false; }
    this.currentBet = 0; this.lastRaise = this.bb; this.raiseCount = 0;
    this.view.endStreet(this);
  }

  async revealAll() {
    for (const p of this.players) {
      if (!p.active || p.revealed) continue;
      p.revealed = true;
      this.rec.shown.push(p.seat);
      this.view.reveal(p.seat, p.hole);
      this.log.shows(p);
      await this.wait(this.T.reveal);
    }
  }

  /** A player shows their cards after the hand (voluntarily). */
  showAfter(p) {
    if (!this.rec || p.revealed || p.hole.length !== 2 || !(p.seat in this.rec.hole)) return false;
    p.revealed = true;
    this.rec.shown.push(p.seat);
    this.view.reveal(p.seat, p.hole);
    this.log.shows(p);
    return true;
  }

  showRunoutEquity(run = 1) {
    const live = this.players.filter(p => p.active);
    const eq = Equity.known(live.map(p => p.hole), run === 2 ? this.board2 : this.board);
    this.view.showEquity(live.map((p, i) => ({ seat: p.seat, eq: eq[i] })), run);
  }

  async awardUncontested() {
    const w = this.players.find(p => p.active);
    const amount = this.pot;
    this.street = 'done';
    await this.view.award([{ seat: w.seat, amount }], this);
    w.stack += amount;
    for (const p of this.players) p.total = 0;
    w.stats.won++;
    this.noteWin(w, amount);
    this.rec.pots.push({ amount, winners: [w.seat], label: 'the pot', score: null });
    this.log.win(`${w.name} wins ${$(amount)}`);
    this.view.message(`${w.name} takes it`, $(amount));
    this.view.updateTable(this);
  }

  /**
   * Showdown. With run it twice, each pot is split in half (the odd chip to the first run) and
   * each half goes to the best hand on its own board, one run after the other.
   */
  async showdown() {
    this.street = 'showdown';
    const live = this.players.filter(p => p.active);
    for (const p of live) p.flags.showdown = true;
    await this.revealAll();
    const boards = this.rit ? [this.board, this.board2] : [this.board];
    const pots = PotManager.build(this.players);
    const won = new Array(6).fill(0);
    const runWinners = [];
    this.rec.pots = [];
    for (let r = 0; r < boards.length; r++) {
      const board = boards[r], two = boards.length > 1;
      const scores = new Map(live.map(p => [p.seat, HandEval.score(p.hole.concat(board))]));
      this.rec[r === 0 ? 'scores' : 'scores2'] = Object.fromEntries(scores);
      for (const p of live) this.log.line(`${two ? `Run ${r + 1}, ` : ''}${p.name}: ${HandEval.describe(scores.get(p.seat))}`, 'muted');
      const wonRun = new Array(6).fill(0);
      const results = pots.map((pot, k) => {
        const amount = !two ? pot.amount : r === 0 ? Math.ceil(pot.amount / 2) : Math.floor(pot.amount / 2);
        let best = -1, winners = [];
        for (const s of pot.eligible) {
          const sc = scores.get(s);
          if (sc > best) { best = sc; winners = [s]; } else if (sc === best) winners.push(s);
        }
        winners.sort((a, b) => this.distFromButton(a) - this.distFromButton(b));
        const share = Math.floor(amount / winners.length);
        let rem = amount - share * winners.length;
        for (const w of winners) { wonRun[w] += share + (rem > 0 ? 1 : 0); rem--; }
        const label = (pots.length > 1 ? (k === 0 ? 'the main pot' : `side pot ${k}`) : 'the pot') + (two ? (r === 0 ? ', first run' : ', second run') : '');
        return { label, amount, winners, score: best, contested: pot.eligible.length > 1 };
      });
      this.rec.pots.push(...results.map(x => ({ amount: x.amount, winners: x.winners, label: x.label, score: x.contested ? x.score : null, run: r + 1 })));

      const main = results[0];
      const bf = HandEval.bestFive(this.players[main.winners[0]].hole.concat(board));
      this.rec[r === 0 ? 'best' : 'best2'] = bf.cards;
      this.view.highlight(main.winners, bf.cards, this, r + 1);
      runWinners.push(main.winners);

      const awards = wonRun.map((amount, seat) => ({ seat, amount })).filter(x => x.amount > 0);
      await this.view.award(awards, this, r + 1);
      for (const x of awards) won[x.seat] += x.amount;
      for (const res of results) {
        const names = res.winners.map(s => this.players[s].name);
        const desc = res.contested ? ` with ${HandEval.describe(res.score).replace(/^./, m => m.toLowerCase())}` : '';
        if (names.length > 1) this.log.win(`${names.join(' and ')} split ${res.label} (${$(res.amount)})${desc}`);
        else this.log.win(`${names[0]} wins ${res.label} (${$(res.amount)})${desc}`);
      }
      const handName = HandEval.describe(main.score);
      const who = main.winners.length > 1 ? 'Split pot' : `${this.players[main.winners[0]].name} wins`;
      this.view.message(two ? `${who}, run ${r + 1}` : main.winners.length > 1 ? who : `${who} ${$(wonRun[main.winners[0]])}`, handName);
      if (two && r === 0) await this.wait(this.T.runout);
    }
    for (let seat = 0; seat < 6; seat++) {
      if (!won[seat]) continue;
      const p = this.players[seat];
      p.stack += won[seat]; p.stats.won++;
      this.noteWin(p, won[seat]);
    }
    for (const p of this.players) p.total = 0;
    if (this.rit) {
      const [a, b] = runWinners.map(w => w.join(','));
      if (a === b && runWinners[0].length === 1) this.view.message(`${this.players[runWinners[0][0]].name} scoops both runs`, $(won[runWinners[0][0]]));
      else this.view.message('The pot is chopped', 'One run each');
    }
    this.view.updateTable(this);
  }

  noteWin(p, amount) { p.stats.biggest = Math.max(p.stats.biggest, amount); }

  finishHand() {
    this.street = 'done';
    const rec = this.rec, scores = rec.scores || {};
    rec.board = this.board.slice();
    if (this.rit) { rec.rit = true; rec.board2 = this.board2.slice(); }
    rec.endedAt = Date.now();
    const potTotal = rec.pots.reduce((s, x) => s + x.amount, 0);
    rec.potTotal = potTotal;
    const dealt = this.players.filter(p => p.inHand);
    for (const p of dealt) {
      rec.end[p.seat] = p.stack;
      p.stats.hands++;
      if (p.flags.vpip) p.stats.vpip++;
      if (p.flags.pfr) p.stats.pfr++;
    }
    const summary = {
      bb: this.bb, pot: potTotal, board: rec.board, actions: this.actions, pfAggressor: this.pfAggressor,
      players: dealt.map(p => ({
        seat: p.seat, id: p.id, name: p.name, kind: p.kind, delta: p.stack - p.startStack,
        vpip: p.flags.vpip, pfr: p.flags.pfr, sawFlop: p.flags.sawFlop, showdown: p.flags.showdown,
        won: rec.pots.some(x => x.winners.includes(p.seat)), busted: p.stack === 0,
        score: scores[p.seat] ?? null,
      })),
    };
    try { this.reads.onHandEnd(summary); } catch (err) { console.error('reads failed', err); }
    this.botBanter(summary);
    this.log.endHand(this);
    this.view.handOver(this);
  }

  /** Bots react to the hand they just saw. At most one of them speaks. */
  botBanter(summary) {
    const winners = summary.players.filter(x => x.won);
    const lines = [];
    for (const p of this.players) {
      if (!p.isBot || !p.inHand) continue;
      const me = summary.players.find(x => x.seat === p.seat);
      try { p.brain.afterHand({ ...me, bb: this.bb, pot: summary.pot }); } catch (err) { console.error('bot afterHand failed', err); }
      const evt = {
        type: 'handEnd', bb: this.bb, pot: summary.pot, delta: me.delta, won: me.won, showdown: me.showdown,
        myHand: me.score != null ? HandEval.describe(me.score) : null, myCat: me.score != null ? HandEval.category(me.score) : -1,
        winners: winners.map(w => ({ name: w.name, kind: w.kind, hand: w.score != null ? HandEval.describe(w.score) : null, cat: w.score != null ? HandEval.category(w.score) : -1 })),
        busted: summary.players.filter(x => x.busted && x.seat !== p.seat).map(x => x.name),
        iBusted: me.busted,
      };
      let text = null;
      try { text = p.brain.react(evt); } catch (err) { console.error('bot react failed', err); }
      if (text) lines.push([p, text]);
    }
    if (lines.length && this.view.say) {
      const [p, text] = lines[Math.floor(Math.random() * lines.length)];
      this.view.say(p, text);
    }
  }
}

/* ───────────── hand log ─────────────
   Lines are HTML. Names are cleaned on the way in (cleanName), so the only
   markup here is the card spans. Amounts are `{$n}` tokens.            */
class HandLog {
  constructor() { this.hands = []; this.cur = null; }
  onLine() {}
  onStart() {}
  startHand(g) {
    this.cur = { no: g.handNo, lines: [] };
    this.hands.unshift(this.cur);
    if (this.hands.length > 40) this.hands.pop();
    this.onStart(this.cur.no);
    this.line(`${g.players[g.button].name} has the button`, 'muted');
  }
  line(html, cls = '') {
    if (!this.cur) return;
    const l = { html, cls };
    this.cur.lines.push(l);
    this.onLine(this.cur.no, l);
  }
  action(p, r) {
    const txt = {
      fold: 'folds', check: 'checks', call: `calls ${$(r.paid)}`,
      bet: `bets ${$(r.to)}`, raise: `raises to ${$(r.to)}`,
    }[r.type];
    this.line(`${p.name} ${txt}${r.allIn ? ', all in' : ''}`, r.type === 'fold' ? 'muted' : '');
  }
  street(name, board, run = 1) {
    const label = name[0].toUpperCase() + name.slice(1);
    this.line(`${run === 2 ? `Second run, ${name}` : label} ${Cards.htmlList(board)}`, 'street');
  }
  shows(p) { this.line(`${p.name} shows ${Cards.htmlList(p.hole)}`); }
  win(txt) { this.line(txt, 'win'); }
  endHand() {}
}

export { BotBrain, Player, Game, HandLog };
