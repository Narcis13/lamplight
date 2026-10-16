'use strict';
/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · engine
   Pure game logic. No DOM access in this section: the Game talks to a
   view, a panel, a log and a sound object through small interfaces, so
   the whole engine can run headless for testing.
   ════════════════════════════════════════════════════════════════════ */

/* ───────────── primitives ───────────── */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function secureInt(n) {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) return Math.floor(Math.random() * n);
  const lim = Math.floor(0x100000000 / n) * n;
  const b = new Uint32Array(1);
  do { c.getRandomValues(b); } while (b[0] >= lim);
  return b[0] % n;
}
function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = secureInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const RANK_CH = '23456789TJQKA';
const RANK_ONE = [, , 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const RANK_MANY = [, , 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

const Fmt = {
  units: 'usd', bb: 2,
  money(v) {
    if (this.units === 'bb') {
      const x = Math.round((v / this.bb) * 10) / 10;
      return `${x.toLocaleString('en-US')} BB`;
    }
    return '$' + Math.round(v).toLocaleString('en-US');
  },
  usd(v) { return '$' + Math.round(v).toLocaleString('en-US'); },
  signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + this.money(Math.abs(v)); },
};

/* ───────────── cards ─────────────
   A card is an int 0..51: rank index = c >> 2 (0 = deuce), suit = c & 3
   suits: 0 spades, 1 hearts, 2 diamonds, 3 clubs                      */
class Cards {
  static rank(c) { return (c >> 2) + 2; }
  static suit(c) { return c & 3; }
  static rankLabel(c) { const r = RANK_CH[c >> 2]; return r === 'T' ? '10' : r; }
  static text(c) { return Cards.rankLabel(c) + '♠♥♦♣'[c & 3]; }
  static html(c) { return `<span class="lc s${c & 3}">${Cards.text(c)}</span>`; }
  static htmlList(cs) { return cs.map(Cards.html).join(' '); }
}

class Deck {
  constructor() { this.cards = shuffleArr(Array.from({ length: 52 }, (_, i) => i)); }
  draw() { return this.cards.pop(); }
  burn() { this.cards.pop(); }
}

/* ───────────── hand evaluator ─────────────
   Direct 5–7 card evaluator. Returns a single comparable integer:
   category * 15^5 + five tie-break ranks in base 15.                   */
const _rc = new Uint8Array(15), _sc = new Uint8Array(4), _sm = new Uint16Array(4), _k = [0, 0, 0, 0, 0];
const B5 = 759375, B4 = 50625, B3 = 3375;
const WHEEL = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2);
const pack = (cat, a, b, c, d, e) => cat * B5 + a * B4 + b * B3 + c * 225 + d * 15 + e;
function straightHigh(mask) {
  for (let h = 14; h >= 5; h--) { const m = 31 << (h - 4); if ((mask & m) === m) return h; }
  return (mask & WHEEL) === WHEEL ? 5 : 0;
}
function topRanksExcept(a, b, count) {
  _k.fill(0); let n = 0;
  for (let r = 14; r >= 2 && n < count; r--) if (_rc[r] && r !== a && r !== b) _k[n++] = r;
  return _k;
}
function topBits(mask, count) {
  _k.fill(0); let n = 0;
  for (let r = 14; r >= 2 && n < count; r--) if (mask & (1 << r)) _k[n++] = r;
  return _k;
}

