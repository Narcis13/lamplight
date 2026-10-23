/* Gem duel rules: swaps, matches, cascades, specials and combos, scoring, boosters, perks, turns, the end. */
import { describe, test, expect } from 'bun:test';
import {
  W, H, N, M3, BOOSTERS, TIMING, Duel, seeded, newBoard, runsOf, groupsOf, specialOf, canSwap, validMoves, hasMove,
  adjacent, reshuffle, cloneBoard, animMs, waveMs, rowOf, colOf,
} from '../shared/match3.js';

/* ───────────── helpers ───────────── */
const at = (r, c) => r * W + c;
const idx = Array.from({ length: N }, (_, i) => i);
const row = r => idx.filter(i => rowOf(i) === r);
const col = c => idx.filter(i => colOf(i) === c);
const square = (r, c, k) => idx.filter(i => Math.abs(rowOf(i) - r) <= k && Math.abs(colOf(i) - c) <= k); // clipped at the edges
const uniq = list => [...new Set(list)].sort((a, b) => a - b);
const cellsOf = (...rcs) => uniq(rcs.map(([r, c]) => at(r, c)));
const rowsOf = (...rs) => uniq(rs.flatMap(row));
const colsOf = (...cs) => uniq(cs.flatMap(col));
const gone = w => uniq(w.removed.map(x => x.i)); // the cells a wave cleared
const total = ev => ev.waves.reduce((n, w) => n + w.removed.length, 0);
const own = (ev, seat) => ev.waves.reduce((n, w) => n + w.removed.filter(x => x.c === seat).length, 0);
const snap = cells => cells.map(p => p && [p.id, p.c, p.s]);
const byId = cells => Object.fromEntries(cells.map(p => [p.id, [p.c, p.s]]));
const wouldLine = (cells, a, b) => { const t = cells.slice(); [t[a], t[b]] = [t[b], t[a]]; return runsOf(t).length > 0; };

const KIND = { h: 'h', v: 'v', b: 'bomb', z: 'bolt' };
/* A board from { row: 'tokens' }: a colour digit plus a kind letter (h v arrows, b bomb, z bolt); '.' is filler. Filler is
   colours 2-5 and never lines up, so colours 0 and 1 sit exactly where a test puts them. Ids are index + 1. */
function build(rows) {
  const cells = Array(N).fill(null);
  for (let r = 0; r < H; r++) {
    const toks = (rows[r] || '').split(/\s+/).filter(Boolean);
    for (let c = 0; c < W; c++) if (toks[c] && toks[c] !== '.') cells[at(r, c)] = { id: at(r, c) + 1, c: +toks[c][0], s: KIND[toks[c][1]] || '' };
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 4 && !cells[i]; k++) {
      cells[i] = { id: i + 1, c: 2 + ((rowOf(i) * 3 + colOf(i) + k) % 4), s: '' };
      if (runsOf(cells).some(run => run.cells.includes(i))) cells[i] = null;
    }
    if (!cells[i]) throw new Error('no filler colour fits at ' + i);
  }
  return { cells, seq: N + 1 };
}
/** A duel on a built board (seat 0 first, seeded refills). A fixture that starts with a line is a typo. */
function game(rows, { seed = 1, ...opts } = {}) {
  const board = build(rows);
  if (runsOf(board.cells).length) throw new Error('fixture starts with a line');
  return new Duel({ board, rng: seeded(seed), first: 0, ...opts });
}
const armed = (rows, key, opts = {}) => { const d = game(rows, { boosters: [key, key], ...opts }); d.charge[0] = BOOSTERS[key].cost; return d; }; // seat 0's bar is full
const flip = rows => Object.fromEntries(Object.entries(rows).map(([r, s]) => [r, s.replace(/[01]/g, m => 1 - m)])); // colours 0 and 1 trade places
const settled = d => expect([d.cells.every(Boolean), new Set(d.cells.map(p => p.id)).size, runsOf(d.cells), hasMove(d.cells)]).toEqual([true, N, [], true]);
/** Applies an event to a copy of the board the way a browser would; it must come out as the real board. */
function replay(before, ev) {
  const g = before.map(p => p && { id: p.id, c: p.c, s: p.s });
  const place = sh => { // a shuffle: every piece to a new cell, some recoloured
    const by = new Map(g.map(p => [p.id, p]));
    g.fill(null);
    for (const [id, to] of sh.moves) g[to] = by.get(id);
    for (const [id, c] of sh.recolor) by.get(id).c = c;
  };
  if (ev.type === 'swap') [g[ev.a], g[ev.b]] = [g[ev.b], g[ev.a]];
  if (ev.shuffle) place(ev.shuffle);
  for (const w of ev.waves) {
    for (const [i, s] of w.conv) g[i].s = s;
    for (const x of w.removed) { if (g[x.i]?.id !== x.id) throw new Error('removed piece is not there'); g[x.i] = null; }
    for (const m of w.made) g[m.i] = { id: m.id, c: m.c, s: m.s };
    const lifted = w.fall.map(([id, to]) => { const i = g.findIndex(p => p?.id === id), p = g[i]; g[i] = null; return [p, to]; });
    for (const [p, to] of lifted) g[to] = p;
    for (const m of w.spawn) g[m.i] = { id: m.id, c: m.c, s: m.s };
  }
  for (const i of ev.fade || []) g[i].s = '';
  if (ev.reshuffle) place(ev.reshuffle);
  return snap(g);
}

