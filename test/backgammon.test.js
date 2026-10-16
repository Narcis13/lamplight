/* Backgammon rules and the bot. */
import { test, expect } from 'bun:test';
import {
  WHITE, BLACK, BAR, OFF, initialPosition, pipCount, singleMoves, applyMove, Turn, winnerOf, winKind, inContact,
  countOn, indexOf, notation, clonePos,
} from '../shared/backgammon.js';
import { BgBot, evaluate } from '../server/bgbot.js';

/** Builds a position from { seat: { point: count } } in each player's own numbering. */
function build(spec, { bar = [0, 0], off = null } = {}) {
  const pts = Array(24).fill(0);
  let on = [0, 0];
  for (const seat of [WHITE, BLACK]) {
    for (const [n, k] of Object.entries(spec[seat] || {})) {
      pts[indexOf(seat, +n)] += seat === WHITE ? k : -k;
      on[seat] += k;
    }
  }
  const o = off || [15 - on[0] - bar[0], 15 - on[1] - bar[1]];
  return { pts, bar: bar.slice(), off: o };
}
const total = (pos, s) => pos.bar[s] + pos.off[s] + pos.pts.reduce((a, v) => a + (s === WHITE ? Math.max(0, v) : Math.max(0, -v)), 0);

test('the starting position', () => {
  const p = initialPosition();
  expect(pipCount(p, WHITE)).toBe(167);
  expect(pipCount(p, BLACK)).toBe(167);
  expect(total(p, WHITE)).toBe(15);
  expect(total(p, BLACK)).toBe(15);
  expect(countOn(p, WHITE, indexOf(WHITE, 24))).toBe(2);
  expect(countOn(p, BLACK, indexOf(BLACK, 6))).toBe(5);
  expect(inContact(p)).toBe(true);
});

test('opening 3-1 can make the five point, in one step per die', () => {
  const t = new Turn(initialPosition(), WHITE, [3, 1]);
  expect(t.required).toBe(2);
  expect(t.play(indexOf(WHITE, 8), indexOf(WHITE, 5))).not.toBeNull();
  expect(t.play(indexOf(WHITE, 6), indexOf(WHITE, 5))).not.toBeNull();
  expect(t.done).toBe(true);
  expect(countOn(t.pos, WHITE, indexOf(WHITE, 5))).toBe(2);
  expect(notation(WHITE, t.moves)).toBe('8/5 6/5');
});

test('a checker can move the whole roll at once, and undo puts it back', () => {
  const t = new Turn(initialPosition(), BLACK, [6, 5]);
  const path = t.play(indexOf(BLACK, 24), indexOf(BLACK, 13)); // lover's leap
  expect(path.length).toBe(2);
  expect(countOn(t.pos, BLACK, indexOf(BLACK, 13))).toBe(6);
  t.undo();
  expect(t.moves.length).toBe(1);
  t.undo();
  expect(t.moves.length).toBe(0);
  expect(t.pos).toEqual(initialPosition());
});

test('a checker on the bar must come in first, and a closed point keeps it out', () => {
  // black holds its 1..5 points, which are white's 24..20: only a 6 (white's 19) comes in
  const p = build({ [WHITE]: { 6: 2, 8: 2, 13: 10 }, [BLACK]: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 13: 4 } }, { bar: [1, 0] });
  expect(singleMoves(p, WHITE, 3)).toEqual([]);
  const t = new Turn(p, WHITE, [3, 6]);
  const legal = t.legal();
  expect(legal.length).toBe(1);
  expect(legal[0]).toMatchObject({ from: BAR, to: indexOf(WHITE, 19), die: 6 });
  t.apply(legal[0]);
  expect(t.legal().length).toBeGreaterThan(0);
});

test('closed out: no legal moves at all', () => {
  const p = build({ [WHITE]: { 6: 5, 8: 4 }, [BLACK]: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 13: 3 } }, { bar: [1, 0] });
  const t = new Turn(p, WHITE, [4, 2]);
  expect(t.required).toBe(0);
  expect(t.legal()).toEqual([]);
  expect(t.done).toBe(true);
});