class HandEval {
  static score(cards, n = cards.length) {
    _rc.fill(0); _sc.fill(0); _sm.fill(0);
    let all = 0;
    for (let i = 0; i < n; i++) {
      const c = cards[i], r = (c >> 2) + 2, s = c & 3;
      _rc[r]++; _sc[s]++; _sm[s] |= 1 << r; all |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (_sc[s] >= 5) fs = s;
    if (fs >= 0) { const sh = straightHigh(_sm[fs]); if (sh) return pack(8, sh, 0, 0, 0, 0); }
    let q = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0;
    for (let r = 14; r >= 2; r--) {
      const k = _rc[r];
      if (k === 4) q = r;
      else if (k === 3) { if (!t1) t1 = r; else if (!t2) t2 = r; }
      else if (k === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; }
    }
    if (q) return pack(7, q, topRanksExcept(q, 0, 1)[0], 0, 0, 0);
    if (t1 && (t2 || p1)) return pack(6, t1, Math.max(t2, p1), 0, 0, 0);
    if (fs >= 0) { const k = topBits(_sm[fs], 5); return pack(5, k[0], k[1], k[2], k[3], k[4]); }
    const st = straightHigh(all);
    if (st) return pack(4, st, 0, 0, 0, 0);
    if (t1) { const k = topRanksExcept(t1, 0, 2); return pack(3, t1, k[0], k[1], 0, 0); }
    if (p1 && p2) { const k = topRanksExcept(p1, p2, 1); return pack(2, p1, p2, k[0], 0, 0); }
    if (p1) { const k = topRanksExcept(p1, 0, 3); return pack(1, p1, k[0], k[1], k[2], 0); }
    const k = topRanksExcept(0, 0, 5);
    return pack(0, k[0], k[1], k[2], k[3], k[4]);
  }
  static category(score) { return Math.floor(score / B5); }
  static describe(score) {
    const cat = Math.floor(score / B5), a = Math.floor(score / B4) % 15, b = Math.floor(score / B3) % 15;
    switch (cat) {
      case 8: return a === 14 ? 'Royal flush' : `Straight flush, ${RANK_ONE[a].toLowerCase()} high`;
      case 7: return `Four ${RANK_MANY[a].toLowerCase()}`;
      case 6: return `${RANK_MANY[a]} full of ${RANK_MANY[b].toLowerCase()}`;
      case 5: return `Flush, ${RANK_ONE[a].toLowerCase()} high`;
      case 4: return `Straight, ${RANK_ONE[a].toLowerCase()} high`;
      case 3: return `Three ${RANK_MANY[a].toLowerCase()}`;
      case 2: return `Two pair, ${RANK_MANY[a].toLowerCase()} and ${RANK_MANY[b].toLowerCase()}`;
      case 1: return `Pair of ${RANK_MANY[a].toLowerCase()}`;
      default: return `${RANK_ONE[a]} high`;
    }
  }
  /** Best five-card subset, used to highlight the winning cards. */
  static bestFive(cards) {
    let best = -1, pick = null;
    const n = cards.length, hand = new Array(5);
    const rec = (start, depth) => {
      if (depth === 5) { const sc = HandEval.score(hand, 5); if (sc > best) { best = sc; pick = hand.slice(); } return; }
      for (let i = start; i <= n - (5 - depth); i++) { hand[depth] = cards[i]; rec(i + 1, depth + 1); }
    };
    rec(0, 0);
    return { score: best, cards: pick || [] };
  }
}

/* ───────────── preflop strength ───────────── */
class Strength {
  /** Bill Chen's formula, the classic preflop hand ranking (−1 … 20). */
  static chen(a, b) {
    const r1 = Cards.rank(a), r2 = Cards.rank(b), hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    const val = r => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let s;
    if (r1 === r2) s = Math.max(val(hi) * 2, 5);
    else {
      s = val(hi);
      if (Cards.suit(a) === Cards.suit(b)) s += 2;
      const gap = hi - lo - 1;
      s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
      if (gap <= 1 && hi < 12) s += 1;
    }
    return Math.ceil(s);
  }
  static preflopName(a, b) {
    const r1 = Cards.rank(a), r2 = Cards.rank(b);
    if (r1 === r2) return `Pocket ${RANK_MANY[r1].toLowerCase()}`;
    const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
    return `${RANK_ONE[hi]}-${RANK_ONE[lo].toLowerCase()} ${Cards.suit(a) === Cards.suit(b) ? 'suited' : 'offsuit'}`;
  }
}

/* ───────────── equity ───────────── */
class Equity {
  static rest(dead) {
    const used = new Uint8Array(52);
    for (const c of dead) used[c] = 1;
    const r = [];
    for (let c = 0; c < 52; c++) if (!used[c]) r.push(c);
    return r;
  }
  /** Monte Carlo win probability of `hole` against `opp` random hands. */
  static vsRandom(hole, board, opp, iters = 600) {
    opp = Math.max(1, opp);
    const rest = Equity.rest(hole.concat(board));
    const need = 5 - board.length, take = need + opp * 2, L = rest.length;
    const h = new Array(7), o = new Array(7);
    h[0] = hole[0]; h[1] = hole[1];
    for (let k = 0; k < board.length; k++) { h[2 + k] = board[k]; o[2 + k] = board[k]; }
    let score = 0;
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < take; k++) {
        const j = k + ((Math.random() * (L - k)) | 0);
        const t = rest[k]; rest[k] = rest[j]; rest[j] = t;
      }
      let x = 0;
      for (let k = board.length; k < 5; k++) { h[2 + k] = o[2 + k] = rest[x++]; }
      const me = HandEval.score(h, 7);
      let ties = 0, lost = false;
      for (let q = 0; q < opp; q++) {
        o[0] = rest[x++]; o[1] = rest[x++];
        const sc = HandEval.score(o, 7);
        if (sc > me) { lost = true; break; }
        if (sc === me) ties++;
      }
      if (!lost) score += 1 / (ties + 1);
    }
    return score / iters;
  }
  /** Equity of several known hands (all-in runouts). Exact from the flop on. */
  static known(hands, board, iters = 3000) {
    const rest = Equity.rest(hands.flat().concat(board));
    const need = 5 - board.length, n = hands.length;
    const eq = new Array(n).fill(0), b = board.slice(), tmp = new Array(7);
    let total = 0;
    const run = () => {
      let best = -1, win = [];
      for (let i = 0; i < n; i++) {
        tmp[0] = hands[i][0]; tmp[1] = hands[i][1];
        for (let k = 0; k < 5; k++) tmp[2 + k] = b[k];
        const sc = HandEval.score(tmp, 7);
        if (sc > best) { best = sc; win = [i]; } else if (sc === best) win.push(i);
      }
      for (const w of win) eq[w] += 1 / win.length;
      total++;
    };
    if (need === 0) run();
    else if (need === 1) for (const c of rest) { b[4] = c; run(); }
    else if (need === 2) {
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) { b[3] = rest[i]; b[4] = rest[j]; run(); }
    } else {
      const L = rest.length;
      for (let it = 0; it < iters; it++) {
        for (let k = 0; k < need; k++) {
          const j = k + ((Math.random() * (L - k)) | 0);
          const t = rest[k]; rest[k] = rest[j]; rest[j] = t;
        }
        for (let k = 0; k < need; k++) b[board.length + k] = rest[k];
        run();
      }
    }
    return eq.map(v => v / total);
  }
}