/* Fixtures. Colours 0 and 1 are the pieces of interest; filler is 2-5. */
const LINE3 = { 3: '0 0 1', 4: '. . 0 0', 5: '. . 0' }; // drag the 0 at (4,2) up into (3,2): three zeros in row 3
const DRAG = [at(4, 2), at(3, 2)];
const CASCADE = { 3: '. . . 1', 4: '. . . 0', 5: '. . . 0', 6: '. . 0 2 1 1' }; // (6,2)->(6,3) clears col 3; the 1 above falls next to two more
const FALL = [at(6, 2), at(6, 3)];
const TWO3 = { 1: '. . . 0 1', 2: '. . . 0 1', 3: '. . . 1 0' }; // (3,3)<->(3,4) makes a column of three zeros and one of three ones
/** [name, rows, drag from, drag to, colour, special made, pieces cleared] */
const MAKES = [
  ['four in a row makes a horizontal arrow', { 3: '1 0 1 1', 4: '. 1' }, [4, 1], [3, 1], 1, 'h', 4],
  ['four in a column makes a vertical arrow', { 0: '. . . . . 0', 1: '. . . . 0 1', 2: '. . . . . 0', 3: '. . . . . 0' }, [1, 4], [1, 5], 0, 'v', 4],
  ['five in a line makes lightning', { 3: '0 0 1 0 0', 4: '. . 0' }, [4, 2], [3, 2], 0, 'bolt', 5],
  ['an L of five makes a bomb', { 3: '0', 4: '0', 5: '1 0 0', 6: '0' }, [6, 0], [5, 0], 0, 'bomb', 5],
  ['a T of five makes a bomb', { 3: '. . 0', 4: '. . 0', 5: '. 0 1 0', 6: '. . 0' }, [6, 2], [5, 2], 0, 'bomb', 5],
];

/* ───────────── tests ───────────── */
describe('swaps', () => {
  test('only neighbours are adjacent, and a row does not wrap into the next', () => {
    expect([adjacent(0, 1), adjacent(0, W)]).toEqual([true, true]);
    for (const [a, b] of [[W - 1, W], [0, W + 1], [0, 2], [3, 3], [-1, 0], [N - 1, N], [1.5, 2.5]]) expect(adjacent(a, b)).toBe(false);
  });

  test('a swap that lines up three is played, trades the pieces and spends a move', () => {
    const d = game(LINE3), moved = d.cells[DRAG[0]].id;
    expect(d.canSwap(0, ...DRAG)).toBe(true);
    const ev = d.swap(0, ...DRAG);
    expect(ev).toMatchObject({ type: 'swap', a: DRAG[0], b: DRAG[1], seat: 0, combo: false, extra: false });
    expect(ev.waves[0].removed.map(x => x.id)).toContain(moved);
    expect([d.moves, d.turn]).toEqual([1, 0]);
  });

  test('an illegal swap returns null and leaves board, moves and scores alone', () => {
    const d = game(LINE3), before = JSON.stringify(d);
    expect(wouldLine(d.cells, at(3, 2), at(3, 3))).toBe(false); // neighbours, but no line
    expect([wouldLine(d.cells, at(3, 2), at(4, 3)), wouldLine(d.cells, at(3, 2), at(5, 2))]).toEqual([true, true]); // diagonal, two apart: would line up
    const bad = [[at(3, 2), at(3, 3)], [at(3, 2), at(4, 3)], [at(3, 2), at(5, 2)], [at(4, 2), at(4, 3)], [at(3, 2), at(3, 2)], [-1, 0], [N - 1, N]];
    for (const [a, b] of bad) { expect(d.canSwap(0, a, b)).toBe(false); expect(d.swap(0, a, b)).toBeNull(); }
    expect(JSON.stringify(d)).toBe(before);
  });

  test('canSwap and validMoves agree with Duel.swap on every neighbouring pair', () => {
    for (const seed of [1, 2, 3, 4]) {
      const board = newBoard(seeded(seed)), legal = new Set(validMoves(board.cells).map(m => m.join()));
      expect(legal.size).toBeGreaterThan(0);
      for (const a of idx) for (const b of [a + 1, a + W]) {
        if (!adjacent(a, b)) continue;
        const d = new Duel({ board: cloneBoard(board), rng: seeded(9) });
        expect([canSwap(board.cells, a, b), canSwap(board.cells, b, a), d.canSwap(0, a, b), d.swap(0, a, b) !== null]).toEqual(Array(4).fill(legal.has(`${a},${b}`)));
      }
    }
  });

  test('a special swapped with a plain piece needs a line like anything else; two specials may always swap', () => {
    const d = game({ 2: '2h 3', 5: '4b 5v' });
    expect(wouldLine(d.cells, at(2, 0), at(2, 1))).toBe(false);
    expect([d.canSwap(0, at(2, 0), at(2, 1)), d.swap(0, at(2, 0), at(2, 1))]).toEqual([false, null]);
    expect(d.canSwap(0, at(5, 0), at(5, 1))).toBe(true); // different colours, no line
    expect(d.swap(0, at(5, 0), at(5, 1))).toMatchObject({ combo: true });
  });

  test('only the player on turn can move, and only while they have moves left', () => {
    const d = game(LINE3);
    expect([d.canSwap(1, ...DRAG), d.swap(1, ...DRAG)]).toEqual([false, null]);
    d.timeout(0);
    expect(d.swap(0, ...DRAG)).toBeNull();
    expect(d.swap(1, ...DRAG)).not.toBeNull();
  });
});

