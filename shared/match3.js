/* ════════════════════════════════════════════════════════════════════
   LAMPLIGHT · gem duel rules
   A 1v1 turn-based match-3 in the style of Match Masters (see
   docs/match-masters-research.md for where each rule comes from).
   Pure logic both sides share: the board, swaps, matches, special
   pieces and their combos, cascades, boosters, perks, turns, rounds and
   scoring. The server plays it with its own random numbers and sends
   every action out as waves (what was cleared, what fell, what came in);
   browsers only animate those.

   The board is 7x7, index = row * 7 + col, row 0 at the top. A piece is
   { id, c, s }: c is its colour (0 charges seat 0's booster, 1 charges
   seat 1's, 2-5 are neutral) and s its special ('' plain, 'h'/'v' arrow,
   'bomb', 'bolt'). Ids let the browser follow a piece as it falls.
   ════════════════════════════════════════════════════════════════════ */

export const W = 7, H = 7, N = W * H, COLORS = 6;

export const M3 = {
  formats: {
    classic: { rounds: 5, moves: 2, label: 'Classic', desc: 'Five rounds, two moves a turn' },
    sprint: { rounds: 3, moves: 2, label: 'Sprint', desc: 'Three rounds, two moves a turn' },
    triples: { rounds: 3, moves: 3, label: 'Triples', desc: 'Three rounds, three moves a turn' },
  },
  speeds: { relaxed: { clock: 45 }, normal: { clock: 30 }, turbo: { clock: 20 }, test: { clock: 3 } },
  entries: [0, 100, 500, 2500],
  bolt: 12, // pieces a lightning bolt zaps
  landslide: 0.3, // win by more than this share of the loser's score
};

/** Boosters: charged by clearing your own colour on your turn, used for free (no move). */
export const BOOSTERS = {
  ember: { name: 'Ember Burst', icon: '✸', cost: 6, target: false, desc: 'A spark lands on a random spot and clears a plus of five pieces.' },
  sweep: { name: 'Lantern Sweep', icon: '☾', cost: 6, target: false, desc: 'A lantern sweeps the middle row clear.' },
  beams: { name: 'Twin Beams', icon: '✚', cost: 7, target: true, desc: 'Pick a piece: its whole row and column are cleared.' },
  prism: { name: 'Prism Wand', icon: '◆', cost: 7, target: true, desc: 'Pick a piece: every piece of its colour is cleared.' },
  volt: { name: 'Volt Arc', icon: 'ϟ', cost: 7, target: true, desc: 'Pick a piece: the pieces of its colour in its row and column are zapped.' },
  hat: { name: 'Trick Hat', icon: '✦', cost: 7, target: false, desc: 'Three special pieces appear. Use them this turn or they fade.' },
};
export const PERKS = {
  hammer: { name: 'Hammer', icon: '⚒', target: true, desc: 'Smash one piece of your choice. Once a match.' },
  shuffle: { name: 'Shuffle', icon: '⟳', target: false, desc: 'Shuffle the whole board. Once a match.' },
};
export const SPECIAL_NAME = { h: 'arrow', v: 'arrow', bomb: 'bomb', bolt: 'lightning' };

/* ───────────── pacing ─────────────
   How long the browser takes to play an action back, in ms. The server waits this long before
   the next step (and stops the clock meanwhile); the board animates on the same schedule.   */
export const TIMING = { swap: 200, intro: 420, conv: 300, clear: 280, depth: 120, fall: 380, gap: 60, reshuffle: 700, fade: 260 };
export function waveMs(w) {
  const depth = w.removed.reduce((a, x) => Math.max(a, x.d), 0);
  return (w.conv.length ? TIMING.conv : 0) + (w.removed.length ? TIMING.clear + depth * TIMING.depth : 0) + (w.fall.length || w.spawn.length ? TIMING.fall : 0) + TIMING.gap;
}
export function animMs(ev) {
  if (!ev) return 0;
  let ms = ev.type === 'swap' ? TIMING.swap : ev.type === 'boost' || (ev.type === 'perk' && ev.kind === 'hammer') ? TIMING.intro : 0;
  for (const w of ev.waves || []) ms += waveMs(w);
  if (ev.shuffle) ms += TIMING.reshuffle;
  if (ev.fade && ev.fade.length) ms += TIMING.fade;
  if (ev.reshuffle) ms += TIMING.reshuffle;
  return ms;
}

