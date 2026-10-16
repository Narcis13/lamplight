/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · backgammon rules
   Pure logic for both sides: the server plays by it, the browser uses it
   to show which checkers can move and where.

   A position is { pts, bar, off }:
   - pts[0..23]: positive counts are white's checkers, negative black's.
   - White (seat 0) travels from index 23 down to 0 and bears off below 0;
     its home board is indexes 0..5. Black (seat 1) runs the other way,
     from 0 up to 23, home board 18..23.
   - bar[seat] and off[seat] count checkers on the bar and borne off.
   Each player numbers the points from their own side: point n is index
   n - 1 for white and 24 - n for black, so everyone's home is 1 to 6
   and the bar counts as point 25.

   A single move is { from, to, die, hit }: from is an index or 'bar',
   to is an index or 'off'.
   ════════════════════════════════════════════════════════════════════ */
export const WHITE = 0, BLACK = 1;
export const CHECKERS = 15;
export const BAR = 'bar', OFF = 'off';

/** Money games, matches, speeds. Shared so the lobby can show the same numbers the server uses. */
export const BG = {
  stakes: [10, 50, 250, 1000], // money game: dollars a point
  buyInPoints: 40, // money game: you sit down with this many points' worth of chips
  entries: [100, 500, 2500], // match: each player's entry, winner takes both
  lengths: [1, 3, 5, 7], // match length in points
  maxCube: 64,
  speeds: {
    relaxed: { clock: 75_000, label: 'Relaxed' },
    normal: { clock: 45_000, label: 'Normal' },
    turbo: { clock: 25_000, label: 'Turbo' },
    test: { clock: 1_500, label: 'Test' },
  },
};

export function initialPosition() {
  const pts = Array(24).fill(0);
  const put = (n, k) => { pts[n - 1] += k; pts[24 - n] -= k; };
  put(24, 2); put(13, 5); put(8, 3); put(6, 5);
  return { pts, bar: [0, 0], off: [0, 0] };
}

export const clonePos = p => ({ pts: p.pts.slice(), bar: p.bar.slice(), off: p.off.slice() });
export const posKey = p => `${p.pts.join(',')}|${p.bar[0]},${p.bar[1]}|${p.off[0]},${p.off[1]}`;

/** How many of `seat`'s checkers sit on index i. */
export const countOn = (pos, seat, i) => (seat === WHITE ? Math.max(0, pos.pts[i]) : Math.max(0, -pos.pts[i]));
/** The point number index i has for `seat` (1 is the last point before bearing off). */
export const pointOf = (seat, i) => (seat === WHITE ? i + 1 : 24 - i);
/** The index of `seat`'s point n. */
export const indexOf = (seat, n) => (seat === WHITE ? n - 1 : 24 - n);

export function pipCount(pos, seat) {
  let s = pos.bar[seat] * 25;
  for (let i = 0; i < 24; i++) s += countOn(pos, seat, i) * pointOf(seat, i);
  return s;
}

/** Everyone home and nobody on the bar: bearing off is allowed. */
export function allHome(pos, seat) {
  if (pos.bar[seat]) return false;
  for (let i = 0; i < 24; i++) if (countOn(pos, seat, i) && pointOf(seat, i) > 6) return false;
  return true;
}

function highestPoint(pos, seat) {
  for (let n = 24; n >= 1; n--) if (countOn(pos, seat, indexOf(seat, n))) return n;
  return 0;
}

/** Every legal way to play one die, ignoring what the rest of the roll requires. */
export function singleMoves(pos, seat, d) {
  const out = [], opp = 1 - seat;
  if (pos.bar[seat] > 0) {
    const to = indexOf(seat, 25 - d);
    const o = countOn(pos, opp, to);
    if (o < 2) out.push({ from: BAR, to, die: d, hit: o === 1 });
    return out;
  }
  const home = allHome(pos, seat);
  const hi = home ? highestPoint(pos, seat) : 0;
  for (let i = 0; i < 24; i++) {
    if (!countOn(pos, seat, i)) continue;
    const n = pointOf(seat, i), m = n - d;
    if (m >= 1) {
      const to = indexOf(seat, m), o = countOn(pos, opp, to);
      if (o < 2) out.push({ from: i, to, die: d, hit: o === 1 });
    } else if (home && (m === 0 || n === hi)) out.push({ from: i, to: OFF, die: d, hit: false });
  }
  return out;
}