describe('matches', () => {
  test('three in a row, three in a column, or two threes from one swap clear exactly those pieces', () => {
    const column = { 1: '. . . . . 0', 2: '. . . . . 0', 3: '. . . . 0 1' };
    for (const [rows, a, b, cleared] of [
      [LINE3, ...DRAG, cellsOf([3, 0], [3, 1], [3, 2])], [column, at(3, 4), at(3, 5), cellsOf([1, 5], [2, 5], [3, 5])],
      [TWO3, at(3, 3), at(3, 4), cellsOf([1, 3], [2, 3], [3, 3], [1, 4], [2, 4], [3, 4])],
    ]) {
      const d = game(rows), ids = cleared.map(i => d.cells[i === a ? b : i === b ? a : i].id), w = d.swap(0, a, b).waves[0]; // (the swapped pieces trade ids)
      expect([gone(w), w.removed.map(x => x.id).sort((x, y) => x - y), w.made]).toEqual([cleared, ids.sort((x, y) => x - y), []]);
    }
  });

  test('lines that touch (L, T, plus) are one group; lines apart or of another colour are separate', () => {
    const shapes = [{ 3: '0', 4: '0', 5: '0 0 0' }, { 2: '. 0 0 0', 3: '. . 0', 4: '. . 0' }, { 2: '. . 0', 3: '. 0 0 0', 4: '. . 0' }];
    for (const rows of shapes) {
      const groups = groupsOf(build(rows).cells);
      expect([groups.length, groups[0].set.size, groups[0].runs.length, specialOf(groups[0])]).toEqual([1, 5, 2, 'bomb']);
    }
    expect([{ 0: '0 0 0', 6: '. . . . 0 0 0' }, { 3: '0 0 0', 4: '1 1 1' }].map(rows => groupsOf(build(rows).cells).length)).toEqual([2, 2]);
  });
});

describe('cascades', () => {
  test('pieces that fall into a line clear in a second wave, and every wave scores', () => {
    const d = game(CASCADE), x = d.cells[at(3, 3)].id, colIds = [0, 1, 2, 3].map(r => d.cells[at(r, 3)].id);
    const ev = d.swap(0, ...FALL), [w1, w2] = ev.waves;
    expect(gone(w1)).toEqual(cellsOf([4, 3], [5, 3], [6, 3]));
    expect(w1.fall.length).toBe(4);
    colIds.forEach((id, r) => expect(new Map(w1.fall).get(id)).toBe(at(r + 3, 3))); // all four drop three rows
    expect(uniq(w1.spawn.map(s => s.i))).toEqual(cellsOf([0, 3], [1, 3], [2, 3]));
    expect(gone(w2)).toEqual(expect.arrayContaining(cellsOf([6, 3], [6, 4], [6, 5])));
    expect(w2.removed.map(r => r.id)).toContain(x);
    expect(replay(build(CASCADE).cells, ev)).toEqual(snap(d.cells)); // fall and spawn say where everything ended up
    settled(d);
    expect([ev.pts, d.scores, ev.scores]).toEqual([total(ev), [ev.pts, 0], [ev.pts, 0]]); // a point per piece, over every wave, to the mover
    expect(ev.pts).toBeGreaterThan(w1.removed.length);
  });
});

describe('specials', () => {
  test.each(MAKES)('%s, in its own colour, where the matching piece lands', (_, rows, from, to, colour, kind, size) => {
    for (const [a, b] of [[from, to], [to, from]]) { // drag the matching piece in, or drag the other one out of its way
      const w = game(rows).swap(0, at(...a), at(...b)).waves[0];
      expect(w.removed.length).toBe(size);
      expect(w.removed.every(x => x.c === colour)).toBe(true);
      expect(w.made).toEqual([{ i: at(...to), id: expect.any(Number), c: colour, s: kind }]);
    }
  });

  test('two matches from one swap each leave their special where their own piece landed (not mid-line)', () => {
    const rows = { 1: '. . . 0 1', 2: '. . . 1 0', 3: '. . . 0 1', 4: '. . . 0 1' }; // (2,3)<->(2,4): a column of four zeros and one of four ones
    const ev = game(rows).swap(0, at(2, 3), at(2, 4)), made = [...ev.waves[0].made].sort((x, y) => x.i - y.i);
    expect(made).toMatchObject([{ i: at(2, 3), c: 0, s: 'v' }, { i: at(2, 4), c: 1, s: 'v' }]);
  });

  test.each([
    ['an arrow matched in a row clears its column too', { 3: '. 0v 0 1 0' }, [3, 4], [3, 3], 'v', at(3, 1), uniq([...col(1), ...cellsOf([3, 2], [3, 3])])],
    ['an arrow matched in a column clears its row too', { 2: '. . . . . 0h', 3: '. . . . . 0', 4: '. . . . 0 1' }, [4, 4], [4, 5], 'h', at(2, 5), uniq([...row(2), ...cellsOf([3, 5], [4, 5])])],
    ['a bomb matched in a row clears its 3x3', { 3: '. 0 0b 1 0' }, [3, 4], [3, 3], 'bomb', at(3, 2), square(3, 2, 1)],
    ['a bomb at the edge clears a clipped 3x3', { 0: '0b', 1: '0', 2: '1 0' }, [2, 1], [2, 0], 'bomb', at(0, 0), uniq([...square(0, 0, 1), at(2, 0)])],
  ])('%s', (_, rows, from, to, kind, where, cleared) => {
    const w = game(rows).swap(0, at(...from), at(...to)).waves[0];
    expect(gone(w)).toEqual(cleared);
    expect(w.fx).toMatchObject([{ k: kind, i: where, d: 0 }]);
    expect(w.made).toEqual([]);
  });

  test('lightning in a match zaps exactly 12 other pieces', () => {
    const line = cellsOf([3, 1], [3, 2], [3, 3]), w = game({ 3: '. 0z 0 1 0' }).swap(0, at(3, 4), at(3, 3)).waves[0], bolt = w.fx.find(f => f.k === 'bolt');
    expect([M3.bolt, uniq(bolt.cells).length, bolt.cells.some(i => line.includes(i)), w.removed.length]).toEqual([12, 12, false, 15]);
    expect(bolt).toMatchObject({ i: at(3, 1), d: 0 });
    expect(gone(w)).toEqual(uniq([...line, ...bolt.cells]));
  });

  test('one special setting off another is a chain, with the depth growing at each link', () => {
    const w = game({ 2: '. . . . . 3v', 3: '. 0h 0 1 0 . 2b' }).swap(0, at(3, 4), at(3, 3)).waves[0], depth = Object.fromEntries(w.removed.map(x => [x.i, x.d]));
    expect(w.fx.map(f => [f.k, f.d])).toEqual([['h', 0], ['bomb', 1], ['v', 2]]); // the arrow hits the bomb, whose blast hits the other arrow
    const levels = [cellsOf([3, 1], [3, 2], [3, 3]), cellsOf([3, 0], [3, 4], [3, 5], [3, 6]),
      cellsOf([2, 5], [2, 6], [4, 5], [4, 6]), cellsOf([0, 5], [1, 5], [5, 5], [6, 5])];
    levels.forEach((cells, d) => cells.forEach(i => expect(depth[i]).toBe(d)));
    expect(w.removed.length).toBe(15);
  });
});

