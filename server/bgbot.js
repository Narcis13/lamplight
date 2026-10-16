/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · backgammon bot
   Plays every distinct position a roll allows and keeps the one it
   likes best. "Likes" is a hand-tuned score: the race, made points and
   primes, the opponent's checkers on the bar, and how likely each of its
   blots is to be hit next roll (every one of the 36 rolls is checked).
   Once contact is broken it plays a pure race. Cube decisions come from
   the same score turned into a winning chance.

   Skill adds noise to the scores: casual bots blunder now and then,
   sharp ones never on purpose.
   ════════════════════════════════════════════════════════════════════ */
import { Turn, BAR, OFF, countOn, pointOf, indexOf, pipCount, inContact } from '../shared/backgammon.js';

// how much a made point is worth, by the bot's own point number (1..24)
const POINT_VALUE = [0, 0.02, 0.04, 0.07, 0.10, 0.13, 0.12, 0.10, 0.05, 0.03, 0.02, 0.01, 0, 0, 0, 0, 0, 0, 0.03, 0.04, 0.06, 0.07, 0.04, 0.02, 0.01];
const PRIME = [0, 0, 0, 0.03, 0.08, 0.16, 0.30];
const NOISE = { casual: 0.07, regular: 0.02, sharp: 0 };

/** The 21 distinct rolls, with how many of the 36 produce each. */
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);

const sigmoid = x => 1 / (1 + Math.exp(-x));

/** True if `opp` can hit index `target` from `src` (point number in opp's frame, 25 = bar) with this roll. */
function canHit(pos, opp, srcN, target, a, b) {
  const tN = pointOf(opp, target), dist = srcN - tN;
  if (dist <= 0) return false;
  const me = 1 - opp;
  const open = n => n >= 1 && countOn(pos, me, indexOf(opp, n)) < 2;
  if (a === b) {
    for (let k = 1; k <= 4; k++) {
      if (dist === a * k) {
        for (let j = 1; j < k; j++) if (!open(srcN - a * j)) return false;
        return true;
      }
    }
    return false;
  }
  if (dist === a || dist === b) return true;
  if (dist === a + b) return open(srcN - a) || open(srcN - b);
  return false;
}

/** Expected cost of being hit next roll: for each roll, the worst blot the opponent can reach. */
function shotCost(pos, me) {
  const opp = 1 - me;
  const blots = [];
  for (let i = 0; i < 24; i++) if (countOn(pos, me, i) === 1) blots.push(i);
  if (!blots.length) return 0;
  const sources = [];
  if (pos.bar[opp] > 0) sources.push(25);
  else for (let i = 0; i < 24; i++) if (countOn(pos, opp, i)) sources.push(pointOf(opp, i));
  // the opponent's home board makes every hit hurt more
  let oppHome = 0;
  for (let n = 1; n <= 6; n++) if (countOn(pos, opp, indexOf(opp, n)) >= 2) oppHome++;
  const sting = 1 + oppHome * 0.16;
  const cost = blots.map(i => {
    const n = pointOf(me, i);
    // a checker hit deep in the opponent's home loses little; one hit near home loses a lot of pips
    return n >= 19 ? 0.05 : 0.09 + ((25 - n) / 24) * 0.22;
  });
  let total = 0;
  for (const [a, b, w] of ROLLS) {
    let worst = 0;
    for (let k = 0; k < blots.length; k++) {
      if (cost[k] <= worst) continue;
      for (const s of sources) if (canHit(pos, opp, s, blots[k], a, b)) { worst = cost[k]; break; }
    }
    total += w * worst;
  }
  return (total / 36) * sting;
}

/** The race once nobody can hit anybody: pips, plus a little for a smooth, efficient bear-off. */
function raceScore(pos, me) {
  const opp = 1 - me;
  const mine = pipCount(pos, me), theirs = pipCount(pos, opp);
  let waste = 0;
  for (let n = 1; n <= 6; n++) {
    const c = countOn(pos, me, indexOf(me, n));
    if (c > 3) waste += (c - 3) * 0.6;
  }
  for (let n = 1; n <= 3; n++) if (!countOn(pos, me, indexOf(me, n))) waste += 0.25;
  // nothing comes off until everyone is home: bring the stragglers in first, and save the gammon
  for (let n = 7; n <= 24; n++) {
    const c = countOn(pos, me, indexOf(me, n));
    if (c) waste += c * (2 + (n - 6) * 0.35) * (pos.off[me] ? 1 : 2);
  }
  // every checker still on the board costs about a third of a roll; the opponent rolls next, about 8 pips of tempo
  return ((theirs - 8) - mine - waste) * 0.03 + pos.off[me] * 0.06;
}