export function applyMove(pos, seat, m) {
  const q = clonePos(pos), s = seat === WHITE ? 1 : -1;
  if (m.from === BAR) q.bar[seat]--; else q.pts[m.from] -= s;
  if (m.to === OFF) q.off[seat]++;
  else {
    if (countOn(q, 1 - seat, m.to) === 1) { q.pts[m.to] = 0; q.bar[1 - seat]++; }
    q.pts[m.to] += s;
  }
  return q;
}

export const diceToPlay = (d1, d2) => (d1 === d2 ? [d1, d1, d1, d1] : [Math.max(d1, d2), Math.min(d1, d2)]);
const without = (dice, d) => { const i = dice.indexOf(d), r = dice.slice(); if (i >= 0) r.splice(i, 1); return r; };

/** The most dice that can be played from here. Memoised: the same position comes up through many move orders. */
function maxDepth(pos, seat, dice, memo) {
  if (!dice.length) return 0;
  const key = `${posKey(pos)}#${dice.join('')}`;
  const hit = memo.get(key);
  if (hit != null) return hit;
  let best = 0;
  outer: for (const d of new Set(dice)) {
    for (const m of singleMoves(pos, seat, d)) {
      const r = 1 + maxDepth(applyMove(pos, seat, m), seat, without(dice, d), memo);
      if (r > best) { best = r; if (best === dice.length) break outer; }
    }
  }
  memo.set(key, best);
  return best;
}

export function winnerOf(pos) {
  if (pos.off[WHITE] === CHECKERS) return WHITE;
  if (pos.off[BLACK] === CHECKERS) return BLACK;
  return -1;
}

/**
 * What a win is worth if the game ended now with `winner` ahead: 1 for a single game, 2 for a gammon
 * (the loser has borne nothing off), 3 for a backgammon (and still has a checker on the bar or in the winner's home board).
 */
export function winKind(pos, winner) {
  const loser = 1 - winner;
  if (pos.off[loser] > 0) return 1;
  if (pos.bar[loser] > 0) return 3;
  for (let i = 0; i < 24; i++) if (countOn(pos, loser, i) && pointOf(winner, i) <= 6) return 3;
  return 2;
}
export const KIND_NAME = { 1: 'single', 2: 'gammon', 3: 'backgammon' };

/** True while the two sides can still hit each other. */
export function inContact(pos) {
  let maxW = pos.bar[WHITE] ? 24 : -1, minB = pos.bar[BLACK] ? -1 : 24;
  for (let i = 0; i < 24; i++) {
    if (pos.pts[i] > 0) maxW = Math.max(maxW, i);
    if (pos.pts[i] < 0) minB = Math.min(minB, i);
  }
  return maxW > minB;
}

/**
 * One player's turn: the roll, the moves made so far and what the rules still demand.
 * Players must use as many dice as they can; if only one die can be played, the larger one when possible.
 */
export class Turn {
  constructor(pos, seat, dice, { memo } = {}) {
    this.seat = seat;
    this.dice = [dice[0], dice[1]];
    this.start = clonePos(pos);
    this.pos = clonePos(pos);
    this.all = diceToPlay(dice[0], dice[1]);
    this.remaining = this.all.slice();
    this.moves = [];
    this.memo = memo || new Map();
    this.required = maxDepth(pos, seat, this.all, this.memo);
    this.mustDie = null;
    if (this.required === 1 && dice[0] !== dice[1]) {
      const hi = Math.max(dice[0], dice[1]);
      this.mustDie = singleMoves(pos, seat, hi).length ? hi : Math.min(dice[0], dice[1]);
    }
  }
  /** Rebuilds a turn from what the server sends, so the browser can show the legal moves. */
  static restore({ pos, seat, dice, remaining, required, mustDie, moves = [] }) {
    const t = Object.create(Turn.prototype);
    Object.assign(t, { seat, dice: dice.slice(), pos: clonePos(pos), start: null, all: diceToPlay(dice[0], dice[1]), remaining: remaining.slice(), moves: moves.slice(), required, mustDie: mustDie ?? null, memo: new Map() });
    return t;
  }
  fork() {
    const t = Object.create(Turn.prototype);
    Object.assign(t, this, { pos: clonePos(this.pos), remaining: this.remaining.slice(), moves: this.moves.slice() });
    return t;
  }
  get left() { return Math.max(0, this.required - this.moves.length); }
  get done() { return this.moves.length >= this.required; }