describe('combos', () => {
  const play = (rows, from, to) => { const d = game(rows), ev = d.swap(0, at(...from), at(...to)); return [d, ev, ev.waves[0]]; };

  test.each([['h', 'h'], ['h', 'v'], ['v', 'v']])('two arrows (%s + %s) cross through the destination, whatever their colour', (p, q) => {
    for (const [from, to] of [[[3, 2], [3, 3]], [[3, 3], [3, 2]]]) {
      const [d, ev, w] = play({ 3: `. . 2${p} 3${q}` }, from, to);
      expect(ev).toMatchObject({ combo: true, extra: false });
      expect(gone(w)).toEqual(uniq([...row(3), ...col(to[1])]));
      expect(w.fx).toMatchObject([{ k: 'cross', i: at(...to), d: 0 }]); // and neither arrow fires on its own
      expect([d.moves, d.stats[0].combos]).toEqual([1, 1]);
    }
  });

  test.each([
    ['an arrow dragged onto a bomb', { 3: '. . . 2b', 4: '. . . 3h' }, [4, 3], [3, 3], 'rows3', rowsOf(2, 3, 4)],
    ['a bomb dragged onto an arrow', { 3: '. . . 2b', 4: '. . . 3h' }, [3, 3], [4, 3], 'rows3', rowsOf(3, 4, 5)],
    ['a vertical arrow and a bomb', { 3: '. . 2b 3v' }, [3, 2], [3, 3], 'cols3', colsOf(2, 3, 4)],
    ['the same, dragged the other way', { 3: '. . 2b 3v' }, [3, 3], [3, 2], 'cols3', colsOf(1, 2, 3)],
    ['at the top edge only two rows', { 0: '2b 3h' }, [0, 1], [0, 0], 'rows3', rowsOf(0, 1)],
    ['two bombs make a 5x5', { 3: '. . 2b 3b' }, [3, 2], [3, 3], 'bomb2', square(3, 3, 2)],
  ])('%s, centred on the destination', (_, rows, from, to, kind, cleared) => {
    const [, ev, w] = play(rows, from, to);
    expect([ev.combo, gone(w)]).toEqual([true, cleared]);
    expect(w.fx).toMatchObject([{ k: kind, i: at(...to) }]);
  });

  test('two lightning bolts zap 24 pieces', () => {
    const [, , w] = play({ 3: '. . 2z 3z' }, [3, 2], [3, 3]), zap = w.fx[0];
    expect([w.fx.length, zap.k, uniq(zap.cells).length, w.removed.length]).toEqual([1, 'bolt2', 24, 26]); // 24 zapped, plus the two bolts
    expect(gone(w)).toEqual(uniq([...zap.cells, at(3, 2), at(3, 3)]));
  });

  const arrowBlast = (i, s) => (s === 'h' ? row(rowOf(i)) : col(colOf(i)));
  test.each([
    ['lightning + arrow', '2z', '3h', 5, 'boltarrow', ['h', 'v'], arrowBlast],
    ['an arrow + lightning', '3v', '2z', 5, 'boltarrow', ['h', 'v'], arrowBlast],
    ['lightning + bomb', '2z', '3b', 4, 'boltbomb', ['bomb'], i => square(rowOf(i), colOf(i), 1)],
  ])('%s turns plain pieces into specials that all fire', (_, p, q, n, kind, kinds, blast) => {
    const d = game({ 3: `. . ${p} ${q}` }), plain = d.cells.map(x => !x.s), pair = [at(3, 2), at(3, 3)];
    const w = d.swap(0, ...pair).waves[0], picks = w.conv.map(([i]) => i);
    expect(uniq(picks).length).toBe(n);
    for (const [i, s] of w.conv) { expect(kinds).toContain(s); expect(plain[i]).toBe(true); expect(pair).not.toContain(i); }
    expect(gone(w)).toEqual(uniq([...w.conv.flatMap(([i, s]) => blast(i, s)), ...pair]));
    expect(w.fx[0]).toMatchObject({ k: kind, d: 0 });
    expect(w.fx.slice(1).map(f => f.d)).toEqual(Array(n).fill(1)); // each new special fires, one link down the chain
    expect(w.fx.filter(f => pair.includes(f.i)).map(f => f.k)).toEqual([kind]); // the two swapped specials don't fire themselves
  });
});

