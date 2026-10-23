/* End-to-end: a real server, scripted WebSocket players, a full 6-seat table. */
import { test, expect, beforeAll, afterAll } from 'bun:test';

const PORT = 3900 + Math.floor(Math.random() * 90);
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

/** A scripted player: joins, sits, answers every prompt with a random legal action. */
function player(name, { onEvent = () => {}, token = crypto.randomUUID(), key = '', decide = null, rit = null, silent = false } = {}) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${token}&name=${name}${key ? `&key=${key}` : ''}`);
  const me = { ws, name, token, events: [], msgs: {}, state: null, seat: null, prompts: 0, errors: [], hole: [], wallet: null };
  me.ready = new Promise(r => (ws.onopen = r));
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    me.events.push(m.e);
    me.msgs[m.e] = m;
    if (m.s) me.state = m.s;
    if (m.e === 'wallet') me.wallet = m.wallet;
    if (m.e === 'snap') { me.seat = m.me; me.hole = m.hole; }
    if (m.e === 'dealHole' && m.c != null) me.hole.push(m.c);
    if (m.e === 'newHand') me.hole = [];
    if (m.e === 'error') me.errors.push(m.msg);
    if (m.e === 'busted') ws.send(JSON.stringify({ t: 'rebuy' }));
    if (m.e === 'ritAsk' && rit != null) ws.send(JSON.stringify({ t: 'rit', id: m.id, yes: rit }));
    if (m.e === 'yourTurn' && silent) me.prompts++;
    if (m.e === 'yourTurn' && decide) { me.prompts++; ws.send(JSON.stringify({ t: 'act', id: m.id, a: decide(m.L) })); }
    if (m.e === 'yourTurn' && !decide && !silent) {
      me.prompts++;
      const L = m.L, r = Math.random();
      const a = r < 0.15 && !L.canCheck ? { type: 'fold' }
        : r < 0.35 && L.canRaise ? { type: 'raise', to: L.minTo + Math.floor(Math.random() * (L.maxTo - L.minTo + 1)) }
        : { type: L.canCheck ? 'check' : 'call' };
      ws.send(JSON.stringify({ t: 'act', id: m.id, a }));
    }
    onEvent(m, me);
  };
  me.send = o => ws.send(JSON.stringify(o));
  return me;
}
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await Bun.sleep(20); }
};

test('two people and four bots play a six-handed table over the network', async () => {
  const alice = player('Alice');
  await alice.ready;
  let tableId;
  alice.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') tableId = m.id; });
  alice.send({ t: 'create', opts: { name: 'CI table', speed: 'test', fillBots: true } });
  await until(() => tableId);
  alice.send({ t: 'join', id: tableId, sit: true });
  await until(() => alice.seat != null);

  // someone watching sees only backs, never other people's cards
  const eve = player('Eve');
  await eve.ready;
  let leaked = 0;
  eve.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'dealHole' && m.c != null) leaked++; });
  eve.send({ t: 'join', id: tableId, sit: false });

  const bob = player('Bob');
  await bob.ready;
  bob.send({ t: 'join', id: tableId, sit: true });
  await until(() => bob.seat != null);
  expect(bob.seat).not.toBe(alice.seat);

  await until(() => alice.state && alice.state.handNo >= 60, 60000);
  const s = alice.state;
  const kinds = s.players.map(p => p.kind).sort();
  expect(kinds).toEqual(['bot', 'bot', 'bot', 'bot', 'human', 'human']);
  // chips are conserved: everything on the table, plus what departed players took with them, equals everything bought in
  await until(() => alice.state.street === 'done');
  const st = alice.state;
  const chips = st.players.reduce((a, p) => a + p.stack + p.total, 0);
  const buyIns = st.players.reduce((a, p) => a + p.buyIns, 0);
  expect(chips + st.departed).toBe(buyIns);
  expect(alice.prompts).toBeGreaterThan(10);
  expect(bob.prompts).toBeGreaterThan(10);
  expect(leaked).toBe(0);
  expect(alice.errors).toEqual([]);

  // Bob drops and comes back with the same token: same seat
  const seat = bob.seat;
  bob.ws.close();
  await Bun.sleep(200);
  const bob2 = player('Bob', { token: bob.token });
  await bob2.ready;
  bob2.send({ t: 'join', id: tableId, sit: true });
  await until(() => bob2.seat != null);
  expect(bob2.seat).toBe(seat);

  // Alice leaves: a bot takes her seat back between hands
  alice.send({ t: 'leave' });
  await until(() => bob2.state && bob2.state.players[alice.seat].kind === 'bot', 20000);

  for (const c of [alice, bob2, eve]) c.ws.close();
}, 90000);

test('a table of six people: every seat human, a seventh can only watch', async () => {
  const ps = [];
  let tableId;
  const host = player('Host');
  await host.ready;
  host.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') tableId = m.id; });
  host.send({ t: 'create', opts: { name: 'Full house', speed: 'test', fillBots: false } });
  await until(() => tableId);
  ps.push(host);
  for (let i = 1; i < 6; i++) { const p = player('P' + i); await p.ready; ps.push(p); }
  for (const p of ps) p.send({ t: 'join', id: tableId, sit: true });
  await until(() => ps.every(p => p.seat != null));
  expect(new Set(ps.map(p => p.seat)).size).toBe(6);

  const seventh = player('Late');
  await seventh.ready;
  seventh.send({ t: 'join', id: tableId, sit: true });
  await until(() => seventh.errors.length > 0);
  expect(seventh.seat).toBe(null);

  await until(() => host.state && host.state.handNo >= 25, 60000);
  await until(() => host.state.street === 'done');
  const st = host.state;
  expect(st.players.every(p => p.kind === 'human')).toBe(true);
  expect(st.players.reduce((a, p) => a + p.stack + p.total, 0) + st.departed).toBe(st.players.reduce((a, p) => a + p.buyIns, 0));
  for (const p of [...ps, seventh]) p.ws.close();
}, 90000);

test('bankroll, saved hands, profile and replays', async () => {
  const key = crypto.randomUUID();
  const zoe = player('Zoe', { key });
  await zoe.ready;
  await until(() => zoe.wallet);
  const start = zoe.wallet.bankroll;
  expect(start).toBeGreaterThan(0);
  let tableId;
  zoe.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') tableId = m.id; });
  zoe.send({ t: 'create', opts: { name: 'Bank', speed: 'test', stakes: 'low', buyInBB: 100 } });
  await until(() => tableId);
  zoe.send({ t: 'join', id: tableId, sit: true });
  await until(() => zoe.seat != null);
  // the $1,000 buy-in (100 BB at $5/$10) left the bankroll
  await until(() => zoe.wallet.bankroll === start - 1000 && zoe.wallet.inPlay === 1000);
  await until(() => zoe.msgs.handSaved && zoe.state.handNo >= 8, 30000);

  // a saved hand can be replayed, and only cards that were shown (or were mine) come back
  zoe.send({ t: 'hand', id: zoe.msgs.handSaved.id });
  await until(() => zoe.msgs.hand);
  const h = zoe.msgs.hand.data;
  expect(h.seats.length).toBeGreaterThan(1);
  expect(h.mine).toBe(zoe.seat);
  for (const seat of Object.keys(h.hole)) expect(h.shown.includes(+seat) || +seat === zoe.seat).toBe(true);

  zoe.send({ t: 'profile' });
  await until(() => zoe.msgs.profile);
  const prof = zoe.msgs.profile.data;
  expect(prof.stats.hands).toBeGreaterThan(0);
  expect(prof.recent.length).toBeGreaterThan(0);

  // leaving cashes the stack out: bankroll is whole again, minus or plus the session
  zoe.send({ t: 'leave' });
  await until(() => zoe.wallet.inPlay === 0, 20000);
  zoe.send({ t: 'profile' });
  await Bun.sleep(100);
  expect(zoe.wallet.bankroll).toBe(start + zoe.msgs.profile.data.stats.net);

  const lb = await (await fetch(`http://localhost:${PORT}/api/leaderboard`)).json();
  expect(lb.totals.hands).toBeGreaterThan(0);
  zoe.ws.close();
}, 60000);