/* ───────────── random numbers ───────────── */
/** A seeded rng(n) -> 0..n-1 for tests and replays (the server uses secureInt). */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return n => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/* ───────────── geometry ───────────── */
export const rowOf = i => Math.floor(i / W), colOf = i => i % W;
const at = (r, c) => (r >= 0 && r < H && c >= 0 && c < W ? r * W + c : -1);
export const adjacent = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < N && b < N
  && ((rowOf(a) === rowOf(b) && Math.abs(a - b) === 1) || Math.abs(a - b) === W);
const rowCells = r => Array.from({ length: W }, (_, c) => r * W + c);
const colCells = c => Array.from({ length: H }, (_, r) => r * W + c);
function square(i, rad) {
  const out = [], r0 = rowOf(i), c0 = colOf(i);
  for (let r = r0 - rad; r <= r0 + rad; r++) for (let c = c0 - rad; c <= c0 + rad; c++) { const j = at(r, c); if (j >= 0) out.push(j); }
  return out;
}
const plus = i => [i, at(rowOf(i) - 1, colOf(i)), at(rowOf(i) + 1, colOf(i)), at(rowOf(i), colOf(i) - 1), at(rowOf(i), colOf(i) + 1)].filter(j => j >= 0);
/** `k` distinct random picks from `list`. */
function sample(list, k, rng) {
  const a = list.slice(), out = [];
  while (out.length < k && a.length) out.push(a.splice(rng(a.length), 1)[0]);
  return out;
}

/* ───────────── boards ───────────── */
const piece = (b, c, s = '') => ({ id: b.seq++, c, s });
export const cloneBoard = b => ({ seq: b.seq, cells: b.cells.map(p => p && { ...p }) });

/** Would the piece at i be part of a line of three? */
function lineAt(cells, i) {
  const p = cells[i];
  if (!p) return false;
  const same = (r, c) => { const j = at(r, c); return j >= 0 && cells[j] && cells[j].c === p.c; };
  const r = rowOf(i), c = colOf(i);
  let h = 1, v = 1;
  for (let k = c - 1; same(r, k); k--) h++;
  for (let k = c + 1; same(r, k); k++) h++;
  for (let k = r - 1; same(k, c); k--) v++;
  for (let k = r + 1; same(k, c); k++) v++;
  return h >= 3 || v >= 3;
}

/** A legal move: two neighbours that make a line of three, or two specials (they combine). */
export function canSwap(cells, a, b) {
  if (!adjacent(a, b) || !cells[a] || !cells[b]) return false;
  if (cells[a].s && cells[b].s) return true;
  if (cells[a].c === cells[b].c) return false;
  [cells[a], cells[b]] = [cells[b], cells[a]];
  const ok = lineAt(cells, a) || lineAt(cells, b);
  [cells[a], cells[b]] = [cells[b], cells[a]];
  return ok;
}
export function validMoves(cells, limit = Infinity) {
  const out = [];
  for (let i = 0; i < N; i++) {
    for (const j of [colOf(i) < W - 1 ? i + 1 : -1, rowOf(i) < H - 1 ? i + W : -1]) {
      if (j >= 0 && canSwap(cells, i, j)) { out.push([i, j]); if (out.length >= limit) return out; }
    }
  }
  return out;
}
export const hasMove = cells => validMoves(cells, 1).length > 0;