describe('scoring and extra moves', () => {
  test('scores add up across turns, each to the player who acted, and a turn reports its total', () => {
    const d = new Duel({ rng: seeded(11) }), sums = [0, 0], seen = [];
    let turn = 0;
    for (let k = 0; k < 14; k++) {
      const [a, b] = validMoves(d.cells)[0], ev = d.swap(d.turn, a, b);
      sums[ev.seat] += ev.pts; turn += ev.pts;
      seen.push([ev, JSON.stringify([ev.scores, ev.charge])]);
      expect([ev.pts, d.scores]).toEqual([total(ev), sums]);
      if (ev.next) { expect(ev.turnPts).toBe(turn); turn = 0; }
    }
    expect(Math.min(...sums)).toBeGreaterThan(0);
    for (const [ev, was] of seen) expect(JSON.stringify([ev.scores, ev.charge])).toBe(was); // an event is a snapshot, not a view of live state
  });

  test('a match of four or more made by the swap does not use up the move', () => {
    for (const [, rows, from, to] of MAKES) {
      const d = game(rows), ev = d.swap(0, at(...from), at(...to));
      expect([ev.extra, d.moves, ev.moves, d.turn, d.stats[0].extras, ev.next]).toEqual([true, 2, 2, 0, 1, undefined]);
    }
  });

  test('a plain three, a special that clears a lot, two threes and a combo all use the move', () => {
    const cases = [[LINE3, ...DRAG], [{ 3: '. 0v 0 1 0' }, at(3, 4), at(3, 3)], [TWO3, at(3, 3), at(3, 4)], [{ 3: '. . 2b 3b' }, at(3, 2), at(3, 3)]];
    for (const [rows, a, b] of cases) {
      const d = game(rows), ev = d.swap(0, a, b);
      expect([ev.extra, d.moves]).toEqual([false, 1]);
    }
  });
});

describe('boosters', () => {
  const cost = BOOSTERS.ember.cost;

  test('your own colour cleared on your turn charges your bar; the other colour charges nobody, but still scores', () => {
    const cases = [[game(LINE3), 0, true], [game(flip(LINE3), { first: 1 }), 1, true], [game(flip(LINE3)), 0, false], [game(LINE3, { first: 1 }), 1, false]];
    for (const [d, seat, mine] of cases) {
      const ev = d.swap(seat, ...DRAG);
      if (mine) expect(own(ev, seat)).toBeGreaterThanOrEqual(3);
      expect(d.charge[seat]).toBe(Math.min(cost, own(ev, seat)));
      expect([d.charge[1 - seat], ev.charge, d.scores[seat]]).toEqual([0, d.charge, ev.pts]);
      expect(ev.pts).toBeGreaterThanOrEqual(3);
    }
  });

  test('the bar fills to the booster cost and no further', () => {
    for (const [start, ready] of [[cost - 1, true], [cost, false]]) {
      const d = game(LINE3);
      d.charge[0] = start;
      expect([d.swap(0, ...DRAG).ready, d.charge[0]]).toEqual([ready, cost]);
    }
  });

  test('a booster needs a full bar and your own turn', () => {
    const d = game(LINE3), before = JSON.stringify(d);
    expect([d.canBoost(0), d.boost(0), JSON.stringify(d)]).toEqual([false, null, before]);
    d.charge[0] = cost - 1;
    expect([d.canBoost(0), d.boost(0)]).toEqual([false, null]); // one short is still short
    d.charge.fill(cost);
    expect([d.canBoost(0), d.canBoost(1), d.boost(1)]).toEqual([true, false, null]);
  });

  test('using it costs no move, empties the bar first, and what it clears can refill the bar', () => {
    const d = armed({ 3: '0 . 0 . 0 . 0' }, 'sweep'), ev = d.boost(0);
    expect(ev).toMatchObject({ type: 'boost', key: 'sweep', seat: 0 });
    expect(gone(ev.waves[0])).toEqual(row(3));
    expect([d.moves, d.turn, ev.next]).toEqual([2, 0, undefined]);
    expect(own(ev, 0)).toBeGreaterThanOrEqual(4);
    expect(d.charge[0]).toBe(Math.min(cost, own(ev, 0)));
    expect(d.charge[0]).toBeLessThan(cost); // so the bar really was emptied before the clears came in
    expect(d.scores[0]).toBe(ev.pts);
  });

  test('ember clears a plus of five somewhere inside the board', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const ev = armed({}, 'ember', { seed }).boost(0), { k, i: c } = ev.waves[0].fx[0], inside = rowOf(c) >= 1 && rowOf(c) <= 5 && colOf(c) >= 1 && colOf(c) <= 5;
      expect([k, inside, gone(ev.waves[0])]).toEqual(['ember', true, uniq([c, c - W, c + W, c - 1, c + 1])]);
    }
  });

  test('targeted boosters refuse a missing or bad target and keep the charge', () => {
    for (const key of ['beams', 'prism', 'volt']) {
      const d = armed({ 3: '0 . . 0 . 0', 0: '. . . 0' }, key), before = JSON.stringify(d);
      for (const t of [undefined, null, -1, N, 2.5, '3']) expect(d.boost(0, t)).toBeNull();
      expect(JSON.stringify(d)).toBe(before);
    }
    const lone = armed({ 1: '0', 3: '. . . 0' }, 'volt'); // volt needs at least two of the colour in the line
    expect([lone.boost(0, at(3, 3)), lone.charge[0]]).toEqual([null, BOOSTERS.volt.cost]);
  });

  const EIGHT = { 0: '0 . . . . . 0', 1: '. . 0', 2: '. . . . 0', 3: '. . . . . . 0', 4: '. 0', 5: '. . . 0', 6: '. . . . . 0' }; // eight zeros, no two in line
  const eight = cellsOf([0, 0], [0, 6], [1, 2], [2, 4], [3, 6], [4, 1], [5, 3], [6, 5]);
  test.each([
    ['beams clear the row and column of the target', 'beams', {}, at(3, 4), uniq([...row(3), ...col(4)])],
    ['prism clears every piece of the target\'s colour', 'prism', EIGHT, at(2, 4), eight],
    ['prism does the same for any other colour', 'prism', flip(EIGHT), at(2, 4), eight],
    ['volt zaps the target\'s colour in its row and column', 'volt', { 0: '. . . 0', 3: '0 . . 0 . 0' }, at(3, 3), cellsOf([0, 3], [3, 0], [3, 3], [3, 5])],
    ['volt works with just one other', 'volt', { 3: '. . . 0 . 0' }, at(3, 3), cellsOf([3, 3], [3, 5])],
  ])('%s', (_, key, rows, target, cleared) => {
    const d = armed(rows, key), ev = d.boost(0, target);
    expect(ev).toMatchObject({ key, target });
    expect(gone(ev.waves[0])).toEqual(cleared);
    expect(d.charge[0]).toBe(Math.min(BOOSTERS[key].cost, own(ev, 0))); // emptied first, then refilled by the own-colour pieces it cleared
  });

  test('trick hat turns three plain pieces into specials that fade when the turn ends', () => {
    const d = armed({ ...LINE3, 0: '4h' }, 'hat'), ev = d.boost(0), conv = ev.waves[0].conv, picks = conv.map(([i]) => i);
    expect([conv.length, ev.waves[0].removed.length, ev.fade]).toEqual([3, 0, undefined]);
    for (const [i, s] of conv) expect([['h', 'v', 'bomb'].includes(s), d.cells[i].s, d.cells[i].tmp]).toEqual([true, s, 0]);
    const end = d.timeout(0);
    expect(end.fade).toEqual(uniq(picks));
    for (const i of picks) expect([d.cells[i].s, d.cells[i].tmp]).toEqual(['', undefined]);
    expect([d.cells[at(0, 0)].s, end.reshuffle]).toEqual(['h', undefined]); // a real special stays
  });
});