/* ───────────── pots ───────────── */
class PotManager {
  /** Splits every player's total contribution into a main pot and side pots. */
  static build(players) {
    const cs = players.map(p => ({ seat: p.seat, amt: p.total, live: p.active }));
    const levels = [...new Set(cs.filter(c => c.live && c.amt > 0).map(c => c.amt))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lv of levels) {
      let amount = 0;
      for (const c of cs) amount += Math.max(0, Math.min(c.amt, lv) - prev);
      const eligible = cs.filter(c => c.live && c.amt >= lv).map(c => c.seat);
      const last = pots[pots.length - 1];
      if (amount > 0) {
        if (last && last.eligible.length === eligible.length) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = lv;
    }
    const extra = cs.reduce((s, c) => s + Math.max(0, c.amt - prev), 0);
    if (extra && pots.length) pots[pots.length - 1].amount += extra;
    return pots;
  }
}

/* ───────────── bot personalities ─────────────
   play    Chen score needed to enter a pot (lower = looser)
   agg     tendency to bet/raise rather than check/call
   bluff   frequency of betting without the goods
   risk    appetite for variance: shrinks the equity needed to commit chips
   sticky  reluctance to fold once involved
   sizing  bet size as a fraction of pot
   shove   chance of a surprise all-in when opening or re-raising        */
const PROFILES = {
  rock: {
    name: 'Greta Stone', emoji: '🪨', tag: 'Rock', style: 'Tight-passive', hue: 212,
    blurb: 'Plays very few hands and hates risk. When she bets big, believe her.',
    play: 8, agg: 0.3, bluff: 0.02, risk: 0.15, sticky: 0.02, sizing: 0.55, shove: 0, noise: 0.8,
  },
  shark: {
    name: 'Viktor Sharkov', emoji: '🦈', tag: 'Shark', style: 'Tight-aggressive', hue: 190,
    blurb: 'Disciplined and price-driven. Takes calculated risks and punishes limps.',
    play: 6.8, agg: 0.68, bluff: 0.12, risk: 0.5, sticky: 0.03, sizing: 0.7, shove: 0.03, noise: 0.9,
  },
  maniac: {
    name: 'Max Mayhem', emoji: '🔥', tag: 'Maniac', style: 'Loose-aggressive', hue: 14,
    blurb: 'Raises constantly and loves a coin flip. Risk-seeking to a fault.',
    play: 4, agg: 0.88, bluff: 0.38, risk: 0.95, sticky: 0.12, sizing: 1.05, shove: 0.08, noise: 1.4,
  },
  station: {
    name: 'Phil Calloway', emoji: '🐟', tag: 'Station', style: 'Loose-passive', hue: 150,
    blurb: 'Calls far too often and rarely raises. Bet your good hands into him.',
    play: 5, agg: 0.12, bluff: 0.03, risk: 0.7, sticky: 0.38, sizing: 0.45, shove: 0, noise: 1.1,
  },
  gambler: {
    name: 'Lucky Lucia', emoji: '🎲', tag: 'Gambler', style: 'Volatile, tilts', hue: 285, tilts: true,
    blurb: 'Solid until she loses a big pot. Then her risk dial climbs fast.',
    play: 6.2, agg: 0.5, bluff: 0.18, risk: 0.72, sticky: 0.1, sizing: 0.85, shove: 0.04, noise: 1.2,
  },
};

class BotBrain {
  constructor(key) { this.key = key; this.p = PROFILES[key]; this.tilt = 0; }
  get agg() { return clamp(this.p.agg + this.tilt * 0.35, 0, 0.97); }
  get risk() { return clamp(this.p.risk + this.tilt * 0.3, 0, 1); }