test('hitting a blot sends it to the bar', () => {
  const p = build({ [WHITE]: { 13: 15 }, [BLACK]: { 15: 1, 1: 14 } }); // black's 15 is white's 10
  const t = new Turn(p, WHITE, [3, 1]);
  const steps = t.play(indexOf(WHITE, 13), indexOf(WHITE, 10));
  expect(steps.length).toBe(1);
  expect(steps[0].hit).toBe(true);
  expect(t.pos.bar[BLACK]).toBe(1);
  expect(total(t.pos, BLACK)).toBe(15);
});

test('both dice must be played when they can be', () => {
  const p = build({ [WHITE]: { 24: 1 }, [BLACK]: { 24: 2 } });
  const t = new Turn(p, WHITE, [6, 5]);
  expect(t.required).toBe(2);
  expect(t.legal().map(m => m.die).sort()).toEqual([5, 6]);
  // block white's 13 (black's 12): 24/18/13 and 24/19/13 both end there, so only one die plays, and it must be the 6
  const q = build({ [WHITE]: { 24: 1 }, [BLACK]: { 12: 2 } });
  const u = new Turn(q, WHITE, [6, 5]);
  expect(u.required).toBe(1);
  expect(u.mustDie).toBe(6);
  expect(u.legal()).toEqual([{ from: indexOf(WHITE, 24), to: indexOf(WHITE, 18), die: 6, hit: false }]);
});

test('when only one die can be played it must be the larger, unless only the smaller plays', () => {
  // one white checker on 13: 13-6 = 7 and 13-4 = 9 are open, 7-4 = 3 and 9-6 = 3 are blocked (black's 22)
  const p = build({ [WHITE]: { 13: 1 }, [BLACK]: { 22: 2 } });
  const t = new Turn(p, WHITE, [4, 6]);
  expect(t.required).toBe(1);
  expect(t.mustDie).toBe(6);
  expect(t.legal()).toEqual([{ from: indexOf(WHITE, 13), to: indexOf(WHITE, 7), die: 6, hit: false }]);
  // also block white's 7 (black's 18): the 6 can't be played at all, so the 4 is forced
  const q = build({ [WHITE]: { 13: 1 }, [BLACK]: { 22: 2, 18: 2 } });
  const u = new Turn(q, WHITE, [4, 6]);
  expect(u.required).toBe(1);
  expect(u.mustDie).toBe(4);
  expect(u.legal()).toEqual([{ from: indexOf(WHITE, 13), to: indexOf(WHITE, 9), die: 4, hit: false }]);
});

test('bearing off: exact, from the highest point with a bigger die, and never from outside', () => {
  const p = build({ [WHITE]: { 2: 2, 4: 1 }, [BLACK]: { 1: 15 } }, { off: [12, 0] });
  const six = singleMoves(p, WHITE, 6);
  expect(six.map(m => [m.from, m.to])).toEqual([[indexOf(WHITE, 4), OFF]]); // only the highest
  const two = singleMoves(p, WHITE, 2);
  expect(two.some(m => m.from === indexOf(WHITE, 2) && m.to === OFF)).toBe(true);
  expect(two.some(m => m.from === indexOf(WHITE, 4) && m.to === indexOf(WHITE, 2))).toBe(true);
  const q = build({ [WHITE]: { 2: 2, 7: 1 }, [BLACK]: { 1: 15 } }, { off: [12, 0] });
  expect(singleMoves(q, WHITE, 2).some(m => m.to === OFF)).toBe(false);
  // doubles bear off up to four
  const r = build({ [WHITE]: { 1: 4 }, [BLACK]: { 1: 15 } }, { off: [11, 0] });
  const t = new Turn(r, WHITE, [5, 5]);
  expect(t.required).toBe(4);
  for (let i = 0; i < 4; i++) t.play(indexOf(WHITE, 1), OFF);
  expect(winnerOf(t.pos)).toBe(WHITE);
});

test('single, gammon and backgammon', () => {
  const won = { [WHITE]: {}, [BLACK]: {} };
  expect(winKind(build({ ...won, [BLACK]: { 5: 14 } }, { off: [15, 1] }), WHITE)).toBe(1);
  expect(winKind(build({ ...won, [BLACK]: { 10: 15 } }, { off: [15, 0] }), WHITE)).toBe(2);
  // a black checker still in white's home board (white's 3 = black's 22)
  expect(winKind(build({ ...won, [BLACK]: { 10: 14, 22: 1 } }, { off: [15, 0] }), WHITE)).toBe(3);
  expect(winKind(build({ ...won, [BLACK]: { 10: 14 } }, { off: [15, 0], bar: [0, 1] }), WHITE)).toBe(3);
});