describe('perks', () => {
  test('the hammer smashes the chosen piece (setting off a special) for no move, once a match per player', () => {
    const d = game({ ...LINE3, 1: '. . . 2h' }), id = d.cells[at(5, 5)].id;
    for (const t of [undefined, null, -1, N]) expect(d.perk(0, 'hammer', t)).toBeNull(); // no target: refused, not used up
    expect([d.perk(1, 'hammer', 0), d.perk(1, 'shuffle'), d.perk(0, 'nuke', 0), d.perks[0].hammer]).toEqual([null, null, null, true]);
    const ev = d.perk(0, 'hammer', at(5, 5));
    expect(ev).toMatchObject({ type: 'perk', kind: 'hammer', target: at(5, 5), seat: 0 });
    expect(ev.waves[0].removed.map(x => x.id)).toEqual([id]);
    expect([d.moves, d.perks[0].hammer, d.scores[0], d.perk(0, 'hammer', at(1, 3))]).toEqual([2, false, ev.pts, null]);
    d.timeout(0);
    expect(gone(d.perk(1, 'hammer', at(1, 3)).waves[0])).toEqual(row(1)); // seat 1 still has its hammer, and the arrow fires
  });

  test('shuffle rearranges the very same pieces, for no move, once a match per player', () => {
    const d = game({ ...LINE3, 0: '2h', 6: '. . . . . . 3b' }), before = byId(d.cells), order = d.cells.map(p => p.id);
    const ev = d.perk(0, 'shuffle');
    expect(ev).toMatchObject({ type: 'perk', kind: 'shuffle', pts: 0, waves: [] });
    ev.shuffle.moves.forEach(([id, to]) => expect(d.cells[to].id).toBe(id));
    expect(byId(d.cells)).toEqual(before); // same ids, colours and special kinds
    expect(d.cells.map(p => p.id)).not.toEqual(order);
    settled(d);
    expect([d.moves, d.scores, d.perks[0]]).toEqual([2, [0, 0], { hammer: true, shuffle: false }]);
    expect([d.perk(0, 'shuffle'), d.perks[1].shuffle]).toEqual([null, true]);
  });
});

