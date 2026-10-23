/* End-to-end gem duels: a real server, scripted players over WebSockets. */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { validMoves, canSwap, BOOSTERS, M3 } from '../shared/match3.js';
import { M3Table } from '../server/m3table.js';

const PORT = 4010 + Math.floor(Math.random() * 9);
let proc;

beforeAll(async () => {
  proc = Bun.spawn(['bun', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), ALLOW_TEST_SPEED: '1', NODE_ENV: 'production', DB_PATH: ':memory:' },
    stdout: 'pipe', stderr: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return; } catch { /* not up yet */ }
    await Bun.sleep(100);
  }
  throw new Error('server did not start');
});
afterAll(() => proc && proc.kill());

const until = async (fn, ms = 30000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await Bun.sleep(15); }
};
const pickOne = a => a[Math.floor(Math.random() * a.length)];

/**
 * A scripted duelist. With `play` on it takes every turn it is given: now and then a booster or the hammer,
 * otherwise a random legal swap (and, if `bad` is set, an illegal one first, which the server must refuse).
 */
function player(name, { play = true, bad = 0, booster = 'ember', key = crypto.randomUUID() } = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${crypto.randomUUID()}&name=${name}&key=${key}`);
  const me = {
    ws, name, s: null, seat: null, wallet: null, errors: [], events: [], results: [], lines: [], evs: [],
    rejects: 0, badSent: 0, waiting: false, play, noBoost: '',
  };
  me.ready = new Promise(r => (ws.onopen = r));
  me.send = o => ws.send(JSON.stringify(o));
  const act = () => {
    const s = me.s;
    if (!me.play || me.waiting || !s || me.seat == null || s.phase !== 'play') return;
    const d = s.duel;
    if (d.turn !== me.seat || !s.clock || s.clock.seat !== me.seat || d.moves <= 0) return;
    me.waiting = true;
    const turnKey = `${s.matchNo}:${d.round}:${d.half}`;
    if (d.charge[me.seat] >= BOOSTERS[d.boosters[me.seat]].cost && me.noBoost !== turnKey && Math.random() < 0.8) {
      me.lastBoost = turnKey;
      me.send({ t: 'boost', target: Math.floor(Math.random() * 49) });
      return;
    }
    if (d.perks[me.seat].hammer && Math.random() < 0.08) { me.send({ t: 'perk', kind: 'hammer', target: Math.floor(Math.random() * 49) }); return; }
    if (me.badSent < bad) {
      const a = Math.floor(Math.random() * 48), b = a + 1;
      if (!canSwap(d.board, a, b)) { me.badSent++; me.send({ t: 'swap', a, b }); return; }
    }
    const [a, b] = pickOne(validMoves(d.board));
    me.send(Math.random() < 0.5 ? { t: 'swap', a, b } : { t: 'swap', a: b, b: a });
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    me.events.push(m.e);
    if (m.e === 'wallet') me.wallet = m.wallet;
    if (m.e === 'error') me.errors.push(m.msg);
    if (m.e === 'm3Snap') { me.s = m.s; me.seat = m.me; }
    if (m.e === 'm3') {
      me.s = m.s;
      const e = m.ev;
      if (e) {
        me.evs.push(e);
        if (e.type === 'over') me.results.push(e.result);
        if (e.type === 'reject' && e.seat === me.seat) { me.rejects++; me.waiting = false; if (me.lastBoost) me.noBoost = me.lastBoost; }
        if (['swap', 'boost', 'perk', 'timeout'].includes(e.type) && e.seat === me.seat) me.waiting = false;
        if (e.type === 'start') me.waiting = false;
      }
      if (m.line) me.lines.push(m.line.t);
    }
    act();
  };
  return me;
}

async function create(by, opts) {
  let id = null;
  by.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') id = m.id; });
  by.send({ t: 'create', opts: { game: 'm3', speed: 'test', ...opts } });
  await until(() => id);
  return id;
}
/** Every action's points add up to the final scores, and nobody scores out of turn. */
function checkScores(evs, result) {
  const sum = [0, 0];
  for (const e of evs) if (['swap', 'boost', 'perk'].includes(e.type)) sum[e.seat] += e.pts;
  expect(sum).toEqual(result.scores);
}

test('the lobby lists the built-in duels next to poker and backgammon', async () => {
  const list = await (await fetch(`http://localhost:${PORT}/api/tables`)).json();
  const duels = list.filter(t => t.game === 'm3');
  expect(duels.length).toBeGreaterThanOrEqual(4);
  expect(list.some(t => t.game === 'bg')).toBe(true);
  expect(list.some(t => !t.game || t.game === 'poker' || t.mode === 'cash')).toBe(true);
  const parlor = duels.find(t => t.name === 'The Gem Parlor');
  expect(parlor.format).toBe('classic');
  expect(parlor.seats.filter(s => s.kind === 'bot').length).toBe(1);
  expect(parlor.open).toBe(2);
});