  /** The single moves allowed right now. */
  legal() {
    const left = this.left;
    if (!left) return [];
    const out = [];
    for (const d of new Set(this.remaining)) {
      if (this.mustDie && d !== this.mustDie) continue;
      for (const m of singleMoves(this.pos, this.seat, d)) {
        if (left === 1 || maxDepth(applyMove(this.pos, this.seat, m), this.seat, without(this.remaining, d), this.memo) >= left - 1) out.push(m);
      }
    }
    return out;
  }
  /** Where the checker on `from` can end up this turn, with the steps to get there. Map: to -> [moves]. */
  destinations(from) {
    const out = new Map();
    const pips = p => p.reduce((s, m) => s + m.die, 0);
    // prefer the fewest hits on the way (hitting is the player's call, one step at a time), then the fewest steps, then the smallest dice
    const better = (p, h, prev) => !prev || h < prev.h || (h === prev.h && (p.length < prev.path.length || (p.length === prev.path.length && pips(p) < pips(prev.path))));
    const walk = (t, at, path, midHits) => {
      for (const m of t.legal()) {
        if (m.from !== at) continue;
        const p = path.concat(m);
        if (better(p, midHits, out.get(m.to))) out.set(m.to, { path: p, h: midHits });
        if (m.to !== OFF) { const f = t.fork(); f.apply(m); walk(f, m.to, p, midHits + (m.hit ? 1 : 0)); }
      }
    };
    walk(this, from, [], 0);
    return new Map([...out].map(([k, v]) => [k, v.path]));
  }
  /** Moves the checker on `from` to `to`, in one or more steps. Returns the steps, or null if that isn't legal. */
  play(from, to) {
    const path = this.destinations(from).get(to);
    if (!path) return null;
    for (const m of path) this.apply(m);
    return path;
  }
  apply(m) {
    this.pos = applyMove(this.pos, this.seat, m);
    this.remaining = without(this.remaining, m.die);
    this.moves.push(m);
  }
  undo() {
    if (!this.moves.length || !this.start) return null;
    const last = this.moves[this.moves.length - 1];
    const keep = this.moves.slice(0, -1);
    this.pos = clonePos(this.start); this.remaining = this.all.slice(); this.moves = [];
    for (const m of keep) this.apply(m);
    return last;
  }
  /** Every distinct position this roll can produce, with one way of playing it. */
  endings() {
    const out = new Map(), seen = new Set();
    const walk = t => {
      const legal = t.legal();
      if (!legal.length) { const k = posKey(t.pos); if (!out.has(k)) out.set(k, { moves: t.moves.slice(), pos: t.pos }); return; }
      for (const m of legal) {
        const f = t.fork(); f.apply(m);
        const k = `${posKey(f.pos)}#${f.remaining.join('')}`;
        if (seen.has(k)) continue;
        seen.add(k);
        walk(f);
      }
    };
    walk(this);
    return [...out.values()];
  }
  /** What the browser needs to rebuild this turn. */
  toJSON() {
    return { dice: this.dice, remaining: this.remaining, required: this.required, mustDie: this.mustDie, moves: this.moves };
  }
}

/** Standard notation for a played roll, from the mover's side: "13/7 8/7*", "bar/22", "6/off". */
export function notation(seat, moves) {
  const at = x => (x === BAR ? 'bar' : x === OFF ? 'off' : String(pointOf(seat, x)));
  return moves.map(m => `${at(m.from)}/${at(m.to)}${m.hit ? '*' : ''}`).join(' ');
}
