/* End-to-end backgammon: a real server, scripted players over WebSockets. */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { Turn, BG } from '../shared/backgammon.js';

const PORT = 3990 + Math.floor(Math.random() * 9);
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
 * A scripted backgammon player. With `play` on it answers every decision with a random legal one:
 * rolls (or doubles now and then), moves checker by checker, takes or passes doubles.
 */
function player(name, { play = true, doubleRate = 0.15, takeRate = 0.7, key = crypto.randomUUID() } = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${crypto.randomUUID()}&name=${name}&key=${key}`);
  const me = { ws, name, s: null, seat: null, pending: null, wallet: null, errors: [], events: [], results: [], lines: [], rejects: 0, acted: '' };
  me.ready = new Promise(r => (ws.onopen = r));
  me.send = o => ws.send(JSON.stringify(o));
  const act = () => {
    const s = me.s;
    if (!play || !s || me.seat == null || s.phase === 'over' || s.phase === 'idle') return;
    // one answer per decision point: the server sends several states for the same one
    const sig = `${s.gameNo}:${s.phase}:${s.turn}:${JSON.stringify(s.dice)}:${s.turnState ? s.turnState.moves.length : ''}:${s.offerBy}`;
    if (sig === me.acted) return;
    if (s.phase === 'roll' && s.turn === me.seat) {
      me.acted = sig;
      me.send(s.canDouble && Math.random() < doubleRate ? { t: 'double' } : { t: 'roll' });
    } else if (s.phase === 'double' && s.offerBy === 1 - me.seat) {
      me.acted = sig;
      me.send({ t: Math.random() < takeRate ? 'take' : 'drop' });
    } else if (s.phase === 'move' && s.turn === me.seat && s.turnState) {
      me.acted = sig;
      const t = Turn.restore({ pos: s.pos, seat: me.seat, dice: s.dice, ...s.turnState });
      if (t.done) { me.send({ t: 'done' }); return; }
      // sometimes a whole multi-step move, sometimes one die at a time
      const m = pickOne(t.legal());
      const dests = [...t.destinations(m.from).keys()];
      me.send({ t: 'move', from: m.from, to: Math.random() < 0.3 ? pickOne(dests) : m.to });
    }
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    me.events.push(m.e);
    if (m.e === 'wallet') me.wallet = m.wallet;
    if (m.e === 'error') me.errors.push(m.msg);
    if (m.e === 'bgSnap') { me.s = m.s; me.seat = m.me; me.pending = m.pending; }
    if (m.e === 'bg') {
      me.s = m.s;
      if (m.ev && m.ev.type === 'over') me.results.push(m.ev.result);
      if (m.ev && m.ev.type === 'reject') { me.rejects++; me.acted = ''; }
    }
    if (m.e === 'bgLine' || (m.e === 'bg' && m.line)) me.lines.push((m.line || {}).t);
    if (m.e === 'bgBusted') me.send({ t: 'rebuy' });
    act();
  };
  return me;
}

async function create(by, opts) {
  let id = null;
  by.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') id = m.id; });
  by.send({ t: 'create', opts: { game: 'bg', speed: 'test', ...opts } });
  await until(() => id);
  return id;
}

test('the lobby lists the built-in boards next to the poker tables', async () => {
  const list = await (await fetch(`http://localhost:${PORT}/api/tables`)).json();
  const boards = list.filter(t => t.game === 'bg');
  expect(boards.length).toBeGreaterThanOrEqual(4);
  expect(list.some(t => t.game !== 'bg')).toBe(true);
  const parlor = boards.find(t => t.name === 'The Backgammon Parlor');
  expect(parlor.mode).toBe('money');
  expect(parlor.seats.filter(s => s.kind === 'bot').length).toBe(1);
  expect(parlor.open).toBe(2);
});

test('a person plays money games against a bot, and the bankroll follows every point', async () => {
  const ann = player('Ann');
  await ann.ready;
  await until(() => ann.wallet);
  const start = ann.wallet.bankroll;
  const id = await create(ann, { mode: 'money', stake: 50, bot: true, skill: 'casual' });
  ann.send({ t: 'join', id, sit: true });
  await until(() => ann.seat != null);
  expect(ann.s.seats[1 - ann.seat].kind).toBe('bot');
  const buyIn = 50 * BG.buyInPoints;
  await until(() => ann.wallet.bankroll === start - buyIn);

  await until(() => ann.results.length >= 4, 120000);
  expect(ann.rejects).toBe(0);
  // every game moves points x stake between the seats, never more than the loser has
  for (const r of ann.results) {
    expect(r.points).toBeGreaterThanOrEqual(r.cube);
    expect(r.amount).toBeLessThanOrEqual(r.points * 50);
  }
  // leaving mid-game resigns it, and that game is settled too
  ann.send({ t: 'leave' });
  await until(() => ann.wallet && ann.wallet.inPlay === 0, 10000);
  const settled = ann.results.reduce((a, r) => a + (r.winner === ann.seat ? r.amount : -r.amount), 0);
  expect(ann.wallet.bankroll).toBe(start + settled);
  ann.ws.close();
}, 180000);

