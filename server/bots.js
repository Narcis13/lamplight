/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · bots
   The bots' brains and the table's reads on every player.

   Preflop  every one of the 169 starting-hand classes is ranked once
            (equity against two random hands), so "top 18%" means the
            same thing to every bot. Ranges widen with position and with
            the profile's appetite, and shrink against big raises.
   Postflop a bot estimates each opponent's range from what they did:
            the preflop action sets a starting range, every bet, call
            and check since then reweights it, and a Monte Carlo against
            hands drawn from those ranges gives its equity. Draws, board
            texture, position, pot odds and the opponent's reads
            (fold to c-bet, aggression, how often they call down) shape
            what it does with that number.
   Talk     each profile has its own voice, and speaks rarely.
   ════════════════════════════════════════════════════════════════════ */
import { clamp, HandEval, Strength, PROFILES } from '../shared/engine.js';

/* ───────────── hand classes ─────────────
   class index: pairs on the diagonal (r*13+r), suited above it
   (hi*13+lo), offsuit below it (lo*13+hi); rank index 0 = deuce.       */
const rk = c => c >> 2, st = c => c & 3;
function classOf(a, b) {
  const x = rk(a), y = rk(b), hi = Math.max(x, y), lo = Math.min(x, y);
  if (x === y) return x * 13 + x;
  return st(a) === st(b) ? hi * 13 + lo : lo * 13 + hi;
}
const classCombos = k => { const r = Math.floor(k / 13), c = k % 13; return r === c ? 6 : r > c ? 4 : 12; };

/** Small seeded PRNG, so the preflop ranking is the same on every start. */
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PCT[class] = share of all 1326 combos at least as strong as this class (0 = aces). */
const PCT = new Float64Array(169);
(function rankClasses() {
  const rnd = mulberry(20240611), strength = new Float64Array(169);
  const h = new Array(7), o = new Array(7), used = new Uint8Array(52);
  const ITER = 1500;
  for (let k = 0; k < 169; k++) {
    const r = Math.floor(k / 13), c = k % 13;
    let a, b;
    if (r === c) { a = r * 4; b = r * 4 + 1; } else if (r > c) { a = r * 4; b = c * 4; } else { a = c * 4; b = r * 4 + 1; }
    let score = 0;
    for (let it = 0; it < ITER; it++) {
      used.fill(0); used[a] = used[b] = 1;
      const draw = () => { let x; do { x = (rnd() * 52) | 0; } while (used[x]); used[x] = 1; return x; };
      for (let q = 0; q < 5; q++) h[2 + q] = draw();
      h[0] = a; h[1] = b;
      const me = HandEval.score(h, 7);
      let lost = false, ties = 0;
      for (let v = 0; v < 2 && !lost; v++) {
        o[0] = draw(); o[1] = draw();
        for (let q = 2; q < 7; q++) o[q] = h[q];
        const s = HandEval.score(o, 7);
        if (s > me) lost = true; else if (s === me) ties++;
      }
      if (!lost) score += 1 / (ties + 1);
    }
    // all-in equity overrates small pairs and underrates suited connectors, which play
    // well after the flop: blend in Chen's formula, which knows about both
    strength[k] = (score / ITER - 0.33) / 0.4 * 0.75 + Strength.chen(a, b) / 20 * 1.3;
  }
  const order = Array.from({ length: 169 }, (_, k) => k).sort((x, y) => strength[y] - strength[x]);
  let cum = 0;
  for (const k of order) { PCT[k] = cum / 1326; cum += classCombos(k); }
})();

/** All 1326 two-card combos with their class, for range sampling. */
const COMBOS = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b, classOf(a, b)]);
const NC = COMBOS.length;

/* ───────────── board reading ───────────── */
const straightHi = mask => {
  for (let h = 14; h >= 5; h--) { const m = 31 << (h - 4); if ((mask & m) === m) return h; }
  const wheel = (1 << 14) | (1 << 5) | (1 << 4) | (1 << 3) | (1 << 2);
  return (mask & wheel) === wheel ? 5 : 0;
};
const rankMask = cards => { let m = 0; for (const c of cards) { const r = rk(c) + 2; m |= 1 << r; if (r === 14) m |= 1 << 1; } return m; };
/** How many missing ranks would complete a straight for these cards. */
function straightOuts(cards) {
  const m = rankMask(cards);
  if (straightHi(m)) return -1;
  let n = 0;
  for (let r = 2; r <= 14; r++) if (!(m & (1 << r)) && straightHi(m | (1 << r) | (r === 14 ? 2 : 0))) n++;
  return n;
}

function texture(board) {
  const suits = [0, 0, 0, 0], ranks = board.map(c => rk(c) + 2).sort((a, b) => b - a);
  for (const c of board) suits[st(c)]++;
  const maxSuit = Math.max(...suits);
  const paired = new Set(ranks).size < ranks.length;
  let conn = 0;
  const u = [...new Set(ranks)];
  for (let i = 0; i + 1 < u.length; i++) if (u[i] - u[i + 1] <= 2) conn++;
  const wet = clamp((maxSuit >= 3 ? 0.55 : maxSuit === 2 && board.length < 5 ? 0.25 : 0) + conn * 0.2 + (paired ? -0.1 : 0), 0, 1);
  return { wet, paired, maxSuit, top: ranks[0], ranks };
}

/**
 * How good two hole cards are on this board, in five buckets:
 * 0 air · 1 weak (bottom pair, ace high) · 2 medium (top pair weak kicker, second pair)
 * 3 strong (top pair good kicker, overpair, clean two pair) · 4 monster (sets, straights and up)
 * Plus draw info.
 */