test('a sit & go runs to a winner and pays the top two', async () => {
  const key = crypto.randomUUID();
  const sam = player('Sam', { key });
  await sam.ready;
  await until(() => sam.wallet);
  const start = sam.wallet.bankroll;
  let tableId;
  sam.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') tableId = m.id; });
  sam.send({ t: 'create', opts: { name: 'SNG', mode: 'sng', speed: 'test', sngBuyIn: 100 } });
  await until(() => tableId);
  sam.send({ t: 'join', id: tableId, sit: true });
  await until(() => sam.seat != null);
  await until(() => sam.wallet.bankroll === start - 100);
  sam.send({ t: 'start' });
  await until(() => sam.msgs.tourneyStart);
  expect(sam.msgs.tourneyStart.s.players.every(p => p.kind !== 'empty' && p.stack === 1500)).toBe(true);
  await until(() => sam.msgs.tourneyOver, 120000);
  const res = sam.msgs.tourneyOver.results;
  expect(res.length).toBe(6);
  expect(res.map(r => r.place).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  expect(res.reduce((a, r) => a + r.prize, 0)).toBe(600);
  const mine = res.find(r => r.name === 'Sam');
  await Bun.sleep(200);
  expect(sam.wallet.bankroll).toBe(start - 100 + mine.prize);
  expect(sam.wallet.inPlay).toBe(0);
  sam.ws.close();
}, 150000);

test('run it twice over the network, and the time bank before a timeout', async () => {
  const shove = L => (L.canRaise ? { type: 'raise', to: L.maxTo } : { type: L.canCheck ? 'check' : 'call' });
  const a = player('Ada', { decide: shove, rit: true });
  await a.ready;
  let tableId, rit = 0, board2 = null;
  a.ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.e === 'created') tableId = m.id;
    if (m.e === 'rit') rit++;
    if (m.e === 'board' && m.run === 2) board2 = m.s.board2;
  });
  a.send({ t: 'create', opts: { name: 'Twice', speed: 'test', fillBots: false } });
  await until(() => tableId);
  a.send({ t: 'join', id: tableId, sit: true });
  const b = player('Bo', { decide: shove, rit: true });
  await b.ready;
  b.send({ t: 'join', id: tableId, sit: true });
  await until(() => rit >= 3 && board2 && board2.length === 5, 30000);
  await until(() => a.state.street === 'done');
  const st = a.state;
  expect(st.players.reduce((x, p) => x + p.stack + p.total, 0) + st.departed).toBe(st.players.reduce((x, p) => x + p.buyIns, 0));
  a.ws.close(); b.ws.close();

  // someone who stops answering: the clock runs out, the time bank kicks in, then they're folded and sat out
  const c = player('Cy', { silent: true });
  const d = player('Di');
  await c.ready; await d.ready;
  let tid2;
  c.ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.e === 'created') tid2 = m.id; });
  c.send({ t: 'create', opts: { name: 'Clock', speed: 'test', fillBots: false } });
  await until(() => tid2);
  c.send({ t: 'join', id: tid2, sit: true });
  d.send({ t: 'join', id: tid2, sit: true });
  await until(() => c.msgs.timeBank, 20000);
  expect(c.msgs.timeBank.ms).toBe(300);
  await until(() => c.msgs.away, 20000);
  const me = c.state.players.find(p => p.name === 'Cy');
  expect(me.timeBank).toBe(0);
  c.ws.close(); d.ws.close();
}, 90000);

test("speeds and stakes named after JavaScript's own keys fall back to the defaults", async () => {
  const kit = player('Kit', { silent: true });
  await kit.ready;
  const ids = [];
  for (const k of ['constructor', '__proto__', 'toString']) {
    let id = null;
    const onCreated = ev => { const m = JSON.parse(ev.data); if (m.e === 'created') id = m.id; };
    kit.ws.addEventListener('message', onCreated);
    kit.send({ t: 'create', opts: { name: `Odd ${k}`, speed: k, stakes: k, fillBots: false } });
    await until(() => id);
    kit.ws.removeEventListener('message', onCreated);
    ids.push(id);
  }
  const list = await (await fetch(`http://localhost:${PORT}/api/tables`)).json();
  for (const id of ids) {
    const t = list.find(x => x.id === id);
    expect(t.speed).toBe('normal');
    expect(t.stakesKey).toBe('micro');
    expect(t.bb).toBe(2);
  }
  kit.ws.close();
});