test('two people play a match to 3; the winner takes both entries', async () => {
  const bob = player('Bob', { doubleRate: 0.3 }), cat = player('Cat', { doubleRate: 0.3 });
  await Promise.all([bob.ready, cat.ready]);
  await until(() => bob.wallet && cat.wallet);
  const b0 = bob.wallet.bankroll, c0 = cat.wallet.bankroll;
  const id = await create(bob, { mode: 'match', matchTo: 3, entry: 500, bot: false, name: 'CI match' });
  bob.send({ t: 'join', id, sit: true });
  await until(() => bob.seat != null);
  expect(bob.s.phase === 'idle' || bob.s.phase === 'over').toBe(true);
  expect(bob.s.waiting).toBe('Waiting for an opponent');

  // someone watching sees the whole game too (backgammon has no secrets)
  const eve = player('Eve', { play: false });
  await eve.ready;
  eve.send({ t: 'join', id, sit: false });

  cat.send({ t: 'join', id, sit: true });
  await until(() => cat.seat != null);
  expect(cat.seat).toBe(1 - bob.seat);
  await until(() => bob.wallet.bankroll === b0 - 500 && cat.wallet.bankroll === c0 - 500);

  await until(() => bob.results.some(r => r.matchOver), 150000);
  const final = bob.results.find(r => r.matchOver);
  const winner = final.winner === bob.seat ? bob : cat, loser = winner === bob ? cat : bob;
  expect(final.scores[final.winner]).toBeGreaterThanOrEqual(3);
  expect(final.scores[final.loser]).toBeLessThan(3);
  expect(eve.results.filter(r => r.matchOver).length).toBe(1);
  expect(bob.rejects + cat.rejects).toBe(0);
  // the log tells the story move by move
  expect(eve.lines.some(l => /Opening roll/.test(l))).toBe(true);
  expect(eve.lines.some(l => /\d-\d: /.test(l))).toBe(true);

  // a fresh match starts by itself and takes a new entry from each: the winner was paid both entries (+500 net), the loser lost theirs
  await until(() => bob.s.gameNo === 1 && bob.s.phase !== 'over' && !bob.s.matchOver, 20000);
  await until(() => winner.wallet.bankroll === (winner === bob ? b0 : c0) && loser.wallet.bankroll === (loser === bob ? b0 : c0) - 1000, 10000);

  // walking out mid-match forfeits it
  loser.send({ t: 'leave' });
  await until(() => winner.results.some(r => r.kind === 'forfeit'), 10000);
  // two matches won, two entries paid: +1000. The one who walked out paid two entries and won nothing: -1000
  await until(() => winner.wallet.bankroll === (winner === bob ? b0 : c0) + 1000, 10000);
  await until(() => loser.wallet.bankroll === (loser === bob ? b0 : c0) - 1000 && loser.wallet.inPlay === 0, 10000);
  for (const p of [bob, cat, eve]) p.ws.close();
}, 200000);

test('the cube: a double can be taken or passed, and a pass ends the game at the cube value', async () => {
  const dan = player('Dan', { doubleRate: 1, takeRate: 0 }), eli = player('Eli', { doubleRate: 1, takeRate: 0 });
  await Promise.all([dan.ready, eli.ready]);
  const id = await create(dan, { mode: 'money', stake: 10, bot: false });
  dan.send({ t: 'join', id, sit: true });
  eli.send({ t: 'join', id, sit: true });
  await until(() => dan.results.length >= 2, 30000);
  for (const r of dan.results) {
    expect(r.kind).toBe('drop');
    expect(r.points).toBe(1);
    expect(r.amount).toBe(10);
  }
  // the record shows up on the profile and the leaderboard
  let profile = null, board = null;
  dan.ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.e === 'profile') profile = m.data;
    if (m.e === 'leaderboard') board = m.data;
  });
  dan.send({ t: 'profile' });
  dan.send({ t: 'leaderboard' });
  await until(() => profile && board);
  expect(profile.bg.games).toBeGreaterThanOrEqual(2);
  expect(profile.bg.recent.length).toBe(profile.bg.games);
  expect(profile.bg.recent[0].opponent).toBe('Eli');
  expect(board.bg.some(r => r.name === 'Dan' || r.name === 'Eli')).toBe(true);
  expect(board.totals.bgGames).toBeGreaterThan(0);
  for (const p of [dan, eli]) p.ws.close();
}, 60000);

test('a seat-holding bot steps aside for a person between games', async () => {
  const fay = player('Fay'), gus = player('Gus');
  await Promise.all([fay.ready, gus.ready]);
  const id = await create(fay, { mode: 'money', stake: 10, bot: true, skill: 'sharp' });
  fay.send({ t: 'join', id, sit: true });
  await until(() => fay.seat != null && fay.s.phase !== 'idle');
  gus.send({ t: 'join', id, sit: true });
  await until(() => gus.pending != null || gus.seat != null || gus.events.includes('pending'));
  await until(() => gus.seat != null, 60000);
  await until(() => fay.s.seats.every(s => s && s.kind === 'human'), 10000);
  // a third person can only watch
  const hal = player('Hal');
  await hal.ready;
  hal.send({ t: 'join', id, sit: true });
  await until(() => hal.errors.length > 0, 5000);
  expect(hal.errors[0]).toMatch(/Both seats are taken/);
  for (const p of [fay, gus, hal]) p.ws.close();
}, 90000);
