/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · shared
   Pure logic used by both sides: cards, the hand evaluator, equity,
   pots and the bot personalities. No DOM, no networking.
   ════════════════════════════════════════════════════════════════════ */
import { PROFILES } from './profiles.js';

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

/** Money formatting. `cur` is '$' at cash tables and '' in tournaments (chips have no dollar value). */
const Fmt = {
  units: 'usd', bb: 2, cur: '$',
  money(v) {
    if (this.units === 'bb') {
      const x = Math.round((v / this.bb) * 10) / 10;
      return `${x.toLocaleString('en-US')} BB`;
    }
    return this.cur + Math.round(v).toLocaleString('en-US');
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

const STREETS = [['flop', 3], ['turn', 1], ['river', 1]];
/* Timings in ms. `clock` is the shot clock; when it runs out the time bank (`bank` to start, `bankGain`
   more every hand you're dealt, up to `bankMax`) kicks in. `rit` is how long players get to agree to run it twice. */
const SPEEDS = {
  relaxed: { think: 1500, deal: 150, beat: 450, between: 3800, runout: 1700, pre: 350, reveal: 260, clock: 30000, bank: 45000, bankGain: 4000, bankMax: 90000, rit: 9000 },
  normal: { think: 950, deal: 105, beat: 320, between: 2900, runout: 1300, pre: 250, reveal: 200, clock: 25000, bank: 30000, bankGain: 3000, bankMax: 60000, rit: 7000 },
  turbo: { think: 380, deal: 55, beat: 160, between: 1600, runout: 750, pre: 120, reveal: 110, clock: 15000, bank: 20000, bankGain: 2000, bankMax: 40000, rit: 5000 },
  // automated tests only (the server refuses it unless ALLOW_TEST_SPEED is set)
  test: { think: 0, deal: 0, beat: 0, between: 5, runout: 0, pre: 0, reveal: 0, clock: 400, bank: 300, bankGain: 0, bankMax: 300, rit: 300 },
};

/* ───────────── stakes & tournaments ─────────────
   Cash tables pick one of these; buy-ins come out of the player's bankroll. */
const STAKES = {
  micro: { sb: 1, bb: 2, label: '$1/$2' },
  low: { sb: 5, bb: 10, label: '$5/$10' },
  mid: { sb: 25, bb: 50, label: '$25/$50' },
  high: { sb: 100, bb: 200, label: '$100/$200' },
};
/** Sit & Go: six players, 1,500 chips each, blinds rise every few hands. Top two are paid. */
const SNG = {
  chips: 1500,
  payouts: [0.65, 0.35],
  levels: [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200], [1000, 2000], [1500, 3000], [2500, 5000]],
  handsPerLevel: { relaxed: 10, normal: 8, turbo: 6, test: 3 },
  buyIns: [100, 500, 2500],
};

/** Player-supplied text ends up in HTML and in `{$n}` money templates: keep it plain. */
const cleanName = (s, max = 16, fallback = 'Player') =>
  String(s ?? '').replace(/[<>&"'`{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;

/** Server messages carry amounts as `{$123}` so each client formats them in its own units. */
const fillMoney = s => String(s ?? '').replace(/\{\$(\d+)\}/g, (_, n) => Fmt.money(+n));

export {
  clamp, sleep, secureInt, shuffleArr, RANK_CH, RANK_ONE, RANK_MANY, Fmt, Cards, Deck, HandEval, Strength, Equity,
  PotManager, PROFILES, STREETS, SPEEDS, STAKES, SNG, cleanName, fillMoney,
};