describe('turns and rounds', () => {
  test('the first player opens every round, and ev.next reports the hand-over', () => {
    for (const first of [0, 1]) {
      const d = game(LINE3, { first, format: 'sprint' }), seen = [], nexts = [];
      while (!d.over) { seen.push([d.round, d.turn]); nexts.push(d.timeout(d.turn).next); }
      expect(seen).toEqual([[1, first], [1, 1 - first], [2, first], [2, 1 - first], [3, first], [3, 1 - first]]);
      expect(nexts.slice(0, 2)).toEqual([{ turn: 1 - first, round: 1, over: false }, { turn: first, round: 2, over: false }]);
      expect(nexts[5]).toMatchObject({ round: 3, over: true });
    }
  });

  test.each([['classic', 5, 2], ['sprint', 3, 2], ['triples', 3, 3], ['nonsense', 5, 2]])('%s: %i rounds, %i moves a turn', (format, rounds, moves) => {
    const d = new Duel({ format, rng: seeded(4) });
    expect([d.rounds, d.perTurn, d.moves]).toEqual([rounds, moves, moves]);
    let used = 0, ev;
    for (let k = 0; k < 50 && !ev?.next; k++) {
      const [a, b] = validMoves(d.cells)[0];
      ev = d.swap(0, a, b);
      if (!ev.extra) used++;
    }
    expect(used).toBe(moves); // the turn passes when the moves run out, extras not counted
    expect([ev.next, d.moves]).toEqual([{ turn: 1, round: 1, over: false }, moves]);
    let turns = 1;
    while (!d.over) { d.timeout(d.turn); turns++; }
    expect(turns).toBe(rounds * 2);
  });

  test('timeout loses the rest of the turn and passes it on, but only for the player on turn', () => {
    const d = game(LINE3);
    expect(d.timeout(1)).toBeNull();
    d.swap(0, ...DRAG);
    expect(d.timeout(0)).toMatchObject({ type: 'timeout', seat: 0, pts: 0, waves: [], next: { turn: 1, round: 1, over: false } });
    expect([d.turn, d.moves]).toEqual([1, 2]);
  });
});

describe('game end', () => {
  const finish = d => { while (!d.over) d.timeout(d.turn); };

  test('the higher score wins, a tie is -1, and a margin over 30% of the loser\'s score is a landslide', () => {
    const cases = [[[10, 5], 0, true], [[5, 10], 1, true], [[14, 10], 0, true], [[13, 10], 0, false],
      [[10, 8], 0, false], [[7, 7], -1, false], [[5, 0], 0, true], [[0, 0], -1, false]];
    for (const [scores, winner, landslide] of cases) {
      const d = game(LINE3, { format: 'sprint' });
      d.scores = scores.slice();
      expect([d.over, d.winner]).toEqual([false, null]);
      finish(d);
      expect([scores, d.over, d.winner, d.landslide, d.moves]).toEqual([scores, true, winner, landslide, 0]);
    }
  });

  test('a forfeit ends it for the other player with a landslide', () => {
    const d = game(LINE3);
    d.scores = [3, 50];
    d.forfeit(1);
    d.forfeit(0); // too late: the game is already over
    expect([d.over, d.winner, d.landslide, d.forfeited]).toEqual([true, 0, true, 1]);
  });

  test('nothing is accepted after the end', () => {
    for (const end of [d => d.forfeit(1), finish]) {
      const d = armed(LINE3, 'sweep');
      end(d);
      const before = JSON.stringify(d);
      expect([d.swap(0, ...DRAG), d.swap(1, ...DRAG), d.boost(0), d.perk(0, 'shuffle'), d.perk(1, 'hammer', 0), d.timeout(0), d.timeout(1)]).toEqual(Array(7).fill(null));
      expect([d.canAct(0), d.canAct(1), d.canBoost(0), JSON.stringify(d)]).toEqual([false, false, false, before]);
    }
  });
});

describe('reshuffle', () => {
  /** No lines and no move: colour = (row + 2 col) mod 5, plus an arrow and a bomb. */
  function dead() {
    const b = { seq: N + 1, cells: idx.map(i => ({ id: i + 1, c: (rowOf(i) + 2 * colOf(i)) % 5, s: '' })) };
    b.cells[at(1, 1)].s = 'h';
    b.cells[at(5, 5)].s = 'bomb';
    if (runsOf(b.cells).length || hasMove(b.cells)) throw new Error('the dead board is alive');
    return b;
  }

  test('a board with no move is reshuffled after the action, keeping the same pieces', () => {
    const d = new Duel({ board: dead(), rng: seeded(3), first: 0 }), before = cloneBoard(d.b).cells, ev = d.timeout(0);
    expect([ev.reshuffle.recolor, ev.reshuffle.moves.length]).toEqual([[], N]);
    expect(byId(d.cells)).toEqual(byId(before)); // same ids and colours; the arrow and bomb are still an arrow and a bomb
    expect(replay(before, ev)).toEqual(snap(d.cells));
    expect(animMs(ev)).toBeGreaterThanOrEqual(TIMING.reshuffle);
    settled(d);
    expect(game(LINE3).timeout(0).reshuffle).toBeUndefined(); // a board that still has a move is left alone
  });

  test('reshuffle() does the same directly', () => {
    const b = dead(), kinds = byId(b.cells), r = reshuffle(b, seeded(5));
    expect(byId(b.cells)).toEqual(kinds);
    r.moves.forEach(([id, to]) => expect(b.cells[to].id).toBe(id));
    expect([runsOf(b.cells), hasMove(b.cells)]).toEqual([[], true]);
  });

  test('every new board is full, has no lines and has a move', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const b = newBoard(seeded(seed));
      expect(b.cells.every(p => p && p.c >= 0 && p.c < 6 && p.s === '')).toBe(true);
      expect(Math.max(...b.cells.map(p => p.id))).toBeLessThan(b.seq);
      settled({ cells: b.cells });
    }
  });
});