  afterHand(delta, bb) {
    if (!this.p.tilts) return;
    if (delta <= -25 * bb) this.tilt = Math.min(1, this.tilt + 0.5);
    else if (delta <= -10 * bb) this.tilt = Math.min(1, this.tilt + 0.2);
    else if (delta >= 15 * bb) this.tilt *= 0.4;
    else this.tilt *= 0.85;
    if (this.tilt < 0.05) this.tilt = 0;
  }

  decide(c) { return c.street === 'preflop' ? this.preflop(c) : this.postflop(c); }

  sizeTo(to, c) {
    to = Math.round(to);
    if (to >= c.maxTo * 0.7) to = c.maxTo; // most of the stack anyway: just shove
    return clamp(to, c.minTo, c.maxTo);
  }

  preflop(c) {
    const P = this.p, bb = c.bb;
    const raw = Strength.chen(c.hole[0], c.hole[1]);
    const s = raw + (c.position - 0.5) * 2.2 + (Math.random() * 2 - 1) * P.noise + this.tilt * 2.5;
    const callBB = c.toCall / bb;
    const invested = c.bet > 0 && c.toCall <= 3 * bb ? 1.2 : 0;
    const price = callBB > 1 ? Math.min(Math.log2(callBB), 4.3) * (1.5 - this.risk) * 1.25 : 0;
    const need = P.play + price - invested;
    const eff = c.stack + c.bet;
    const raiseTo = () => {
      let to = c.isUnopened
        ? bb * (2.3 + this.agg * 0.8 + Math.random() * 0.5) + c.limpers * bb
        : c.currentBet * (2.7 + Math.random() * 0.7) + (c.position < 0.5 ? c.currentBet * 0.4 : 0);
      if (Math.random() < P.shove * (1 + this.tilt)) to = c.maxTo;
      return this.sizeTo(to, c);
    };

    if (eff <= 14 * bb) { // short stack: push or fold
      if (c.canRaise && s >= need + 0.5) return { type: 'raise', to: c.maxTo };
      if (c.canCheck) return { type: 'check' };
      if (s >= need + 1.5 || callBB <= 0.5) return { type: 'call' };
      return { type: 'fold' };
    }
    if (c.canCheck) {
      if (c.canRaise && s >= need + 2 && Math.random() < this.agg) return { type: 'raise', to: raiseTo() };
      return { type: 'check' };
    }
    if (raw >= 16) { // KK+ never folds preflop
      if (c.canRaise && Math.random() < 0.55 + this.agg * 0.4) return { type: 'raise', to: raiseTo() };
      return { type: 'call' };
    }
    const commit = c.callAmt / Math.max(1, c.stack);
    if (s < need) {
      if (c.canRaise && callBB <= 10 && Math.random() < P.bluff * 0.35) return { type: 'raise', to: raiseTo() };
      if (callBB <= 0.5 && Math.random() < 0.3 + P.sticky) return { type: 'call' };
      if (s >= need - 1.5 && commit < 0.25 && Math.random() < P.sticky) return { type: 'call' };
      return { type: 'fold' };
    }
    if (commit > 0.45 && raw < 11 - this.risk * 3 && Math.random() > this.risk * 0.3) return { type: 'fold' };
    const margin = s - need;
    let pRaise = c.isUnopened
      ? clamp(this.agg + 0.2 + margin * 0.08, 0.05, 0.97)
      : this.agg * clamp(0.15 + margin * 0.12, 0, 0.95);
    if (raw >= 12) pRaise = Math.max(pRaise, 0.5 + this.agg * 0.4);
    if (c.raiseCount >= 3 && raw < 14) pRaise *= 0.25;
    if (c.canRaise && Math.random() < pRaise) return { type: 'raise', to: raiseTo() };
    return { type: 'call' };
  }