function madeClass(a, b, board, bScore = null) {
  const cards = [a, b, ...board];
  const s = HandEval.score(cards);
  const cat = HandEval.category(s);
  const bcat = HandEval.category(bScore ?? HandEval.score(board));
  const ra = rk(a) + 2, rb = rk(b) + 2;
  const bRanks = board.map(c => rk(c) + 2).sort((x, y) => y - x);
  const top = bRanks[0];
  let cls = 0;
  if (cat >= 4) cls = cat > bcat ? 4 : 1;
  else if (cat === 3) cls = bcat >= 3 ? 1 : (ra === rb || bRanks.includes(ra) || bRanks.includes(rb)) ? (bcat === 1 && ra !== rb ? 3 : 4) : 1;
  else if (cat === 2) {
    if (bcat === 0) cls = 3;
    else if (bcat === 1) {
      // one pair of our own on a paired board: grade that pair
      const pr = ra === rb ? ra : bRanks.includes(ra) ? ra : bRanks.includes(rb) ? rb : 0;
      cls = pr === 0 ? 1 : pr >= top ? 3 : 2;
    } else cls = 1;
  } else if (cat === 1) {
    if (bcat === 1) cls = Math.max(ra, rb) === 14 ? 1 : 0; // the pair is on the board
    else {
      const pr = Math.floor(s / 50625) % 15;
      if (ra === rb) cls = pr > top ? 3 : pr > bRanks[1] ? 2 : 1;
      else if (pr === top) { const kick = pr === ra ? rb : ra; cls = kick >= 11 || kick >= top - 1 ? 3 : 2; }
      else if (pr === bRanks[1]) cls = 2;
      else cls = 1;
    }
  } else cls = Math.max(ra, rb) === 14 && board.length < 5 ? 1 : 0;

  let fd = false, sd = 0;
  if (board.length < 5) {
    const suits = [0, 0, 0, 0];
    for (const c of cards) suits[st(c)]++;
    for (let q = 0; q < 4; q++) if (suits[q] === 4 && (st(a) === q || st(b) === q)) fd = true;
    const o = straightOuts(cards), ob = straightOuts(board);
    if (o > 0 && o > Math.max(0, ob)) sd = o >= 2 ? 2 : 1;
  }
  return { cls, cat, fd, sd, outs: (fd ? 9 : 0) + (sd === 2 ? 8 : sd === 1 ? 4 : 0) - (fd && sd ? 2 : 0), score: s };
}

/* ───────────── what everyone knows about everyone ───────────── */
const PRIOR = { vpip: 0.28, pfr: 0.18, threeBet: 0.07, cbet: 0.6, foldToCbet: 0.45, af: 2, wtsd: 0.3, wsd: 0.5 };
const emptyCounts = () => ({ h: 0, vp: 0, pf: 0, tbo: 0, tb: 0, cbo: 0, cb: 0, fco: 0, fc: 0, ag: 0, ca: 0, sf: 0, sd: 0, sw: 0 });
/** How much a read is worth: nothing at first, full weight after ~60 hands. */
const trust = s => Math.min(1, (s.conf || 0) * 1.6);
const shrink = (k, n, prior, w) => (k + prior * w) / (n + w);

function ratesOf(n) {
  return {
    hands: n.h,
    vpip: shrink(n.vp, n.h, PRIOR.vpip, 12),
    pfr: shrink(n.pf, n.h, PRIOR.pfr, 12),
    threeBet: shrink(n.tb, n.tbo, PRIOR.threeBet, 15),
    cbet: shrink(n.cb, n.cbo, PRIOR.cbet, 8),
    foldToCbet: shrink(n.fc, n.fco, PRIOR.foldToCbet, 8),
    af: (n.ag + PRIOR.af * 4) / (n.ca + 4),
    wtsd: shrink(n.sd, n.sf, PRIOR.wtsd, 10),
    wsd: shrink(n.sw, n.sd, PRIOR.wsd, 8),
    conf: n.h / (n.h + 40),
    n: { ...n },
  };
}

/**
 * The table's reads on each player, keyed by player id. Counters accumulate
 * across sessions (dump/load); rates are shrunk toward population averages,
 * so a handful of hands barely moves them.
 */
export class TableReads {
  constructor() { this.byId = new Map(); this.cache = new Map(); }
  counts(id) {
    let n = this.byId.get(id);
    if (!n) { n = emptyCounts(); this.byId.set(id, n); }
    return n;
  }
  onAction() {}
  onHandEnd(sum) {
    if (!sum || !sum.players) return;
    const bySeat = new Map(sum.players.map(p => [p.seat, p]));
    for (const p of sum.players) {
      if (!p.id) continue;
      const n = this.counts(p.id);
      n.h++;
      if (p.vpip) n.vp++;
      if (p.pfr) n.pf++;
      if (p.sawFlop) { n.sf++; if (p.showdown) { n.sd++; if (p.won) n.sw++; } }
    }
    const acts = sum.actions || [];
    // three-bet opportunities: acting preflop after exactly one raise
    let raises = 0;
    const tbSeen = new Set();
    for (const a of acts) {
      if (a.street !== 'preflop') continue;
      if (raises === 1 && a.id && !tbSeen.has(a.id)) {
        tbSeen.add(a.id);
        const n = this.counts(a.id);
        n.tbo++;
        if (a.type === 'raise') n.tb++;
      }
      if (a.type === 'raise' || a.type === 'bet') raises++;
    }
    // continuation bets and folds to them
    const pfa = bySeat.get(sum.pfAggressor);
    const flop = acts.filter(a => a.street === 'flop');
    if (pfa && pfa.id && pfa.sawFlop) {
      let betBefore = false, cbetAt = -1;
      for (let i = 0; i < flop.length; i++) {
        const a = flop[i];
        if (a.seat === pfa.seat) {
          if (!betBefore) {
            const n = this.counts(pfa.id);
            n.cbo++;
            if (a.type === 'bet') { n.cb++; cbetAt = i; }
          }
          break;
        }
        if (a.type === 'bet' || a.type === 'raise') betBefore = true;
      }
      if (cbetAt >= 0) {
        const seen = new Set();
        for (let i = cbetAt + 1; i < flop.length; i++) {
          const a = flop[i];
          if (a.seat === pfa.seat || !a.id || seen.has(a.id)) continue;
          seen.add(a.id);
          const n = this.counts(a.id);
          n.fco++;
          if (a.type === 'fold') n.fc++;
          if (a.type === 'raise') break;
        }
      }
    }
    // aggression factor: postflop bets and raises against calls
    for (const a of acts) {
      if (a.street === 'preflop' || !a.id) continue;
      if (a.type === 'bet' || a.type === 'raise') this.counts(a.id).ag++;
      else if (a.type === 'call') this.counts(a.id).ca++;
    }
    this.cache.clear();
  }
  get(id) {
    if (!id || !this.byId.has(id)) return null;
    let s = this.cache.get(id);
    if (!s) { s = ratesOf(this.byId.get(id)); this.cache.set(id, s); }
    return s;
  }
  load(id, data) {
    if (!id || !data) return;
    const src = data.n || data;
    const n = emptyCounts();
    for (const k of Object.keys(n)) n[k] = Math.max(0, Math.floor(Number(src[k]) || 0));
    this.byId.set(id, n);
    this.cache.delete(id);
  }
  dump(id) { const n = this.byId.get(id); return n ? { ...n } : null; }
}