test('a turn rebuilt from what the server sends agrees with the original', () => {
  const t = new Turn(initialPosition(), WHITE, [4, 4]);
  t.play(indexOf(WHITE, 13), indexOf(WHITE, 9));
  const r = Turn.restore({ pos: t.pos, seat: WHITE, ...t.toJSON() });
  expect(r.legal()).toEqual(t.legal());
  expect(r.left).toBe(3);
  expect([...r.destinations(indexOf(WHITE, 13)).keys()]).toContain(indexOf(WHITE, 5)); // white's 1 is held by black's back checkers
});

test('doubles from the start: hundreds of endings, all distinct and all fully played', () => {
  const t = new Turn(initialPosition(), WHITE, [2, 2]);
  const ends = t.endings();
  expect(ends.length).toBeGreaterThan(10);
  const keys = new Set(ends.map(e => JSON.stringify(e.pos)));
  expect(keys.size).toBe(ends.length);
  for (const e of ends) expect(e.moves.length).toBe(4);
});

function playOut(botW, botB, maxTurns = 600) {
  let pos = initialPosition(), seat = WHITE, turns = 0;
  const roll = () => 1 + Math.floor(Math.random() * 6);
  while (winnerOf(pos) < 0 && turns++ < maxTurns) {
    const dice = [roll(), roll()];
    const bot = seat === WHITE ? botW : botB;
    const moves = bot.choose(pos, seat, dice);
    // every move the bot picks is legal, one step at a time
    const t = new Turn(pos, seat, dice);
    for (const m of moves) {
      const ok = t.legal().find(x => x.from === m.from && x.to === m.to && x.die === m.die);
      if (!ok) throw new Error(`illegal bot move ${JSON.stringify(m)} with ${dice}`);
      t.apply(ok);
    }
    expect(t.done).toBe(true);
    pos = t.pos;
    expect(total(pos, WHITE)).toBe(15);
    expect(total(pos, BLACK)).toBe(15);
    seat = 1 - seat;
  }
  return { winner: winnerOf(pos), turns, pos };
}

test('bots play whole games legally, at every skill', () => {
  const t0 = Date.now();
  for (let g = 0; g < 20; g++) {
    const skills = ['casual', 'regular', 'sharp'];
    const r = playOut(new BgBot(skills[g % 3]), new BgBot(skills[(g + 1) % 3]));
    expect(r.winner).toBeGreaterThanOrEqual(0);
  }
  expect(Date.now() - t0).toBeLessThan(60_000);
}, 90_000);

test('the bot crushes a player who moves at random', () => {
  // a player who picks any legal ending, with no idea what is good
  const random = { choose(pos, seat, dice) { const e = new Turn(pos, seat, dice).endings(); return e[Math.floor(Math.random() * e.length)].moves; } };
  const bot = new BgBot('regular');
  let wins = 0;
  for (let g = 0; g < 20; g++) {
    const botWhite = g % 2 === 0;
    const r = playOut(botWhite ? bot : random, botWhite ? random : bot);
    if ((r.winner === WHITE) === botWhite) wins++;
  }
  expect(wins).toBeGreaterThanOrEqual(17);
}, 90_000);

test('the bot hits and makes points when it can', () => {
  const bot = new BgBot('sharp');
  // 3-1 from the start: make the 5 point
  const m = bot.choose(initialPosition(), WHITE, [3, 1]);
  const t = new Turn(initialPosition(), WHITE, [3, 1]);
  for (const x of m) t.apply(x);
  expect(countOn(t.pos, WHITE, indexOf(WHITE, 5))).toBe(2);
  // a race: it just runs and bears off
  const race = build({ [WHITE]: { 6: 3, 5: 3, 4: 3 }, [BLACK]: { 6: 9 } }, { off: [6, 6] });
  expect(inContact(race)).toBe(false);
  const mv = bot.choose(race, WHITE, [6, 5]);
  expect(mv.filter(x => x.to === OFF).length).toBe(2);
  expect(evaluate(clonePos(race), WHITE)).toBeGreaterThan(-5);
  void applyMove;
});