  postflop(c) {
    const P = this.p;
    const n = Math.max(1, c.opponents);
    const eq = Equity.vsRandom(c.hole, c.board, n, 420);
    const fair = 1 / (n + 1);
    const betFrac = c.toCall / Math.max(1, c.pot - c.toCall);
    let adj = eq + this.tilt * 0.05 + (Math.random() * 2 - 1) * 0.035;
    // a bet narrows the bettor's range, so discount raw equity (less so for risk-lovers)
    if (c.toCall > 0) adj -= (0.04 + Math.min(betFrac, 1.5) * 0.08 + Math.max(0, c.raiseCount - 1) * 0.06) * (1.15 - this.risk * 0.6);
    const strong = adj >= Math.max(0.6, fair + 0.32);
    const decent = adj >= fair + 0.1;
    const riverDamp = c.street === 'river' ? 0.7 : 1;
    const size = base => base * P.sizing * (0.8 + Math.random() * 0.45);
    const betTo = frac => this.sizeTo(c.currentBet + Math.max(c.lastRaise, (c.pot + c.toCall) * frac), c);

    if (c.canCheck) {
      if (!c.canRaise) return { type: 'check' };
      if (strong) return Math.random() < this.agg + 0.25 ? { type: 'raise', to: betTo(size(0.85)) } : { type: 'check' };
      if (decent && Math.random() < this.agg * 0.55) return { type: 'raise', to: betTo(size(0.6)) };
      if (Math.random() < P.bluff * (n === 1 ? 1 : n === 2 ? 0.5 : 0.2) * riverDamp) return { type: 'raise', to: betTo(size(0.7)) };
      return { type: 'check' };
    }
    const potOdds = c.callAmt / (c.pot + c.callAmt);
    const commit = c.callAmt / Math.max(1, c.stack);
    if (strong && c.canRaise && Math.random() < this.agg * 0.8 + 0.1) {
      if (adj > 0.8 && Math.random() < this.risk * 0.35) return { type: 'raise', to: c.maxTo };
      return { type: 'raise', to: betTo(size(0.75)) };
    }
    let need = potOdds + 0.03 - P.sticky * 0.14 - (this.risk - 0.5) * 0.08;
    if (commit > 0.4) need = Math.max(need, 0.55 - this.risk * 0.25);
    if (adj >= need) return { type: 'call' };
    if (c.canRaise && c.callAmt <= c.pot * 0.5 && Math.random() < P.bluff * 0.25 * riverDamp) return { type: 'raise', to: betTo(size(0.8)) };
    return { type: 'fold' };
  }
}

/* ───────────── players ───────────── */
class Player {
  constructor(seat, name, stack, { human = false, profile = null } = {}) {
    this.seat = seat; this.name = name; this.stack = stack; this.isHuman = human;
    this.profileKey = profile; this.profile = profile ? PROFILES[profile] : null;
    this.brain = profile ? new BotBrain(profile) : null;
    this.buyIns = stack;
    this.stats = { hands: 0, vpip: 0, pfr: 0, won: 0, biggest: 0 };
    this.resetHand();
  }
  resetHand() {
    this.hole = []; this.bet = 0; this.total = 0;
    this.acted = false; this.locked = false; this.allIn = false; this.revealed = false;
    this.lastAction = null; this.flags = { vpip: false, pfr: false };
    this.inHand = this.stack > 0; this.folded = !this.inHand; this.startStack = this.stack;
  }
  get active() { return this.inHand && !this.folded; }
  get canAct() { return this.active && !this.allIn; }
  get net() { return this.stack + this.total - this.buyIns; }
}

/* ───────────── the game ───────────── */
const STREETS = [['flop', 3], ['turn', 1], ['river', 1]];
const SPEEDS = {
  relaxed: { think: 1500, deal: 150, beat: 450, between: 3800, runout: 1700, pre: 350, reveal: 260 },
  normal: { think: 950, deal: 105, beat: 320, between: 2900, runout: 1300, pre: 250, reveal: 200 },
  turbo: { think: 380, deal: 55, beat: 160, between: 1600, runout: 750, pre: 120, reveal: 110 },
};

class Game {
  constructor({ view, panel, log, sfx, settings, headless = false }) {
    Object.assign(this, { view, panel, log, sfx, settings, headless });
    this.sb = 1; this.bb = 2;
    this.players = []; this.button = 0; this.handNo = 0; this.board = [];
    this.street = 'idle'; this.paused = false; this.running = false; this._resume = null;
    this.session = { biggestPot: 0, biggestWin: 0 };
  }
  get T() { return SPEEDS[this.settings.speed] || SPEEDS.normal; }
  wait(ms) { return this.headless ? Promise.resolve() : sleep(ms); }