/** How good this position is for `me`, with the opponent about to roll. Roughly an equity, -1..1. */
export function evaluate(pos, me) {
  if (pos.off[me] === 15) return 3;
  if (!inContact(pos)) return raceScore(pos, me);
  const opp = 1 - me;
  let s = (pipCount(pos, opp) - pipCount(pos, me) - 8) * 0.008;
  // how much of the opponent's army still has to come home: anchors and back checkers only pay while it does
  let outside = pos.bar[opp];
  for (let i = 0; i < 24; i++) if (countOn(pos, opp, i) && pointOf(opp, i) > 6) outside += countOn(pos, opp, i);
  const late = 1 - Math.min(1, outside / 6);
  // made points and the longest prime
  let run = 0, best = 0, bestEnd = 0, home = 0;
  for (let n = 1; n <= 24; n++) {
    const c = countOn(pos, me, indexOf(me, n));
    if (n >= 19 && c) s -= c * (0.012 + 0.07 * late); // stuck back there as they bear in: gammon and backgammon danger
    if (c >= 2) {
      s += POINT_VALUE[n] * (n >= 18 ? 1 - late : 1);
      if (n <= 6) home++;
      run++;
      if (run > best) { best = run; bestEnd = n; }
    } else run = 0;
    if (c > 3) s -= (c - 3) * 0.018;
  }
  if (best >= 3) {
    // a prime only matters if there is someone behind it
    const start = bestEnd - best + 1;
    let behind = 0;
    for (let i = 0; i < 24; i++) if (countOn(pos, opp, i) && pointOf(me, i) < start) behind += countOn(pos, opp, i);
    behind += pos.bar[opp];
    s += PRIME[Math.min(best, 6)] * (behind ? 1 : 0.25) * (start <= 8 ? 1 : 0.6);
  }
  // the opponent on the bar, worse for them the more of our home board is closed
  s += pos.bar[opp] * (0.14 + home * 0.05);
  s -= pos.bar[me] * 0.1;
  s -= shotCost(pos, me);
  s += pos.off[me] * 0.015;
  return s;
}

/** A winning chance for the player about to roll in this position. */
export function winChance(pos, me) {
  const opp = 1 - me;
  if (!inContact(pos)) {
    const a = pipCount(pos, me), b = pipCount(pos, opp);
    const lead = (b - a + 4) / Math.max(a, 1); // being on roll is worth about four pips
    return Math.min(0.99, Math.max(0.01, 0.5 + lead * 2.4));
  }
  // our score is measured as if the opponent rolls next; give back roughly the value of a roll
  return sigmoid((evaluate(pos, me) + 0.08) * 2.6);
}

export class BgBot {
  constructor(skill = 'regular') { this.noise = NOISE[skill] ?? NOISE.regular; }
  jitter() { return this.noise ? (Math.random() - 0.5) * 2 * this.noise : 0; }

  /** The moves for this roll: the ending it scores highest. */
  choose(pos, seat, dice) {
    const turn = new Turn(pos, seat, dice);
    const ends = turn.endings();
    if (!ends.length || !ends[0].moves.length) return [];
    let best = null, bestS = -Infinity;
    for (const e of ends) {
      const sc = evaluate(e.pos, seat) + this.jitter();
      if (sc > bestS) { bestS = sc; best = e; }
    }
    return best.moves;
  }

  /** Offer the cube? Only with a clear edge, and not when the cube is already big against a short stack. */
  wantsDouble(pos, seat, { cube = 1, matchAway = null } = {}) {
    if (matchAway != null && matchAway <= cube) return false; // the cube is dead for us: we already win the match with it
    const p = winChance(pos, seat) + this.jitter() * 0.5;
    if (!inContact(pos)) {
      const a = pipCount(pos, seat), b = pipCount(pos, 1 - seat);
      return (b - a) / Math.max(a, 1) >= 0.08 && p > 0.6;
    }
    return p >= 0.72 && p < 0.93; // past that, it plays on for a gammon
  }

  /** Take a double offered by the other side? */
  takes(pos, seat) {
    const theirs = winChance(pos, 1 - seat); // they are on roll
    if (!inContact(pos)) {
      const a = pipCount(pos, 1 - seat), b = pipCount(pos, seat);
      return (b - a) / Math.max(a, 1) <= 0.12;
    }
    return 1 - theirs + this.jitter() * 0.5 >= 0.25;
  }
}

export { BAR, OFF };