/* ───────────── ranges ───────────── */
const OPEN = { UTG: 0.15, HJ: 0.19, CO: 0.27, BTN: 0.43, SB: 0.38, BB: 0.35 }; // a solid regular's opening ranges
const POS_MULT = { UTG: 0.7, HJ: 0.85, CO: 1.1, BTN: 1.5, SB: 1.2, BB: 0.8 };

/** Weight of a class inside a "top X" range, with a soft edge. */
const inTop = (pct, x) => (pct <= x ? 1 : Math.max(0.004, Math.exp(-(pct - x) / 0.045)));

/**
 * Estimates a villain's preflop range (per-class weights) from their preflop
 * actions this hand and their reads. `use` (0..1) is how much the bot trusts
 * the reads over population priors.
 */
function preflopRange(v, acts, use) {
  const stat = (k) => { const s = v.stats; return s ? PRIOR[k] + use * trust(s) * (s[k] - PRIOR[k]) : PRIOR[k]; };
  const pm = POS_MULT[v.pos] || 1;
  let raises = 0, myRaise = 0, called = false, limped = false;
  for (const a of acts) {
    if (a.street !== 'preflop') continue;
    if (a.seat === v.seat) {
      if (a.type === 'raise') myRaise = raises + 1;
      else if (a.type === 'call') { if (raises === 0) limped = true; else called = true; }
    }
    if (a.type === 'raise') raises++;
  }
  const vpip = clamp(stat('vpip'), 0.06, 0.85), pfr = clamp(stat('pfr'), 0.03, Math.max(0.05, vpip));
  const w = new Float64Array(169);
  let top, capAt = 0, capW = 1;
  if (myRaise >= 3) top = clamp(0.025 + stat('threeBet') * 0.15, 0.02, 0.08);
  else if (myRaise === 2) top = clamp(stat('threeBet') * 1.1, 0.025, 0.22);
  else if (myRaise === 1) top = clamp(pfr * pm * 1.05, 0.04, 0.7);
  else if (called) { top = clamp(vpip * pm * 0.85, 0.08, 0.75); capAt = clamp(pfr * 0.35, 0.02, 0.1); capW = 0.35; }
  else if (limped) { top = clamp(vpip * pm, 0.1, 0.85); capAt = clamp(pfr * 0.6, 0.03, 0.15); capW = 0.3; }
  else { top = 1; capAt = v.pos === 'BB' ? clamp(pfr * 0.5, 0.03, 0.12) : 0; capW = 0.4; } // checked the big blind
  for (let k = 0; k < 169; k++) w[k] = inTop(PCT[k], top) * (PCT[k] < capAt ? capW : 1);
  return w;
}

/** How likely a hand of this bucket is to take each kind of postflop action. */
const ON_BET = [0.16, 0.28, 0.55, 0.92, 1];
const ON_RAISE = [0.1, 0.12, 0.3, 0.8, 1];
const ON_CALL = [0.12, 0.55, 0.95, 0.85, 0.55];
const ON_CHECK = [1, 1, 0.85, 0.55, 0.4];

/**
 * Win probability against the active villains, each holding a hand drawn
 * from their estimated range.
 */