/** Every straight line of three or more of one colour. */
export function runsOf(cells) {
  const runs = [];
  const scan = (dir, outer, inner, idx) => {
    for (let o = 0; o < outer; o++) {
      let s = 0;
      while (s < inner) {
        const p = cells[idx(o, s)];
        let e = s + 1;
        if (p) while (e < inner && cells[idx(o, e)] && cells[idx(o, e)].c === p.c) e++;
        if (p && e - s >= 3) runs.push({ dir, c: p.c, cells: Array.from({ length: e - s }, (_, k) => idx(o, s + k)) });
        s = e;
      }
    }
  };
  scan('h', H, W, (r, c) => r * W + c);
  scan('v', W, H, (c, r) => r * W + c);
  return runs;
}

/** Lines that touch join into one match (an L, a T, a plus). */
export function groupsOf(cells) {
  const groups = [];
  for (const run of runsOf(cells)) {
    const touching = groups.filter(g => run.cells.some(i => g.set.has(i)));
    const g = { c: run.c, set: new Set(run.cells), runs: [run] };
    for (const t of touching) { for (const i of t.set) g.set.add(i); g.runs.push(...t.runs); groups.splice(groups.indexOf(t), 1); }
    groups.push(g);
  }
  return groups;
}

/** What a match makes: five in a line a bolt, an L/T a bomb, four in a line an arrow along it. */
export function specialOf(g) {
  if (g.runs.some(r => r.cells.length >= 5)) return 'bolt';
  if (g.runs.some(r => r.dir === 'h') && g.runs.some(r => r.dir === 'v')) return 'bomb';
  const four = g.runs.find(r => r.cells.length === 4);
  return four ? four.dir : '';
}
/** Where the new special sits: the cell you swapped into if it is in the match, else the corner or the middle. */
function spotOf(g, kind, prefer) {
  for (const i of prefer) if (g.set.has(i)) return i;
  if (kind === 'bomb') {
    const h = new Set(g.runs.filter(r => r.dir === 'h').flatMap(r => r.cells));
    const x = g.runs.filter(r => r.dir === 'v').flatMap(r => r.cells).find(i => h.has(i));
    if (x != null) return x;
  }
  const run = g.runs.reduce((a, r) => (r.cells.length > a.cells.length ? r : a));
  return run.cells[Math.floor(run.cells.length / 2)];
}

/** A full board with no lines on it and at least one move. */
export function newBoard(rng) {
  const b = { cells: Array(N).fill(null), seq: 1 };
  for (let tries = 0; ; tries++) {
    b.cells.fill(null);
    for (let i = 0; i < N; i++) {
      const r = rowOf(i), c = colOf(i), bad = new Set();
      if (c >= 2 && b.cells[i - 1].c === b.cells[i - 2].c) bad.add(b.cells[i - 1].c);
      if (r >= 2 && b.cells[i - W].c === b.cells[i - 2 * W].c) bad.add(b.cells[i - W].c);
      const ok = [...Array(COLORS).keys()].filter(k => !bad.has(k));
      b.cells[i] = piece(b, ok[rng(ok.length)]);
    }
    if (hasMove(b.cells) || tries > 50) return b;
  }
}

/**
 * Rearranges every piece (specials too) so nothing lines up and a move exists. Returns
 * { moves: [[id, to]], recolor: [[id, c]] } (recolouring only if no arrangement turned up).
 */
export function reshuffle(b, rng) {
  const pieces = b.cells.filter(Boolean);
  for (let t = 0; t < 300; t++) {
    const order = sample(pieces, pieces.length, rng);
    b.cells = Array(N).fill(null);
    order.forEach((p, i) => { b.cells[i] = p; });
    if (!runsOf(b.cells).length && hasMove(b.cells)) return { moves: order.map((p, i) => [p.id, i]), recolor: [] };
  }
  // nothing worked with these colours: repaint the plain pieces until the board is settled and playable
  const was = new Map(b.cells.map(p => [p.id, p.c]));
  for (let t = 0; t < 300; t++) {
    const fresh = newBoard(rng);
    b.cells.forEach((p, i) => { if (!p.s) p.c = fresh.cells[i].c; });
    if (!runsOf(b.cells).length && hasMove(b.cells)) break;
  }
  return { moves: b.cells.map((p, i) => [p.id, i]), recolor: b.cells.filter(p => p.c !== was.get(p.id)).map(p => [p.id, p.c]) };
}