test('a person plays a full match against the bot; the entry and the result follow the bankroll', async () => {
  const ann = player('Ann', { bad: 3, booster: 'beams' });
  await ann.ready;
  await until(() => ann.wallet);
  const start = ann.wallet.bankroll;
  const id = await create(ann, { format: 'sprint', entry: 500, bot: true, skill: 'sharp' });
  ann.send({ t: 'join', id, sit: true, booster: 'beams' });
  await until(() => ann.seat != null);
  expect(ann.s.seats[1 - ann.seat].kind).toBe('bot');
  expect(ann.s.seats[ann.seat].booster).toBe('beams');
  await until(() => ann.wallet.bankroll === start - 500);

  await until(() => ann.results.length >= 1, 120000);
  ann.play = false;
  ann.send({ t: 'leave' }); // before the next match opens
  const r = ann.results[0];
  expect(ann.s.duel.over).toBe(true);
  expect(ann.s.duel.boosters[ann.seat]).toBe('beams');
  checkScores(ann.evs, r);
  expect(r.winner).toBe(r.scores[0] === r.scores[1] ? -1 : r.scores[0] > r.scores[1] ? 0 : 1);
  // the illegal swaps were refused and changed nothing
  expect(ann.rejects).toBeGreaterThanOrEqual(ann.badSent);
  expect(ann.badSent).toBe(3);
  // three rounds, each player one turn a round, the first mover first every round
  const turns = ann.evs.filter(e => e.type === 'turn');
  expect(turns.length).toBe(M3.formats.sprint.rounds * 2);
  const first = ann.evs.find(e => e.type === 'start').first;
  turns.forEach((t, k) => expect(t.seat).toBe(k % 2 === 0 ? first : 1 - first));
  // the bankroll: the winner takes both entries, a draw gives each theirs back
  const won = r.winner === ann.seat, draw = r.winner === -1;
  await until(() => ann.wallet.inPlay === 0 && ann.wallet.bankroll === start + (draw ? 0 : won ? 500 : -500), 10000);

  // the record shows up on the profile and the leaderboard
  let profile = null, board = null;
  ann.ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.e === 'profile') profile = m.data;
    if (m.e === 'leaderboard') board = m.data;
  });
  ann.send({ t: 'profile' });
  ann.send({ t: 'leaderboard' });
  await until(() => profile && board);
  expect(profile.m3.games).toBe(1);
  expect(profile.m3.recent[0].mine).toBe(r.scores[ann.seat]);
  expect(profile.m3.best).toBe(r.scores[ann.seat]);
  expect(board.m3.some(x => x.name === 'Ann')).toBe(true);
  expect(board.m3.some(x => x.bot)).toBe(true);
  expect(board.totals.m3Games).toBeGreaterThan(0);
  ann.ws.close();
}, 150000);

test('two people play a full match against each other while someone watches', async () => {
  const bob = player('Bob', { booster: 'prism' }), cat = player('Cat', { booster: 'hat' });
  await Promise.all([bob.ready, cat.ready]);
  await until(() => bob.wallet && cat.wallet);
  const b0 = bob.wallet.bankroll, c0 = cat.wallet.bankroll;
  const id = await create(bob, { format: 'classic', entry: 100, bot: false, name: 'CI duel' });
  bob.send({ t: 'join', id, sit: true, booster: 'prism' });
  await until(() => bob.seat != null);
  expect(bob.s.phase).toBe('idle');
  expect(bob.s.waiting).toBe('Waiting for an opponent');
  // no moves before the match starts
  bob.send({ t: 'swap', a: 0, b: 1 });
  await until(() => bob.rejects === 1, 5000);

  const eve = player('Eve', { play: false });
  await eve.ready;
  eve.send({ t: 'join', id, sit: false });

  cat.send({ t: 'join', id, sit: true, booster: 'hat' });
  await until(() => cat.seat != null);
  expect(cat.seat).toBe(1 - bob.seat);
  await until(() => bob.wallet.bankroll === b0 - 100 && cat.wallet.bankroll === c0 - 100);

  await until(() => eve.results.length >= 1, 150000);
  const r = eve.results[0];
  expect(bob.results[0]).toEqual(r);
  expect(cat.results[0]).toEqual(r);
  checkScores(eve.evs, r);
  // watchers see every event the players do
  const acts = e => e.filter(x => ['swap', 'boost', 'perk', 'timeout'].includes(x.type)).length;
  expect(acts(eve.evs)).toBe(acts(bob.evs));
  expect(eve.evs.filter(e => e.type === 'turn').length).toBe(M3.formats.classic.rounds * 2);
  // the board the watcher ends on is the players' board
  expect(eve.s.duel.board).toEqual(bob.s.duel.board);
  expect(eve.lines.some(l => /^Match 1/.test(l))).toBe(true);
  expect(eve.lines.some(l => /Round 5 of 5/.test(l))).toBe(true);
  const winner = r.winner === bob.seat ? bob : r.winner === cat.seat ? cat : null;
  if (winner) {
    const loser = winner === bob ? cat : bob;
    await until(() => winner.wallet.bankroll === (winner === bob ? b0 : c0) + 100 && loser.wallet.bankroll === (loser === bob ? b0 : c0) - 100, 10000);
  } else await until(() => bob.wallet.bankroll === b0 && cat.wallet.bankroll === c0, 10000);

  // the next match starts by itself; walking out of it forfeits it
  await until(() => bob.s.matchNo === 2 && bob.s.phase === 'play', 20000);
  bob.play = false;
  bob.send({ t: 'leave' });
  await until(() => cat.results.length >= 2, 10000);
  expect(cat.results[1].kind).toBe('forfeit');
  expect(cat.results[1].winner).toBe(cat.seat);
  for (const p of [bob, cat, eve]) p.ws.close();
}, 200000);