  setup({ name, buyInBB, heroProfile = null }) {
    this.buyIn = buyInBB * this.bb;
    Fmt.bb = this.bb;
    const keys = shuffleArr(Object.keys(PROFILES));
    this.players = [new Player(0, name || 'You', this.buyIn, heroProfile ? { profile: heroProfile } : { human: true })];
    keys.forEach((k, i) => this.players.push(new Player(i + 1, PROFILES[k].name, this.buyIn, { profile: k })));
    this.button = secureInt(6);
    this.handNo = 0;
    this.session = { biggestPot: 0, biggestWin: 0 };
  }

  /* helpers */
  get hero() { return this.players[0]; }
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

  setPaused(v) {
    this.paused = v;
    if (!v && this._resume) { const r = this._resume; this._resume = null; r(); }
  }
  async run(maxHands = Infinity) {
    this.running = true;
    while (this.running && this.handNo < maxHands) {
      if (this.paused) await new Promise(r => (this._resume = r));
      if (!this.running) break;
      const ok = await this.playHand();
      if (!ok) break;
      await this.wait(this.T.between);
    }
    this.running = false;
  }
  stop() { this.running = false; this.setPaused(false); }

  /* ── one hand ── */
  async playHand() {
    for (const p of this.players) {
      if (!p.isHuman && p.stack < this.bb) {
        p.stack += this.buyIn; p.buyIns += this.buyIn;
        this.view.toast(`${p.name} rebuys for ${Fmt.money(this.buyIn)}`);
      }
    }
    const hero = this.hero;
    if (hero.isHuman && hero.stack === 0) {
      this.view.updateTable(this);
      const again = await this.panel.askRebuy(this.buyIn);
      if (!again) return false;
      hero.stack += this.buyIn; hero.buyIns += this.buyIn;
    }

    this.handNo++;
    for (const p of this.players) p.resetHand();
    this.board = []; this.deck = new Deck(); this.street = 'preflop';
    this.currentBet = 0; this.lastRaise = this.bb; this.raiseCount = 0; this.runout = false;
    this.button = this.nextWhere(this.button, p => p.inHand);
    const seated = this.players.filter(p => p.inHand);
    const hu = seated.length === 2;
    this.sbI = hu ? this.button : this.nextWhere(this.button, p => p.inHand);
    this.bbI = this.nextWhere(this.sbI, p => p.inHand);

    this.log.startHand(this);
    await this.view.newHand(this);
    this.panel.newHand(this);
    await this.wait(this.T.beat);

    this.post(this.players[this.sbI], this.sb, 'small blind');
    this.post(this.players[this.bbI], this.bb, 'big blind');
    this.currentBet = this.bb; this.lastRaise = this.bb;
    this.sfx.chip();
    this.view.updateTable(this);
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
        this.sfx.card();
        await this.wait(this.T.deal);
      }
    }
    await this.wait(250);
    if (hero.inHand) { await this.view.revealHero(); this.log.hole(hero); }
    this.refreshHero();

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
        this.refreshHero();
        await this.wait(this.T.runout);
      }
      this.street = name;
      this.deck.burn();
      const cards = [];
      for (let k = 0; k < n; k++) cards.push(this.deck.draw());
      this.board.push(...cards);
      this.log.street(name, this.board);
      this.panel.newStreet(this);
      await this.view.dealBoard(cards, this.board.length - n, this);
      this.refreshHero();
      if (this.runout) { this.showRunoutEquity(); await this.wait(this.T.runout); }
      else await this.bettingRound(this.nextWhere(this.button, p => p.canAct));
    }
    await this.endStreet();
    if (this.activeCount() === 1) await this.awardUncontested();
    else await this.showdown();
    this.finishHand();
    return true;
  }

  post(p, amt, label) {
    const a = Math.min(amt, p.stack);
    this.pay(p, a);
    if (p.stack === 0) p.allIn = true;
    p.lastAction = { type: 'blind', to: p.bet };
    this.log.line(`${p.name} posts the ${label}, ${Fmt.usd(a)}`);
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
      a = this.panel.takePreaction(L);
      if (a) await this.wait(this.T.pre);
      else { this.sfx.turn(); a = await this.panel.prompt(L, this); }
    } else {
      const think = this.thinkTime(p, L);
      this.view.setThinking(p.seat, think);
      await this.wait(30);
      a = p.brain.decide(this.botContext(p, L));
      await this.wait(think);
      this.view.setThinking(p.seat, 0);
    }
    this.view.setActive(null);
    const res = this.apply(p, a);
    this.log.action(p, res);
    this.sfx.forAction(res);
    this.view.showAction(p, res, this);
    if (res.type === 'fold') { this.view.fold(p.seat, this); this.refreshHero(); }
    this.view.updateTable(this);
    this.panel.sync(this);
  }

  apply(p, a) {
    const L = this.legal(p);
    let type = a.type;
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
    const heroOut = !this.hero.active ? 0.55 : 1;
    return Math.round(base * weight * heroOut * (0.6 + Math.random() * 0.8));
  }

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
    return {
      street: this.street, hole: p.hole, board: this.board,
      toCall: L.toCall, callAmt: L.callAmt, canCheck: L.canCheck, canRaise: L.canRaise, minTo: L.minTo, maxTo: L.maxTo,
      pot: this.pot, currentBet: this.currentBet, lastRaise: this.lastRaise, bb: this.bb,
      stack: p.stack, bet: p.bet, opponents: this.activeCount() - 1, raiseCount: this.raiseCount,
      position, isUnopened, limpers,
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
        this.log.line(`Uncalled ${Fmt.usd(ex)} returned to ${top.name}`);
      }
      this.view.updateTable(this);
      if (this.players.some(p => p.bet > 0)) { this.sfx.chips(); await this.view.collectBets(this); }
    }
    for (const p of this.players) { p.bet = 0; p.acted = false; p.locked = false; }
    this.currentBet = 0; this.lastRaise = this.bb; this.raiseCount = 0;
    this.view.endStreet(this);
    this.view.updateTable(this);
  }

  async revealAll() {
    for (const p of this.players) {
      if (!p.active || p.revealed) continue;
      p.revealed = true;
      if (p.isHuman) continue;
      this.view.reveal(p.seat, p.hole);
      this.sfx.flip();
      this.log.shows(p);
      await this.wait(this.T.reveal);
    }
  }

  showRunoutEquity() {
    const live = this.players.filter(p => p.active);
    const eq = Equity.known(live.map(p => p.hole), this.board);
    this.view.showEquity(live.map((p, i) => ({ seat: p.seat, eq: eq[i] })));
  }

  refreshHero() {
    const h = this.hero;
    if (!h.isHuman) return;
    if (!h.inHand || h.hole.length < 2) { this.panel.info({ state: 'out' }); return; }
    if (h.folded) { this.panel.info({ state: 'folded', name: this.heroHandName() }); return; }
    const opp = this.activeCount() - 1;
    if (this.runout && h.revealed) {
      // everyone is all in and the cards are face up: show real equity, not odds vs random hands
      const live = this.players.filter(p => p.active);
      const eq = this.settings.showOdds ? Equity.known(live.map(p => p.hole), this.board)[live.indexOf(h)] : null;
      this.panel.info({ state: 'live', name: this.heroHandName(), street: this.street, opp, eq, known: true });
      return;
    }
    const eq = this.settings.showOdds && opp > 0 ? Equity.vsRandom(h.hole, this.board, opp, 1600) : null;
    this.panel.info({ state: 'live', name: this.heroHandName(), street: this.street, opp, eq });
  }
  heroHandName() {
    const h = this.hero;
    if (h.hole.length < 2) return '';
    if (this.board.length < 3) return Strength.preflopName(h.hole[0], h.hole[1]);
    return HandEval.describe(HandEval.score(h.hole.concat(this.board)));
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
    this.log.win(`${w.name} wins ${Fmt.usd(amount)}`);
    this.view.message(`${w.name} takes it`, Fmt.money(amount));
    if (w.isHuman) this.sfx.win();
    this.view.updateTable(this);
  }

  async showdown() {
    this.street = 'showdown';
    const live = this.players.filter(p => p.active);
    await this.revealAll();
    const scores = new Map(live.map(p => [p.seat, HandEval.score(p.hole.concat(this.board))]));
    for (const p of live) this.log.line(`${p.name}: ${HandEval.describe(scores.get(p.seat))}`, 'muted');
    const pots = PotManager.build(this.players);
    const won = new Array(6).fill(0);
    const results = pots.map((pot, k) => {
      let best = -1, winners = [];
      for (const s of pot.eligible) {
        const sc = scores.get(s);
        if (sc > best) { best = sc; winners = [s]; } else if (sc === best) winners.push(s);
      }
      winners.sort((a, b) => this.distFromButton(a) - this.distFromButton(b));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) { won[w] += share + (rem > 0 ? 1 : 0); rem--; }
      const label = pots.length > 1 ? (k === 0 ? 'the main pot' : `side pot ${k}`) : 'the pot';
      return { label, amount: pot.amount, winners, score: best, contested: pot.eligible.length > 1 };
    });

    const main = results[0];
    const bf = HandEval.bestFive(this.players[main.winners[0]].hole.concat(this.board));
    this.view.highlight(main.winners, bf.cards, this);

    const awards = won.map((amount, seat) => ({ seat, amount })).filter(a => a.amount > 0);
    await this.view.award(awards, this);
    for (const a of awards) {
      const p = this.players[a.seat];
      p.stack += a.amount; p.stats.won++;
      this.noteWin(p, a.amount);
    }
    for (const p of this.players) p.total = 0;

    for (const r of results) {
      const names = r.winners.map(s => this.players[s].name);
      const desc = r.contested ? ` with ${HandEval.describe(r.score).replace(/^./, m => m.toLowerCase())}` : '';
      if (names.length > 1) this.log.win(`${names.join(' and ')} split ${r.label} (${Fmt.usd(r.amount)})${desc}`);
      else this.log.win(`${names[0]} wins ${r.label} (${Fmt.usd(r.amount)})${desc}`);
    }
    const handName = HandEval.describe(main.score);
    if (main.winners.length > 1) this.view.message('Split pot', handName);
    else this.view.message(`${this.players[main.winners[0]].name} wins ${Fmt.money(won[main.winners[0]])}`, handName);
    if (main.winners.includes(0) && this.hero.isHuman) this.sfx.win(); else this.sfx.chips();
    this.view.updateTable(this);
  }

  noteWin(p, amount) {
    this.session.biggestPot = Math.max(this.session.biggestPot, amount);
    if (p.isHuman) this.session.biggestWin = Math.max(this.session.biggestWin, amount);
  }

  finishHand() {
    this.street = 'done';
    for (const p of this.players) {
      if (!p.inHand) continue;
      p.stats.hands++;
      if (p.flags.vpip) p.stats.vpip++;
      if (p.flags.pfr) p.stats.pfr++;
      if (p.brain) p.brain.afterHand(p.stack - p.startStack, this.bb);
    }
    const drift = this.totalChips() - this.totalBuyIns();
    if (drift !== 0) console.error('chip drift', drift);
    this.log.endHand(this);
    this.view.updateTable(this);
    this.panel.handOver(this);
  }
}