/* ───────────── clearing, specials, gravity, cascades ───────────── */
/** The cells a special takes with it when it goes off. */
function effectOf(cells, i, s, rng, taken) {
  if (s === 'h') return rowCells(rowOf(i));
  if (s === 'v') return colCells(colOf(i));
  if (s === 'bomb') return square(i, 1);
  if (s === 'bolt') return sample(cells.map((p, j) => (p && !taken.has(j) && j !== i ? j : -1)).filter(j => j >= 0), M3.bolt, rng);
  return [];
}

/**
 * Clears what `start` says, sets off every special caught in it (and the ones those catch), drops what is
 * left, refills from the top, and repeats for every cascade. Mutates `b`. Returns the waves, each
 * { conv, fx, removed, made, fall, spawn } so the browser can replay them:
 * - conv: [[i, s]] pieces that turned special in place before the wave
 * - fx: [{ k, i, d, cells }] effects to draw (an arrow firing, a bomb, a bolt...), d = chain depth
 * - removed: [{ i, id, c, s, d }] pieces taken off (d: when, for staggering)
 * - made: [{ i, id, c, s }] specials the matches left behind
 * - fall: [[id, to]] pieces that dropped; spawn: [{ i, id, c, s }] new pieces from above
 * start: { hits: [[i, d]], fire: [{ k, i, cells, d }], made: [{ i, c, s }], conv: [[i, s, tmp?]], spent: [i] }
 */
export function resolve(b, rng, start) {
  const waves = [];
  let cur = start;
  for (let n = 0; cur && n < 60; n++) {
    waves.push(clearWave(b, rng, cur));
    const groups = groupsOf(b.cells);
    cur = groups.length ? matchStart(groups, []).start : null;
  }
  return waves;
}

/** The first step of a wave made by matches: every matched cell goes, specials are left where they belong. */
function matchStart(groups, prefer) {
  const hits = [], made = [];
  let big = false;
  for (const g of groups) {
    for (const i of g.set) hits.push([i, 0]);
    const s = specialOf(g);
    if (s) made.push({ i: spotOf(g, s, prefer), c: g.c, s });
    if (g.set.size >= 4) big = true;
  }
  return { start: { hits, made }, big };
}

function clearWave(b, rng, { hits = [], fire = [], made = [], conv = [], spent = [] }) {
  const cells = b.cells, taken = new Map(), queue = [], fx = [], used = new Set(spent);
  for (const [i, s, tmp] of conv) { cells[i].s = s; if (tmp != null) cells[i].tmp = tmp; }
  const hit = (i, d) => {
    if (i < 0 || taken.has(i) || !cells[i]) return;
    taken.set(i, d);
    if (cells[i].s && !used.has(i)) { used.add(i); queue.push([i, d]); }
  };
  for (const [i, d] of hits) hit(i, d);
  for (const f of fire) { fx.push({ k: f.k, i: f.i, d: f.d, cells: f.cells }); for (const j of f.cells) hit(j, f.d + 1); }
  while (queue.length) {
    queue.sort((x, y) => x[1] - y[1]);
    const [i, d] = queue.shift();
    const s = cells[i].s, area = effectOf(cells, i, s, rng, taken);
    fx.push({ k: s, i, d, cells: area });
    for (const j of area) hit(j, d + 1);
  }
  const removed = [...taken].map(([i, d]) => ({ i, id: cells[i].id, c: cells[i].c, s: cells[i].s, d }));
  for (const i of taken.keys()) cells[i] = null;
  const out = [];
  for (const m of made) {
    if (cells[m.i]) continue; // already re-filled by an earlier special this wave (never happens with disjoint groups)
    const p = piece(b, m.c, m.s);
    cells[m.i] = p;
    out.push({ i: m.i, id: p.id, c: p.c, s: p.s });
  }
  const fall = [], spawn = [];
  for (let c = 0; c < W; c++) {
    let w = H - 1;
    for (let r = H - 1; r >= 0; r--) {
      const p = cells[r * W + c];
      if (!p) continue;
      if (r !== w) { cells[w * W + c] = p; cells[r * W + c] = null; fall.push([p.id, w * W + c]); }
      w--;
    }
    for (; w >= 0; w--) {
      const p = piece(b, rng(COLORS));
      cells[w * W + c] = p;
      spawn.push({ i: w * W + c, id: p.id, c: p.c, s: '' });
    }
  }
  return { conv: conv.map(([i, s]) => [i, s]), fx, removed, made: out, fall, spawn };
}