describe('determinism and pacing', () => {
  test('the same seed and the same actions give the same events', () => {
    const run = seed => {
      const d = new Duel({ rng: seeded(seed), boosters: ['ember', 'hat'] }), events = []; // both boosters pick at random
      for (let k = 0; k < 16 && !d.over; k++) {
        const s = d.turn, moves = validMoves(d.cells);
        if (k % 2 === 0 && k < 12) { d.charge[s] = BOOSTERS[d.boosters[s]].cost; events.push(d.boost(s, 10)); }
        else events.push(d.swap(s, ...moves[k % moves.length]));
      }
      return [events, JSON.stringify(d)];
    };
    expect(run(7)).toEqual(run(7));
    expect(['ember', 'hat'].every(key => run(7)[0].some(e => e.key === key))).toBe(true); // both random boosters were played
    expect(run(7)[1]).not.toBe(run(8)[1]);
  });

  test('every action takes time to play back, and more waves and deeper chains take longer', () => {
    const cascade = game(CASCADE).swap(0, ...FALL), one = { ...cascade, waves: cascade.waves.slice(0, 1) }, wave = d => ({ conv: [], removed: [{ d }], fall: [], spawn: [] });
    expect(animMs(null)).toBe(0);
    expect(animMs(one)).toBeGreaterThan(0);
    expect(animMs(cascade)).toBeGreaterThan(animMs(one));
    expect(animMs({ ...cascade, waves: [...cascade.waves, cascade.waves[0]] })).toBeGreaterThan(animMs(cascade));
    expect(waveMs(wave(3))).toBe(waveMs(wave(0)) + 3 * TIMING.depth);
    const others = [armed({}, 'beams').boost(0, 24), armed(LINE3, 'hat').boost(0), game(LINE3).perk(0, 'hammer', 0), game(LINE3).perk(0, 'shuffle')];
    for (const ev of others) expect(animMs(ev)).toBeGreaterThan(0);
    const hat = armed(LINE3, 'hat');
    hat.boost(0);
    expect(animMs(hat.timeout(0))).toBeGreaterThanOrEqual(TIMING.fade);
  });
});

describe('random games', () => {
  test('200 seeded games of random legal play keep every rule, and all of them end', () => {
    const keys = Object.keys(BOOSTERS), formats = Object.keys(M3.formats);
    for (let g = 1; g <= 200; g++) {
      const pick = seeded(1000 + g), boosters = [keys[pick(keys.length)], keys[pick(keys.length)]];
      const d = new Duel({ format: formats[g % 3], first: g % 2, boosters, rng: seeded(g) }), sums = [0, 0];
      for (let steps = 0; !d.over; steps++) {
        if (steps > 2000) throw new Error(`game ${g} did not end`);
        const seat = d.turn, before = cloneBoard(d.b).cells, json = JSON.stringify(d), roll = pick(14), x = pick(N), y = pick(N);
        if (!d.canSwap(seat, x, y)) { expect(d.swap(seat, x, y)).toBeNull(); expect(JSON.stringify(d)).toBe(json); } // refused without a trace
        let ev = null;
        if (d.canBoost(seat) && roll < 7) ev = d.boost(seat, pick(N)); // (null if the target was no use)
        else if (roll === 7 && d.perks[seat].hammer) ev = d.perk(seat, 'hammer', pick(N));
        else if (roll === 8 && d.perks[seat].shuffle) ev = d.perk(seat, 'shuffle');
        else if (roll === 9 && pick(4) === 0) ev = d.timeout(seat);
        if (!ev) { const moves = validMoves(d.cells), [a, b] = moves[pick(moves.length)]; ev = pick(2) ? d.swap(seat, a, b) : d.swap(seat, b, a); }
        expect(ev).not.toBeNull();
        sums[ev.seat] += ev.pts;
        expect([ev.pts, d.scores]).toEqual([total(ev), sums]);
        expect(replay(before, ev)).toEqual(snap(d.cells)); // the event says what happened
        expect(ev.type === 'swap' ? animMs(ev) > 0 : animMs(ev) >= 0).toBe(true);
        expect(d.cells.every(p => p.c >= 0 && p.c < 6 && ['', 'h', 'v', 'bomb', 'bolt'].includes(p.s))).toBe(true);
        expect([d.cells.every(Boolean), new Set(d.cells.map(p => p.id)).size, runsOf(d.cells), d.over || hasMove(d.cells)]).toEqual([true, N, [], true]);
        d.charge.forEach((c, s) => expect(c >= 0 && c <= BOOSTERS[d.boosters[s]].cost).toBe(true));
        expect(d.moves).toBeLessThanOrEqual(d.perTurn);
        for (const p of d.cells) if (p.tmp !== undefined) expect([p.tmp, d.over]).toEqual([d.turn, false]); // hat pieces never outlive their turn
      }
      const [x, y] = d.scores;
      expect(d.winner).toBe(x === y ? -1 : x > y ? 0 : 1);
      if (d.winner >= 0) expect(d.landslide).toBe(Math.abs(x - y) > M3.landslide * Math.min(x, y));
    }
  });
});

describe('names from browsers', () => {
  test("built-in property names are not formats, boosters or perks", () => {
    const d = new Duel({ format: 'constructor', boosters: ['__proto__', 'toString'], rng: seeded(5) });
    expect([d.format, d.rounds, d.perTurn]).toEqual(['classic', 5, 2]);
    expect(d.boosters).toEqual(['ember', 'ember']);
    const before = snap(d.cells);
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(d.perk(d.turn, kind)).toBe(null);
    expect(snap(d.cells)).toEqual(before);
    expect(d.perk(d.turn, 'shuffle')).not.toBe(null);
    expect(d.perk(d.turn, 'shuffle')).toBe(null); // once a match
  });
});
