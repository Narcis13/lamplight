/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel bot
   Tries every legal swap (and every booster target, and the hammer) on
   a copy of the board, with its own random refills, so it never sees
   what the server will actually drop in. Scores each by points, booster
   charge, the opponent's colour it takes away, extra moves and specials;
   a sharp bot also looks at the best reply it would leave the opponent
   when its turn is about to end.
   ════════════════════════════════════════════════════════════════════ */
import { Duel, validMoves, BOOSTERS, N } from '../shared/match3.js';

const rnd = n => Math.floor(Math.random() * n);
const SKILL = {
  casual: { slack: 6, wild: 0.18, look: false, perks: false, tries: 1 },
  regular: { slack: 1.5, wild: 0.03, look: false, perks: true, tries: 2 },
  sharp: { slack: 0, wild: 0, look: true, perks: true, tries: 3 },
};

/** What an action is worth to `seat`, judged from the event it produced on a copy. */
function worth(ev, seat, before) {
  let v = ev.pts, mine = 0, theirs = 0, made = 0;
  for (const w of ev.waves) {
    for (const x of w.removed) { if (x.c === seat) mine++; else if (x.c === 1 - seat) theirs++; }
    made += w.made.length;
  }
  const room = BOOSTERS[before.boosters[seat]].cost - before.charge[seat];
  v += 0.7 * Math.min(mine, Math.max(0, room)) + 0.4 * theirs + 0.8 * made;
  if (ev.extra) v += 6;
  if (ev.ready) v += 3;
  return v;
}

export class M3Bot {
  constructor(skill = 'regular') { this.skill = SKILL[skill] ? skill : 'regular'; this.k = SKILL[this.skill]; }

  /** The next thing to do on `seat`'s turn: { t: 'swap', a, b } | { t: 'boost', target } | { t: 'perk', kind, target }. */
  choose(duel, seat) {
    const s = duel.toJSON ? duel.toJSON() : duel;
    const boost = this.boostPlan(s, seat);
    if (boost) return boost;
    const moves = this.rank(s, seat);
    // perks are free: a bot that uses them saves both for the last move of the match
    if (this.k.perks && s.round === s.rounds && s.moves === 1) {
      const hammer = this.hammerPlan(s, seat);
      if (hammer) return { t: 'perk', kind: 'hammer', target: hammer.target };
      if (s.perks[seat].shuffle && (!moves.length || moves[0].v < 4)) return { t: 'perk', kind: 'shuffle' };
    }
    if (!moves.length) return null;
    if (Math.random() < this.k.wild) { const m = moves[rnd(moves.length)]; return { t: 'swap', a: m.a, b: m.b }; }
    const good = moves.filter(m => m.v >= moves[0].v - this.k.slack);
    const m = good[rnd(good.length)];
    return { t: 'swap', a: m.a, b: m.b };
  }

  /** Average worth of each legal swap over a few simulated refills, best first. */
  rank(s, seat) {
    const out = [];
    for (const [x, y] of validMoves(s.board)) {
      for (const [a, b] of [[x, y], [y, x]]) {
        let v = 0;
        for (let t = 0; t < this.k.tries; t++) {
          const d = Duel.restore(s, rnd), ev = d.swap(seat, a, b);
          if (!ev) { v = -Infinity; break; }
          v += worth(ev, seat, s);
          if (this.k.look && !ev.extra && s.moves === 1 && !d.over) v -= 0.6 * this.bestReply(d, 1 - seat);
        }
        if (v > -Infinity) out.push({ a, b, v: v / this.k.tries });
      }
    }
    return out.sort((p, q) => q.v - p.v);
  }
  /** How good a board is for the other player's first move. */
  bestReply(d, seat) {
    const s = d.toJSON();
    let best = 0;
    for (const [a, b] of validMoves(s.board)) {
      const ev = Duel.restore(s, rnd).swap(seat, a, b);
      if (ev) best = Math.max(best, worth(ev, seat, s));
    }
    return best;
  }

  /** Use a charged booster right away (on the best target, if it needs one). A casual bot sometimes forgets. */
  boostPlan(s, seat) {
    if (s.charge[seat] < BOOSTERS[s.boosters[seat]].cost || s.moves <= 0) return null;
    if (this.skill === 'casual' && Math.random() < 0.3) return null;
    if (!BOOSTERS[s.boosters[seat]].target) return { t: 'boost', target: null };
    let best = null;
    for (let i = 0; i < N; i++) {
      const d = Duel.restore(s, rnd), ev = d.boost(seat, i);
      if (!ev) continue;
      const v = worth(ev, seat, { ...s, charge: [0, 0] });
      if (!best || v > best.v) best = { v, target: i };
    }
    return best ? { t: 'boost', target: best.target } : null;
  }
  /** The hammer, kept for the very last move: the piece whose removal does the most. */
  hammerPlan(s, seat) {
    if (!s.perks[seat].hammer) return null;
    let best = null;
    for (let i = 0; i < N; i++) {
      const ev = Duel.restore(s, rnd).perk(seat, 'hammer', i);
      if (!ev) continue;
      const v = worth(ev, seat, s);
      if (!best || v > best.v) best = { v, target: i };
    }
    return best;
  }
}