/* ───────────── combos: two specials swapped together ───────────── */
const isArrow = s => s === 'h' || s === 'v';
/** What two specials do when swapped together. The moving piece lands on b, so that is where it goes off. */
function comboStart(cells, a, b, rng) {
  const A = cells[a].s, B = cells[b].s, both = [A, B];
  const has = k => both.includes(k), r = rowOf(b), c = colOf(b);
  const start = { hits: [[a, 0], [b, 0]], spent: [a, b], fire: [], conv: [] };
  const plain = () => cells.map((p, j) => (p && !p.s && j !== a && j !== b ? j : -1)).filter(j => j >= 0);
  let k, area;
  if (isArrow(A) && isArrow(B)) { k = 'cross'; area = [...rowCells(r), ...colCells(c)]; }
  else if (has('bomb') && (isArrow(A) || isArrow(B))) {
    const dir = isArrow(A) ? A : B;
    k = dir === 'h' ? 'rows3' : 'cols3';
    area = dir === 'h' ? [r - 1, r, r + 1].filter(x => x >= 0 && x < H).flatMap(rowCells) : [c - 1, c, c + 1].filter(x => x >= 0 && x < W).flatMap(colCells);
  } else if (A === 'bomb' && B === 'bomb') { k = 'bomb2'; area = square(b, 2); }
  else if (A === 'bolt' && B === 'bolt') { k = 'bolt2'; area = sample(cells.map((p, j) => (p && j !== a && j !== b ? j : -1)).filter(j => j >= 0), M3.bolt * 2, rng); }
  else {
    // a bolt with an arrow or a bomb: it turns random pieces into that special and sets them all off
    const other = has('bomb') ? 'bomb' : 'h';
    const picks = sample(plain(), other === 'bomb' ? 4 : 5, rng);
    start.conv = picks.map((j, n) => [j, other === 'bomb' ? 'bomb' : n % 2 ? 'v' : 'h']);
    k = other === 'bomb' ? 'boltbomb' : 'boltarrow';
    area = picks;
  }
  start.fire.push({ k, i: b, d: 0, cells: [...new Set(area)] });
  return start;
}

/* ───────────── boosters and perks ───────────── */
/** The opening of a booster's wave, or null if it can't be used like that (no target, nothing to zap). */
function boosterStart(key, cells, target, seat, rng) {
  const pick = () => (Number.isInteger(target) && target >= 0 && target < N && cells[target] ? target : null);
  switch (key) {
    case 'ember': {
      const i = (1 + rng(H - 2)) * W + 1 + rng(W - 2);
      return { fire: [{ k: 'ember', i, d: 0, cells: plus(i) }] };
    }
    case 'sweep': return { fire: [{ k: 'sweep', i: Math.floor(H / 2) * W, d: 0, cells: rowCells(Math.floor(H / 2)) }] };
    case 'beams': {
      const i = pick();
      return i == null ? null : { fire: [{ k: 'beams', i, d: 0, cells: [...new Set([...rowCells(rowOf(i)), ...colCells(colOf(i))])] }] };
    }
    case 'prism': {
      const i = pick();
      if (i == null) return null;
      const c = cells[i].c;
      return { fire: [{ k: 'prism', i, d: 0, cells: cells.map((p, j) => (p && p.c === c ? j : -1)).filter(j => j >= 0) }] };
    }
    case 'volt': {
      const i = pick();
      if (i == null) return null;
      const c = cells[i].c;
      const area = [...new Set([...rowCells(rowOf(i)), ...colCells(colOf(i))])].filter(j => cells[j] && cells[j].c === c);
      return area.length < 2 ? null : { fire: [{ k: 'volt', i, d: 0, cells: area }] };
    }
    case 'hat': {
      const plain = cells.map((p, j) => (p && !p.s ? j : -1)).filter(j => j >= 0);
      const kinds = ['h', 'v', 'bomb'], picks = sample(plain, 3, rng);
      return { conv: picks.map(j => [j, kinds[rng(kinds.length)], seat]), fire: [{ k: 'hat', i: picks[0] ?? 0, d: 0, cells: [] }] };
    }
  }
  return null;
}