/* ───────────── hand log ───────────── */
class HandLog {
  constructor() { this.hands = []; this.cur = null; this.onChange = () => {}; }
  startHand(g) {
    this.cur = { no: g.handNo, lines: [], board: [] };
    this.hands.unshift(this.cur);
    if (this.hands.length > 40) this.hands.pop();
    this.line(`${g.players[g.button].name} has the button`, 'muted');
  }
  line(html, cls = '') { if (this.cur) { this.cur.lines.push({ html, cls }); this.onChange(); } }
  hole(p) { this.line(`Your cards ${Cards.htmlList(p.hole)}`); }
  action(p, r) {
    const amt = Fmt.usd(r.to);
    const txt = {
      fold: 'folds', check: 'checks', call: `calls ${Fmt.usd(r.paid)}`,
      bet: `bets ${amt}`, raise: `raises to ${amt}`,
    }[r.type];
    this.line(`${p.name} ${txt}${r.allIn ? ', all in' : ''}`, r.type === 'fold' ? 'muted' : '');
  }
  street(name, board) {
    this.cur.board = board.slice();
    this.line(`${name[0].toUpperCase() + name.slice(1)} ${Cards.htmlList(board)}`, 'street');
  }
  shows(p) { this.line(`${p.name} shows ${Cards.htmlList(p.hole)}`); }
  win(txt) { this.line(txt, 'win'); }
  endHand() { this.onChange(); }
}