test('a player who stops moving loses the turn to the clock, then the house plays for them', async () => {
  const dan = player('Dan', { play: false });
  await dan.ready;
  const id = await create(dan, { format: 'sprint', entry: 0, bot: true, skill: 'casual' });
  dan.send({ t: 'join', id, sit: true });
  await until(() => dan.seat != null);
  await until(() => dan.evs.filter(e => e.type === 'timeout' && e.seat === dan.seat).length >= 2, 20000);
  expect(dan.events.includes('toast')).toBe(true); // "we're playing for you"
  await until(() => dan.s.seats[dan.seat].away === true, 5000);
  // the house now moves for Dan, and the match still finishes
  await until(() => dan.evs.some(e => e.type === 'swap' && e.seat === dan.seat), 20000);
  await until(() => dan.results.length >= 1, 60000);
  dan.ws.close();
}, 90000);

test('a finished match is settled before the next one can start, even if the table ticks meanwhile', () => {
  const lobby = { changed() {}, pushWallet() {} };
  const t = new M3Table(lobby, { id: 'x', name: 'Unit', format: 'sprint', entry: 0, speed: 'normal', bot: true });
  t.seats[0] = { kind: 'human', name: 'Ivy', id: null, token: 'tok', wins: 0, booster: 'ember', paid: false, connected: true, away: false, timeouts: 0 };
  t.newMatch();
  const d = t.d;
  while (!d.over) d.timeout(d.turn); // straight to the end, as if the last move were still animating
  t.tick(); // the table's two-second tick must not open the next match before this one is settled
  expect(t.settling).toBe(true);
  expect(t.timer).toBe(null);
  expect(t.d).toBe(d);
  // someone sitting down now waits for the result: the bot's match is not theirs
  const wes = { data: { token: 'wes', pid: null, name: 'Wes' }, send() {} };
  t.clients.add(wes);
  expect(t.sit(wes, 1)).toBe(null);
  expect(t.seats[1].kind).toBe('bot');
  expect(t.reservations.map(r => r.name)).toEqual(['Wes']);
  t.matchOver();
  expect(t.result.scores).toEqual(d.scores);
  expect(t.settling).toBe(false);
  t.close();
});

test('a seat-holding bot steps aside for a person between matches; a third person only watches', async () => {
  const fay = player('Fay'), gus = player('Gus');
  await Promise.all([fay.ready, gus.ready]);
  const id = await create(fay, { format: 'sprint', entry: 0, bot: true });
  fay.send({ t: 'join', id, sit: true });
  await until(() => fay.seat != null && fay.s.phase === 'play');
  gus.send({ t: 'join', id, sit: true });
  await until(() => gus.events.includes('pending') || gus.seat != null);
  await until(() => gus.seat != null, 60000);
  await until(() => fay.s.seats.every(s => s && s.kind === 'human'), 10000);
  const hal = player('Hal');
  await hal.ready;
  hal.send({ t: 'join', id, sit: true });
  await until(() => hal.errors.length > 0, 5000);
  expect(hal.errors[0]).toMatch(/Both seats are taken/);
  for (const p of [fay, gus, hal]) p.ws.close();
}, 90000);

test('a duel opened with made-up format, speed and booster names falls back to the real ones', async () => {
  const kit = player('Kit', { play: false });
  await kit.ready;
  const id = await create(kit, { format: 'constructor', speed: '__proto__', entry: 0, bot: true });
  const t = (await (await fetch(`http://localhost:${PORT}/api/tables`)).json()).find(x => x.id === id);
  expect([t.format, t.speed, t.rounds]).toEqual(['classic', 'normal', 5]);
  kit.send({ t: 'join', id, sit: true, booster: 'constructor' });
  await until(() => kit.seat != null);
  expect(kit.s.seats[kit.seat].booster).toBe('ember');
  kit.ws.close();
});