/* ───────────── a match between two players ───────────── */
/**
 * The whole duel: rounds of one turn each, `moves` swaps a turn (a match of four or more refunds the move),
 * boosters and perks for free, the highest score after the last round wins.
 */
export class Duel {
  constructor({ format = 'classic', first = 0, boosters = ['ember', 'ember'], rng = n => Math.floor(Math.random() * n), board = null } = {}) {
    const f = M3.formats[format] || M3.formats.classic;
    this.format = M3.formats[format] ? format : 'classic';
    this.rounds = f.rounds; this.perTurn = f.moves;
    this.rng = rng;
    this.b = board || newBoard(this.rng);
    this.first = first; this.turn = first; this.round = 1; this.half = 0; this.moves = this.perTurn;
    this.scores = [0, 0]; this.charge = [0, 0];
    this.boosters = boosters.map(k => (BOOSTERS[k] ? k : 'ember'));
    this.perks = [{ hammer: true, shuffle: true }, { hammer: true, shuffle: true }];
    this.over = false; this.winner = null; this.landslide = false; this.turnPts = 0;
    this.stats = [0, 1].map(() => ({ specials: 0, combos: 0, extras: 0, boosters: 0, best: 0 }));
  }
  get cells() { return this.b.cells; }
  canAct(seat) { return !this.over && seat === this.turn && this.moves > 0; }
  canSwap(seat, a, b) { return this.canAct(seat) && canSwap(this.cells, a, b); }
  canBoost(seat) { return this.canAct(seat) && this.charge[seat] >= BOOSTERS[this.boosters[seat]].cost; }

  /** A swap. Returns the event to send out, or null if it isn't a legal move. */
  swap(seat, a, b) {
    if (!this.canSwap(seat, a, b)) return null;
    const cells = this.cells;
    let start, extra = false, combo = false;
    if (cells[a].s && cells[b].s) { start = comboStart(cells, a, b, this.rng); combo = true; }
    [cells[a], cells[b]] = [cells[b], cells[a]];
    if (!combo) { const m = matchStart(groupsOf(cells), [b, a]); start = m.start; extra = m.big; }
    const waves = resolve(this.b, this.rng, start);
    if (combo) this.stats[seat].combos++;
    if (extra) this.stats[seat].extras++;
    return this.finish(seat, { type: 'swap', a, b, combo }, waves, { move: true, extra });
  }
  /** Uses the charged booster. `target` is a cell for the ones that need one. */
  boost(seat, target = null) {
    if (!this.canBoost(seat)) return null;
    const key = this.boosters[seat], start = boosterStart(key, this.cells, target, seat, this.rng);
    if (!start) return null;
    this.charge[seat] = 0;
    this.stats[seat].boosters++;
    const waves = resolve(this.b, this.rng, start);
    return this.finish(seat, { type: 'boost', key, target: Number.isInteger(target) ? target : null }, waves, { move: false });
  }
  /** A perk: the hammer (one piece of your choice) or a shuffle, each once a match. */
  perk(seat, kind, target = null) {
    if (!this.canAct(seat) || !PERKS[kind] || !this.perks[seat][kind]) return null;
    if (kind === 'hammer') {
      if (!(Number.isInteger(target) && target >= 0 && target < N && this.cells[target])) return null;
      this.perks[seat].hammer = false;
      const waves = resolve(this.b, this.rng, { fire: [{ k: 'hammer', i: target, d: 0, cells: [target] }] });
      return this.finish(seat, { type: 'perk', kind, target }, waves, { move: false });
    }
    this.perks[seat].shuffle = false;
    const sh = reshuffle(this.b, this.rng);
    return this.finish(seat, { type: 'perk', kind, shuffle: sh }, [], { move: false });
  }
  /** Time ran out: the rest of the turn is lost. */
  timeout(seat) {
    if (this.over || seat !== this.turn) return null;
    this.moves = 0;
    return this.finish(seat, { type: 'timeout' }, [], { move: false });
  }