function rangeEquity(c, use, iters) {
  const hole = c.hole, board = c.board;
  const dead = new Uint8Array(52);
  dead[hole[0]] = dead[hole[1]] = 1;
  for (const x of board) dead[x] = 1;
  const bScore = board.length >= 3 ? HandEval.score(board) : 0;
  const post = c.actions.filter(a => a.street !== 'preflop');

  const vs = c.villains;
  const tables = vs.map(v => {
    const pre = preflopRange(v, c.actions, use);
    const s = v.stats;
    const af = s ? PRIOR.af + use * trust(s) * (s.af - PRIOR.af) : PRIOR.af;
    const wt = s ? PRIOR.wtsd + use * trust(s) * (s.wtsd - PRIOR.wtsd) : PRIOR.wtsd;
    const bluffy = clamp(0.16 + (af - 2) * 0.07, 0.05, 0.45);
    const floaty = clamp(0.12 + (wt - 0.3) * 0.8, 0.05, 0.4);
    const mine = post.filter(a => a.seat === v.seat);
    const cum = new Float64Array(NC);
    let total = 0;
    for (let i = 0; i < NC; i++) {
      const [a, b, k] = COMBOS[i];
      let w = 0;
      if (!dead[a] && !dead[b]) {
        w = pre[k];
        if (w > 0.003 && mine.length && board.length >= 3) {
          const m = madeClass(a, b, board, bScore);
          const drawy = m.outs >= 8;
          for (const act of mine) {
            let f;
            if (act.type === 'bet') f = m.cls === 0 ? bluffy : ON_BET[m.cls];
            else if (act.type === 'raise') f = m.cls === 0 ? bluffy * 0.6 : ON_RAISE[m.cls];
            else if (act.type === 'call') f = m.cls === 0 ? floaty : ON_CALL[m.cls];
            else if (act.type === 'check') f = ON_CHECK[m.cls];
            else continue;
            if (drawy && act.type !== 'check') f = Math.max(f, act.type === 'call' ? 0.85 : 0.5);
            if (act.allIn && m.cls < 3 && !drawy) f *= 0.6;
            w *= f;
          }
        }
      }
      total += w;
      cum[i] = total;
    }
    return { cum, total };
  });

  const pick = (t, rnd) => {
    const x = rnd * t.total;
    let lo = 0, hi = NC - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (t.cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const need = 5 - board.length;
  const h = new Array(7), o = new Array(7), used = new Uint8Array(52);
  let score = 0, n = 0;
  for (let it = 0; it < iters; it++) {
    used.set(dead);
    const hands = [];
    let ok = true;
    for (const t of tables) {
      if (t.total <= 0) { ok = false; break; }
      let tries = 0, cmb;
      do { cmb = COMBOS[pick(t, Math.random())]; } while ((used[cmb[0]] || used[cmb[1]]) && ++tries < 12);
      if (used[cmb[0]] || used[cmb[1]]) { ok = false; break; }
      used[cmb[0]] = used[cmb[1]] = 1;
      hands.push(cmb);
    }
    if (!ok) continue;
    for (let k = 0; k < board.length; k++) h[2 + k] = board[k];
    for (let k = 0; k < need; k++) { let x; do { x = (Math.random() * 52) | 0; } while (used[x]); used[x] = 1; h[2 + board.length + k] = x; }
    h[0] = hole[0]; h[1] = hole[1];
    const me = HandEval.score(h, 7);
    let lost = false, ties = 0;
    for (const [a, b] of hands) {
      o[0] = a; o[1] = b;
      for (let k = 2; k < 7; k++) o[k] = h[k];
      const s = HandEval.score(o, 7);
      if (s > me) { lost = true; break; }
      if (s === me) ties++;
    }
    n++;
    if (!lost) score += 1 / (ties + 1);
  }
  return n ? score / n : 0.5;
}

/* ───────────── table talk ─────────────
   %N is the other player's name (the one greeted, busted or who won). */
const TALK = {
  rock: {
    greet: ['Evening, %N. Mind the blinds.', 'Welcome, %N. I fold a lot, don\'t take it personally.', 'Hello %N. Pull up a chair, the coffee is terrible.'],
    bigWin: ['Patience pays. Eventually.', 'That is why I wait.', 'Slow and steady, as my mother said.'],
    badBeat: ['Of course. Of course that card.', 'I had it. I always have it, and then this.', 'Forty years of poker and the river still hates me.'],
    bluff: ['I would never bluff. Probably.', 'Believe what you like, dear.'],
    busted: ['Sorry, %N. It was a good hand, truly.', 'Better luck next time, %N.'],
    gotBusted: ['Well. That was a whole evening of folding for nothing.', 'I shall go knit something.'],
    tilt: ['I am perfectly calm. Perfectly.'],
    bigLoss: ['Hmph.', 'That will take a hundred orbits to win back.', 'I should have folded. I always should have folded.'],
    allin: ['I have been waiting all night for this one.'],
  },
  shark: {
    greet: ['Welcome, %N. Stacks look healthy.', '%N. Good. Fresh money.', 'Sit, %N. The water is warm.'],
    bigWin: ['Math always collects.', 'Priced in.', 'Thank you for the contribution.'],
    badBeat: ['You had four outs. Four.', 'Correct decision. Wrong card.', 'Variance. Noted, not forgotten.'],
    bluff: ['Folding was right. Probably.', 'You will never know.', 'Good fold. Maybe.'],
    busted: ['Nothing personal, %N.', 'Reload whenever you like, %N.'],
    gotBusted: ['Rebuying. Obviously.', 'Fine. The long run is long.'],
    tilt: ['I do not tilt. I recalibrate.'],
    bigLoss: ['Noted.', 'Nice hand. Remember it, it won\'t happen often.'],
    allin: ['Your decision.'],
  },
  maniac: {
    greet: ['%N! Finally someone with a pulse!', 'Welcome %N, hope you like action!', 'Buckle up, %N. I raise everything.'],
    bigWin: ['WOO! Ship it!', 'Raise, raise, raise, profit!', 'Told you. Any two cards can win!', 'That is how we do it!'],
    badBeat: ['Rigged! Totally rigged! Deal again!', 'Unreal. Absolutely unreal.', 'Fine, I will just raise harder.'],
    bluff: ['Seven-deuce baby. Or not. Ha!', 'You folded the winner. Maybe!', 'Fear is a great poker strategy. Yours, not mine.'],
    busted: ['Boom! See ya %N!', 'Gamble gamble, %N! Rebuy!'],
    gotBusted: ['Rebuy! Rebuy! Rebuy!', 'That was fun. Again!'],
    tilt: ['I am not tilting, I am PLAYING!'],
    bigLoss: ['Whatever, chips are for spending.', 'Easy come, easy go!'],
    allin: ['ALL IN! Let\'s gamble!', 'Shove! Who is brave?'],
  },
  station: {
    greet: ['Hi %N! I call a lot, just so you know.', 'Hey %N, welcome aboard.', 'Oh good, %N is here. More friends!'],
    bigWin: ['Knew you were bluffing!', 'I just had a feeling.', 'Glad I called. I always call.'],
    badBeat: ['But I called! I always call!', 'Aw shucks.', 'I thought my pair was good...'],
    bluff: ['Huh, you folded? Okay then!', 'Wait, I won? Neat.'],
    busted: ['Sorry %N, I just had to see it.', 'Good game %N!'],
    gotBusted: ['Well, I did call a lot.', 'Back to the ATM, I guess.'],
    tilt: ['I will call even more now. That will show them.'],
    bigLoss: ['I just wanted to see the river.', 'Couldn\'t fold that. Could I have folded that?'],
    allin: ['Oh gosh. Okay. All of it.'],
  },
  gambler: {
    greet: ['Oh hey %N, feeling lucky tonight?', 'Welcome %N! This seat is hot, I promise.', '%N! Blow on my cards for luck.'],
    bigWin: ['Lady luck, I love you!', 'Did you see that? DID YOU SEE THAT?', 'The streak is ON.'],
    badBeat: ['NO. No no no no.', 'You called with THAT?', 'I am cursed. Officially cursed.'],
    bluff: ['A lady never tells.', 'Luck, skill, who can say?'],
    busted: ['Sorry %N, the dice were rolling my way!', 'Fortune favors the bold, %N.'],
    gotBusted: ['Just one more buy-in. Just one.', 'My luck is coming back, I can feel it.'],
    tilt: ['Okay. OKAY. Now I am mad.', 'Fine. Every hand. Every single hand.'],
    bigLoss: ['The cards owe me now.', 'That one stung.'],
    allin: ['All the chips, all the luck!'],
  },
  pro: {
    greet: ['Welcome, %N. Good luck.', 'Evening, %N. Play well.', 'Hi %N. Nice to have a new opponent.'],
    bigWin: ['Standard.', 'The river was a good card for my range.', 'Well played, everyone.'],
    badBeat: ['Nice catch. I\'d get it in again.', 'That is poker. Good hand.', 'Equity is only a promise.'],
    bluff: ['My range had plenty of value there.', 'Sometimes it is the nuts.'],
    busted: ['Good game, %N. Close one.', 'Well played, %N. Unlucky end.'],
    gotBusted: ['Good game. Back shortly.', 'Close spot. I\'ll reload.'],
    tilt: ['Deep breath.'],
    bigLoss: ['Nice hand.', 'Well played. I will think about that one.'],
    allin: ['I have to put you to the test.'],
  },
  nit: {
    greet: ['Hello, %N. I play one hand an hour.', '%N. Welcome. Fold more, you\'ll see.'],
    bigWin: ['Finally. Aces, obviously.', 'Worth the wait.', 'See? Only play the good ones.'],
    badBeat: ['Aces. Cracked. Again. By that.', 'Why do I even wait for premiums.', 'Unbelievable. Truly.'],
    bluff: ['I only bet the nuts. Obviously.', 'I had it. I always have it.'],
    busted: ['Should have folded, %N.', 'I did warn you, %N. I had it.'],
    gotBusted: ['Three hours of folding for that.', 'I am going to fold for a week.'],
    tilt: ['That is it. Only aces from now on.'],
    bigLoss: ['Kings. I had KINGS.', 'This game is pure luck.'],
    allin: ['I have been waiting two hours for this.'],
  },
  trapper: {
    greet: ['Welcome, %N. Make yourself comfortable.', 'Oh, %N. Lovely. Do bet, won\'t you?'],
    bigWin: ['Thank you for betting into me.', 'Checks can be so misleading.', 'Caught one.'],
    badBeat: ['Hmm. Should have raised earlier.', 'Slowplayed myself. Lesson noted.', 'The trap sprang the wrong way.'],
    bluff: ['Checks, bets, who can tell?', 'Or did I have it?'],
    busted: ['Into the web, %N.', 'So sorry, %N. Not really.'],
    gotBusted: ['Outplayed at my own game. Well done.', 'I will be back. Quietly.'],
    tilt: ['No more slowplaying. Maybe.'],
    bigLoss: ['Interesting.', 'I will remember that hand.'],
    allin: ['Well, since you insist.'],
  },
  tourist: {
    greet: ['Hey %N! First time here too? Me neither!', 'Aloha %N! Drinks are on me!', '%N! We are gonna have fun tonight!'],
    bigWin: ['WOO! Vacation fund restored!', 'Is this what winning feels like? I love it!', 'Beginner\'s luck never ends!', 'Drinks on me! Again!'],
    badBeat: ['Aw man, I was so close!', 'Wait, that beats me? Really?', 'Poker is hard. Is it hard? It\'s hard.'],
    bluff: ['I had no idea what I had! Ha!', 'Did I have something? Who knows!'],
    busted: ['Oops! Sorry %N! Great game!', 'High five, %N? No? Okay.'],
    gotBusted: ['Back to the pool then!', 'Worth every penny!', 'Time for another buy-in and another drink!'],
    tilt: ['That\'s it, I\'m going all in on everything! Kidding. Mostly.'],
    bigLoss: ['Easy come, easy go!', 'Put it on the room!'],
    allin: ['YOLO!', 'All in! Is that how you say it?'],
  },
};

/* ───────────── the brain ───────────── */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;

export class BotBrain {
  constructor(key, skill = 0.7) {
    this.key = key; this.p = PROFILES[key] || PROFILES.shark; this.skill = skill;
    this.tilt = 0; this.hands = 0; this.sinceChat = 99; this.greeted = 0;
    this.bluffing = false; this.trapStreet = null; this.lastBluff = false; this.tiltSaid = false;
  }
  get agg() { return clamp(this.p.agg + this.tilt * 0.3, 0, 0.97); }
  get risk() { return clamp(this.p.risk + this.tilt * 0.3, 0, 1); }
  /** How far the bot trusts its reads on others (casual bots barely use them). */
  get use() { return clamp(this.skill, 0, 1); }
  /** How erratic its judgement is. */
  get fuzz() { return this.p.noise * (1.25 - clamp(this.skill, 0, 1)) + this.tilt * 0.5; }

  afterHand(me = {}) {
    const P = this.p, bb = me.bb || 2, d = me.delta || 0, tt = P.tiltiness ?? (P.tilts ? 1 : 0.2);
    const cap = P.tilts ? 1 : 0.6;
    const bad = me.showdown && !me.won && me.score != null && HandEval.category(me.score) >= 4;
    if (d <= -25 * bb) this.tilt += 0.5 * tt;
    else if (d <= -10 * bb) this.tilt += 0.2 * tt;
    if (bad) this.tilt += 0.25 * tt;
    if (d >= 15 * bb) this.tilt *= 0.4;
    else if (d > -10 * bb) this.tilt *= P.tilts ? 0.85 : 0.75;
    this.tilt = clamp(this.tilt, 0, cap);
    if (this.tilt < 0.05) { this.tilt = 0; this.tiltSaid = false; }
    this.hands++; this.sinceChat++;
    this.lastBluff = this.bluffing;
    this.bluffing = false; this.trapStreet = null;
  }

  /* ── talk ── */
  say(kind, name = '', gap = 4, chance = 1) {
    const lines = (TALK[this.key] || TALK.shark)[kind];
    if (!lines || this.sinceChat < gap) return null;
    if (Math.random() > chance * (this.p.chatty ?? 0.5)) return null;
    this.sinceChat = 0;
    const text = lines[Math.floor(Math.random() * lines.length)].replace(/%N/g, name || 'friend');
    return text.replace(/[<>{}]/g, '').slice(0, 90);
  }
  /** Run it twice? Cautious players like less variance; gamblers want one big sweat. */
  runTwice() { return Math.random() < clamp(0.92 - this.risk * 0.65, 0.12, 0.92); }

  react(evt) {
    if (!evt) return null;
    if (evt.type === 'greet') {
      if (this.greeted > 2) return null;
      const t = this.say('greet', evt.name, 1, 0.55);
      if (t) this.greeted++;
      return t;
    }
    if (evt.type === 'allin') return this.say('allin', '', 3, 0.2);
    if (evt.type !== 'handEnd') return null;
    const bb = evt.bb || 2, d = evt.delta || 0;
    const w = (evt.winners || [])[0];
    if (evt.iBusted) return this.say('gotBusted', '', 1, 0.8);
    if (evt.won && evt.busted && evt.busted.length) return this.say('busted', evt.busted[0], 1, 0.7);
    if (evt.showdown && !evt.won && (evt.myCat >= 4 || (d <= -40 * bb && evt.myCat >= 2))) return this.say('badBeat', w ? w.name : '', 2, 0.75);
    if (evt.won && !evt.showdown && this.lastBluff && evt.pot >= 12 * bb) return this.say('bluff', '', 4, 0.5);
    if (evt.won && d >= 20 * bb) return this.say('bigWin', '', 3, 0.55);
    if (this.p.tilts && this.tilt >= 0.3 && !this.tiltSaid) { this.tiltSaid = true; return this.say('tilt', '', 1, 0.9); }
    if (d <= -30 * bb) return this.say('bigLoss', w ? w.name : '', 4, 0.35);
    return null;
  }

  /* ── decisions ── */
  decide(c) {
    const a = c.street === 'preflop' ? this.preflop(c) : this.postflop(c);
    return this.legalize(a, c);
  }

  legalize(a, c) {
    if (!a || a.type === 'fold') return c.canCheck ? { type: 'check' } : { type: 'fold' };
    if (a.type === 'raise') {
      if (!c.canRaise) return c.canCheck ? { type: 'check' } : { type: 'call' };
      return { type: 'raise', to: this.sizeTo(a.to, c) };
    }
    if (a.type === 'check' && !c.canCheck) return { type: 'fold' };
    if (a.type === 'call' && c.canCheck) return { type: 'check' };
    return a;
  }

  /** Rounds a target to a legal size; with most of the stack going in anyway, shoves. */
  sizeTo(to, c) {
    to = Math.round(Number(to) || c.minTo);
    const behind = c.maxTo - to;
    const potAfter = c.pot + (to - c.bet) * 2;
    if (to >= c.maxTo * 0.72 || behind < potAfter * 0.25) to = c.maxTo;
    return clamp(to, c.minTo, c.maxTo);
  }
  betFrac(c, frac) {
    const f = frac * this.p.sizing * (0.88 + Math.random() * 0.24) * (this.key === 'tourist' ? 0.55 + Math.random() * 1.1 : 1);
    return c.currentBet + Math.max(c.lastRaise, (c.pot + c.toCall) * f);
  }

  /* ── preflop ── */
  preflop(c) {
    const P = this.p, bb = c.bb, t = this.tilt;
    const pct = clamp(PCT[classOf(c.hole[0], c.hole[1])] + gauss() * 0.025 * this.fuzz, 0, 1);
    const loose = clamp((P.vpip / 0.22) * (1 + t * 0.9), 0.3, 3.2);
    const pos = c.posName || 'BTN';
    const effBB = (c.effStack || c.stack + c.bet) / bb;
    const raiser = c.villains.find(v => v.seat === c.pfAggressor);
    const stat = (v, k) => (v && v.stats ? PRIOR[k] + this.use * trust(v.stats) * (v.stats[k] - PRIOR[k]) : PRIOR[k]);
    const raise = to => ({ type: 'raise', to });
    const shove = () => raise(c.maxTo);

    /* short stacks: push or fold */
    if (effBB <= 13 || (c.tournament && effBB <= 16)) {
      if (c.raiseCount === 0) {
        const base = { UTG: 0.13, HJ: 0.17, CO: 0.24, BTN: 0.36, SB: 0.5, BB: 0.5 }[pos] ?? 0.25;
        const push = clamp(base * Math.pow(10 / Math.max(effBB, 2), 0.75) * Math.sqrt(loose) * (0.8 + this.risk * 0.4), 0.05, 0.95);
        if (pct < push && c.canRaise) return shove();
        if (c.canCheck) return { type: 'check' };
        if (c.limpers === 0 && pos === 'SB' && pct < push * 1.3 && P.pfrRatio < 0.4) return { type: 'call' };
        return { type: 'fold' };
      }
      // facing a raise or a shove: call with a range sized to the price
      const theirs = raiser ? clamp(stat(raiser, 'pfr') * (POS_MULT[raiser.pos] || 1) * 1.3, 0.1, 0.6) : 0.25;
      const odds = c.callAmt / (c.pot + c.callAmt);
      let callPct = theirs * clamp(1.65 - 2.1 * odds, 0.2, 1.4) * Math.pow(loose, 0.35) * (0.85 + this.risk * 0.3);
      if (c.raiseCount >= 2) callPct *= 0.6;
      if (pct < callPct * 0.5 && c.canRaise) return shove();
      if (pct < callPct || (c.callAmt <= bb * 0.5 && pct < 0.6)) return c.callAmt >= c.stack * 0.5 && c.canRaise ? shove() : { type: 'call' };
      return { type: 'fold' };
    }

    /* nobody has raised */
    if (c.raiseCount === 0) {
      const open = clamp((OPEN[pos] ?? 0.25) * loose * (c.opponents <= 1 ? 1.6 : 1), 0.04, 0.92);
      const openTo = () => {
        let x = bb * (c.effStack / bb < 30 ? 2.1 : pos === 'SB' ? 3 : 2.3 + P.agg * 0.4) + c.limpers * bb;
        if (this.key === 'tourist') x = bb * (2 + Math.floor(Math.random() * 3)) + c.limpers * bb;
        if (Math.random() < P.shove * (1 + t) * 0.2 && pct < 0.05) x = c.maxTo;
        return x;
      };
      if (c.canCheck) { // big blind after limps
        const iso = clamp(0.1 * loose * (0.5 + this.agg), 0.03, 0.35);
        if (pct < iso && c.canRaise) return raise(bb * (3.5 + c.limpers));
        return { type: 'check' };
      }
      if (c.limpers > 0) {
        const iso = open * clamp(0.45 + this.agg * 0.35, 0.3, 0.8);
        if (pct < iso && c.canRaise) return raise(openTo() + bb);
        if (pct < open * 1.15 && (P.pfrRatio < 0.5 || pct < open * 0.9)) return { type: 'call' };
        return { type: 'fold' };
      }
      if (pct < open) {
        const trapLimp = pct < 0.03 && Math.random() < P.trap * 0.25;
        if (!trapLimp && (pct < 0.06 || Math.random() < P.pfrRatio)) return raise(openTo());
        return { type: 'call' }; // limp or complete
      }
      if (pos === 'SB' && pct < open * 1.25 && P.pfrRatio < 0.5) return { type: 'call' };
      if (Math.random() < P.bluff * 0.12 && (pos === 'BTN' || pos === 'CO')) return raise(openTo()); // a steal with trash
      return { type: 'fold' };
    }

    /* facing one raise */
    if (c.raiseCount === 1) {
      const theirOpen = raiser ? clamp(stat(raiser, 'pfr') * (POS_MULT[raiser.pos] || 1), 0.05, 0.7) : OPEN.CO;
      const sizeBB = c.currentBet / bb;
      const callers = c.actions.filter(a => a.street === 'preflop' && a.type === 'call' && a.seat !== c.seat).length;
      const ip = pos === 'BTN' || (pos === 'CO' && raiser && raiser.pos !== 'BTN');
      let tb = clamp(theirOpen * 0.2 * P.threeBet * (1 + t) * (callers ? 1.25 : 1), 0.02, 0.16);
      const price = c.callAmt / (c.pot + c.callAmt);
      let callPct = theirOpen * 0.95 * Math.pow(loose, 0.75) * clamp(2.8 / sizeBB, 0.35, 1.3) * (ip ? 1.15 : pos === 'SB' ? 0.7 : 1);
      if (pos === 'BB') callPct *= clamp(1.2 + (0.33 - price) * 2.5, 1, 2.1);
      callPct += P.sticky * 0.15;
      if (effBB < 35) callPct *= 0.75; // no implied odds
      callPct = clamp(callPct, tb, 0.8);
      const threeTo = () => c.currentBet * (ip ? 3 : 3.8) + callers * c.currentBet;
      if (pct < tb && c.canRaise) {
        if (pct < 0.02 && Math.random() < P.trap * 0.3) return { type: 'call' }; // flat a monster
        return raise(threeTo());
      }
      if (pct < callPct) return { type: 'call' };
      // light 3-bets from just outside the calling range
      if (c.canRaise && pct < callPct + 0.1 && Math.random() < P.bluff * this.agg * 0.9) { this.bluffing = true; return raise(threeTo()); }
      return { type: 'fold' };
    }

    /* facing a 3-bet */
    if (c.raiseCount === 2) {
      const tbr = raiser ? stat(raiser, 'threeBet') : PRIOR.threeBet;
      const fourPct = clamp(0.022 + (tbr - 0.07) * 0.35, 0.015, 0.06) * Math.pow(loose, 0.3);
      let callPct = clamp(0.075 * Math.pow(loose, 0.55) + (tbr - 0.07) * 0.6 + P.sticky * 0.05, 0.03, 0.25);
      if (effBB < 60) callPct *= 0.8;
      if (pct < fourPct && c.canRaise) return raise(c.currentBet * 2.3);
      if (pct < callPct) return c.callAmt > c.stack * 0.35 && c.canRaise ? shove() : { type: 'call' };
      if (c.canRaise && pct < 0.2 && Math.random() < P.bluff * this.agg * 0.25) { this.bluffing = true; return raise(c.currentBet * 2.3); }
      return { type: 'fold' };
    }

    /* facing a 4-bet or more */
    const deep = clamp(0.02 * Math.pow(loose, 0.5) + this.risk * 0.012, 0.012, 0.07);
    if (pct < deep * 0.6 && c.canRaise) return shove();
    if (pct < deep || (c.callAmt < c.pot * 0.3 && pct < deep * 2)) return { type: 'call' };
    return { type: 'fold' };
  }

  /* ── postflop ── */
  postflop(c) {
    const P = this.p, t = this.tilt, n = Math.max(1, c.opponents);
    const hero = madeClass(c.hole[0], c.hole[1], c.board);
    const iters = Math.round((n > 2 ? 260 : 360) * (0.6 + this.skill * 0.4));
    let eq = rangeEquity(c, this.use, iters);
    eq = clamp(eq + gauss() * 0.03 * this.fuzz + t * 0.04, 0, 1);
    const tex = texture(c.board);
    const ip = c.position >= 0.999;
    const river = c.street === 'river';
    const aggressor = c.pfAggressor === c.seat;

    // what the table's reads say about the players still in
    const avg = k => {
      let s = 0;
      for (const v of c.villains) s += v.stats ? PRIOR[k] + this.use * trust(v.stats) * (v.stats[k] - PRIOR[k]) : PRIOR[k];
      return c.villains.length ? s / c.villains.length : PRIOR[k];
    };
    const ftc = clamp(avg('foldToCbet'), 0.1, 0.9);
    const stationy = clamp((avg('wtsd') - 0.3) * 3 + (avg('vpip') - 0.3) * 1.5, 0, 1) * this.use;
    const foldy = clamp((ftc - 0.45) * 1.6 - stationy * 0.6, -0.5, 0.6);

    const valueT = (n === 1 ? 0.6 : n === 2 ? 0.48 : 0.4) - stationy * 0.07 + (P.risk < 0.3 ? 0.03 : 0);
    const monster = eq > 0.85 || (hero.cls === 4 && eq > 0.72);
    const drawy = hero.outs >= 8 && !river;
    // value bets grow against people who call too much; bluffs stay the size they are
    const bet = (frac, bluff = false) => {
      if (bluff) this.bluffing = true;
      return { type: 'raise', to: this.betFrac(c, bluff ? frac : frac * (1 + stationy * 0.45)) };
    };
    const wetSize = tex.wet > 0.45 ? 0.72 : 0.5;
    const myStreetActs = c.actions.filter(a => a.seat === c.seat && a.street === c.street);
    const firedBefore = (st) => c.actions.some(a => a.seat === c.seat && a.street === st && (a.type === 'bet' || a.type === 'raise'));

    /* nobody has bet yet */
    if (c.canCheck) {
      if (!c.canRaise) return { type: 'check' };
      if (monster) {
        const trap = P.trap * (river ? 0.25 : 1) * (tex.wet > 0.45 ? 0.5 : 1.2) * (ip ? 0.5 : 1) * (1 - stationy * 0.7);
        if (Math.random() < trap) { this.trapStreet = c.street; return { type: 'check' }; }
        return bet(river ? 0.75 + P.agg * 0.2 : wetSize + 0.1);
      }
      if (eq >= valueT && Math.random() < 0.5 + this.agg * 0.45) return bet(eq > valueT + 0.15 ? wetSize + 0.1 : wetSize - 0.1);
      // continuation bet as the preflop raiser
      if (aggressor && c.street === 'flop' && myStreetActs.length === 0) {
        const f = P.cbet * (n === 1 ? 1 : n === 2 ? 0.6 : 0.3) * (tex.wet > 0.45 ? 0.8 : 1.15) + foldy * 0.35 * this.use;
        if (Math.random() < clamp(f, 0.05, 0.95)) return bet(tex.wet > 0.45 ? 0.6 : 0.35, eq < 0.4);
      }
      // second barrel
      if (aggressor && c.street === 'turn' && firedBefore('flop') && n === 1) {
        if ((drawy || eq > 0.45) && Math.random() < this.agg * 0.7) return bet(0.62, eq < 0.4);
        if (eq < 0.3 && Math.random() < P.bluff * (1 + foldy) * 0.7) return bet(0.6, true);
      }
      if (drawy && Math.random() < this.agg * 0.55) return bet(wetSize, true);
      // lead into the raiser
      if (!aggressor && !ip && c.pfAggressor >= 0 && eq > 0.35 && Math.random() < P.donk * 0.6) return bet(0.3 + Math.random() * 0.5);
      // thin value against people who call too much
      if (eq > valueT - 0.14 * stationy && stationy > 0.25 && Math.random() < 0.45 + stationy * 0.4) return bet(0.5);
      // river bluffs, mostly heads up
      if (river && eq < 0.22 && n === 1) {
        const f = P.bluff * (0.7 + foldy) * (ip ? 1.2 : 0.8) * (1 - stationy * 0.8) * (this.bluffing ? 1.4 : 1);
        if (Math.random() < clamp(f, 0, 0.55)) return bet(0.65 + Math.random() * 0.3, true);
      }
      if (!river && eq < 0.3 && n === 1 && Math.random() < P.bluff * 0.35 * (1 + foldy)) return bet(0.5, true);
      return { type: 'check' };
    }

    /* facing a bet */
    const odds = c.callAmt / (c.pot + c.callAmt);
    const allInCall = c.callAmt >= c.stack;
    const spr = c.stack / Math.max(1, c.pot);
    let need = odds + 0.02 - P.sticky * 0.12 - (this.risk - 0.5) * 0.06 - t * 0.05;
    if (drawy && !allInCall && spr > 2) need -= Math.min(0.08, 0.02 * spr);
    if (spr < 1.2 && c.total > c.stack) need -= 0.05; // pot committed
    if (P.risk < 0.3) need += 0.03;
    const raiseT = n === 1 ? 0.72 : 0.62;

    if (c.canRaise && !allInCall) {
      if (this.trapStreet === c.street && eq > 0.7 && Math.random() < 0.85) return bet(0.9); // the check-raise
      if (eq >= raiseT) {
        const slow = monster && !river && tex.wet < 0.45 && Math.random() < P.trap * 0.45;
        if (!slow && Math.random() < this.agg * 0.75 + 0.15) return bet(0.75 + (eq > 0.85 ? 0.2 : 0));
        if (slow) return { type: 'call' };
      }
      if (drawy && n === 1 && hero.outs >= 12 && Math.random() < this.agg * 0.45 * (1 + foldy)) return bet(0.8, true);
      if (drawy && n === 1 && Math.random() < this.agg * 0.2 * (1 + foldy)) return bet(0.8, true);
      if (!river && eq < 0.25 && n === 1 && c.raiseCount <= 1 && Math.random() < P.bluff * 0.1 * (1 + foldy)) return bet(0.8, true);
    }
    if (eq >= need) return { type: 'call' };
    // casual bots make the occasional curious call
    if (!allInCall && Math.random() < (1 - this.skill) * 0.06 + P.sticky * 0.06 && odds < 0.35) return { type: 'call' };
    return { type: 'fold' };
  }
}

export { PCT, classOf, madeClass, rangeEquity };