  /** Scores the waves, spends the move, reshuffles a dead board and hands over the turn when it is done. */
  finish(seat, ev, waves, { move, extra = false }) {
    let pts = 0, mine = 0, made = 0;
    for (const w of waves) {
      pts += w.removed.length;
      mine += w.removed.filter(x => x.c === seat).length;
      made += w.made.length;
    }
    this.scores[seat] += pts; this.turnPts += pts;
    this.stats[seat].specials += made;
    this.stats[seat].best = Math.max(this.stats[seat].best, pts);
    const cost = BOOSTERS[this.boosters[seat]].cost;
    const before = this.charge[seat];
    this.charge[seat] = Math.min(cost, this.charge[seat] + mine);
    if (move && !extra) this.moves--;
    Object.assign(ev, { seat, waves, pts, extra: !!(move && extra), ready: before < cost && this.charge[seat] >= cost });
    if (this.moves <= 0) {
      ev.fade = this.fadeTemps(seat);
      ev.turnPts = this.turnPts;
      this.nextTurn();
      ev.next = { turn: this.turn, round: this.round, over: this.over };
    }
    if (!this.over && !hasMove(this.cells)) ev.reshuffle = reshuffle(this.b, this.rng);
    ev.scores = this.scores.slice(); ev.charge = this.charge.slice(); ev.moves = this.moves;
    return ev;
  }
  /** A Trick Hat's specials only last for the turn they came in. */
  fadeTemps(seat) {
    const out = [];
    this.cells.forEach((p, i) => { if (p && p.tmp === seat) { p.s = ''; delete p.tmp; out.push(i); } });
    return out;
  }
  nextTurn() {
    this.turnPts = 0;
    if (this.half === 1) { this.round++; this.half = 0; } else this.half = 1;
    if (this.round > this.rounds) { this.end(); return; }
    this.turn = this.half === 0 ? this.first : 1 - this.first;
    this.moves = this.perTurn;
  }
  end() {
    this.over = true; this.moves = 0; this.round = this.rounds;
    const [a, b] = this.scores;
    this.winner = a === b ? -1 : a > b ? 0 : 1;
    if (this.winner >= 0) {
      const w = this.scores[this.winner], l = this.scores[1 - this.winner];
      this.landslide = w - l > M3.landslide * l;
    }
  }
  /** The other player walked away: they lose, by a landslide. */
  forfeit(seat) {
    if (this.over) return;
    this.over = true; this.moves = 0; this.winner = 1 - seat; this.landslide = true; this.forfeited = seat;
  }
  toJSON() {
    return {
      format: this.format, rounds: this.rounds, perTurn: this.perTurn, board: this.cells, seq: this.b.seq,
      first: this.first, turn: this.turn, round: this.round, half: this.half, moves: this.moves,
      scores: this.scores, charge: this.charge, boosters: this.boosters, perks: this.perks, turnPts: this.turnPts,
      over: this.over, winner: this.winner, landslide: this.landslide,
    };
  }
  /** A copy to try things on (the bot), with its own random numbers. */
  static restore(s, rng) {
    const d = new Duel({ format: s.format, first: s.first, boosters: s.boosters, rng, board: { cells: s.board.map(p => p && { ...p }), seq: s.seq } });
    Object.assign(d, {
      turn: s.turn, round: s.round, half: s.half, moves: s.moves, scores: s.scores.slice(), charge: s.charge.slice(),
      perks: s.perks.map(p => ({ ...p })), over: s.over, winner: s.winner, landslide: s.landslide, turnPts: s.turnPts || 0,
    });
    return d;
  }
}
