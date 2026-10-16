/* The bots: legal decisions, speed, sensible results, reads and table talk. */
import { test, expect } from 'bun:test';
import { PROFILES, HandEval } from '../shared/engine.js';
import { Game, Player, HandLog } from '../server/game.js';
import { BotBrain, TableReads, PCT, classOf } from '../server/bots.js';

const noop = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => Promise.resolve()) });
const C = s => '23456789TJQKA'.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const ALL = Object.keys(PROFILES);

/** A headless six-max game of bots. `reload` keeps everyone in chips. */
function table(keys, { stakes, stack, skill = 0.7, tournament = false, reload = true } = {}) {
  const g = new Game({
    view: noop, log: new HandLog(), settings: { speed: 'turbo', tournament }, headless: true, stakes,
    panel: { beforeHand: async g => {
      if (reload) for (const p of g.players) if (p.isBot && p.stack < g.bb) { p.stack += g.buyIn; p.buyIns += g.buyIn; }
      if (g.players.filter(p => p.stack > 0).length >= 2) return true;
      g.stop();
      return false;
    } },
  });
  g.players = keys.map((k, i) => (k ? new Player(i, PROFILES[k].name, stack ?? g.buyIn, { profile: k, skill }) : Player.empty(i)));
  return g;
}

/** Wraps every bot's decide(): checks legality and times it. */
function watch(g) {
  const w = { calls: 0, ms: 0, illegal: [] };
  for (const p of g.players) {
    if (!p.brain) continue;
    const d = p.brain.decide.bind(p.brain);
    p.brain.decide = c => {
      const t0 = performance.now();
      const a = d(c);
      w.ms += performance.now() - t0; w.calls++;
      const ok = a && (
        (a.type === 'fold' && !c.canCheck) || (a.type === 'check' && c.canCheck) || (a.type === 'call' && !c.canCheck)
        || (a.type === 'raise' && c.canRaise && Number.isInteger(a.to) && a.to >= c.minTo && a.to <= c.maxTo));
      if (!ok) w.illegal.push({ a, c: { street: c.street, toCall: c.toCall, canCheck: c.canCheck, canRaise: c.canRaise, minTo: c.minTo, maxTo: c.maxTo } });
      return a;
    };
  }
  return w;
}

test('preflop ranking puts the classics in order', () => {
  const pct = s => { const [a, b] = s.split(' ').map(C); return PCT[classOf(a, b)]; };
  expect(pct('As Ah')).toBe(0);
  expect(pct('Ks Kh')).toBeLessThan(pct('Ah Kh'));
  expect(pct('Ah Kh')).toBeLessThan(pct('As Kd'));
  expect(pct('As Kd')).toBeLessThan(pct('Js Th'));
  expect(pct('Tc 9c')).toBeLessThan(pct('Tc 9d'));
  expect(pct('7s 2d')).toBeGreaterThan(0.9);
  expect(classOf(C('Ah'), C('Kh'))).not.toBe(classOf(C('Ah'), C('Kd')));
});

test('all nine bots: 2000 hands with random stacks, only legal moves, fast, no chip drift', async () => {
  const lineups = [ALL.slice(0, 6), [ALL[5], ALL[6], null, ALL[7], ALL[8], ALL[0]], ALL.slice(3, 9)];
  let drift = 0, hands = 0;
  const w0 = { calls: 0, ms: 0, illegal: [] };
  for (const [li, keys] of lineups.entries()) {
    const g = table(keys, { skill: [0.35, 0.7, 1][li] });
    // uneven stacks: short, deep and in between
    g.players.forEach(p => { if (!p.isEmpty) { p.stack = [12, 40, 100, 180, 300, 25][p.seat] * g.bb; p.buyIns = p.stack; } });
    const w = watch(g);
    const fin = g.finishHand.bind(g);
    g.finishHand = () => { fin(); if (g.totalChips() !== g.totalBuyIns()) drift++; };
    await g.run(700);
    hands += g.handNo;
    w0.calls += w.calls; w0.ms += w.ms; w0.illegal.push(...w.illegal);
  }
  expect(hands).toBe(2100);
  expect(drift).toBe(0);
  expect(w0.illegal).toEqual([]);
  expect(w0.ms / w0.calls).toBeLessThan(15);
}, 60000);

test('tournament stacks: push-fold play is legal and the game ends', async () => {
  const g = table(['pro', 'nit', 'tourist', 'maniac', 'trapper', 'station'], { stakes: { sb: 50, bb: 100 }, stack: 1500, tournament: true, reload: false });
  const w = watch(g);
  await g.run(600);
  expect(w.illegal).toEqual([]);
  expect(g.players.filter(p => p.stack > 0).length).toBeLessThanOrEqual(6);
  expect(g.totalChips()).toBe(9000);
}, 30000);

test('good players beat bad ones over 6000 hands', async () => {
  // everyone starts every hand 100 BB deep (results are tallied), which keeps the variance sane
  const g = new Game({
    view: noop, log: new HandLog(), settings: { speed: 'turbo' }, headless: true,
    panel: { beforeHand: async g => { for (const p of g.players) { p.tally = (p.tally || 0) + p.stack - g.buyIn; p.stack = g.buyIn; p.buyIns = g.buyIn; } return true; } },
  });
  g.players = ['pro', 'shark', 'station', 'tourist', 'maniac', 'nit'].map((k, i) => new Player(i, k, g.buyIn, { profile: k, skill: 0.8 }));
  await g.run(6000);
  const net = k => { const p = g.players.find(q => q.profileKey === k); return p.tally + p.stack - g.buyIn; };
  // single players swing by tens of big blinds per 100 even over thousands of hands; groups are steadier
  const good = (net('pro') + net('shark') + net('nit')) / 3, bad = (net('station') + net('tourist')) / 2;
  expect(good).toBeGreaterThan(bad);
}, 90000);

test('reads: counts accumulate, shrink toward priors, and survive dump/load', async () => {
  const g = table(['station', 'nit', 'shark', 'maniac', 'rock', 'tourist']);
  await g.run(400);
  const st = g.reads.get('bot:station'), nit = g.reads.get('bot:nit'), man = g.reads.get('bot:maniac');
  expect(st.hands).toBe(400);
  expect(st.vpip).toBeGreaterThan(nit.vpip + 0.15);
  expect(man.af).toBeGreaterThan(st.af);
  for (const k of ['vpip', 'pfr', 'threeBet', 'cbet', 'foldToCbet', 'wtsd', 'wsd']) { expect(st[k]).toBeGreaterThanOrEqual(0); expect(st[k]).toBeLessThanOrEqual(1); }
  const saved = JSON.parse(JSON.stringify(g.reads.dump('bot:station')));
  const r2 = new TableReads();
  r2.load('human:x', saved);
  expect(r2.get('human:x').vpip).toBeCloseTo(st.vpip, 10);
  r2.load('y', { n: saved }); // a full stats object loads too
  expect(r2.get('y').hands).toBe(400);
  // a tiny sample stays near the population average
  const r3 = new TableReads();
  r3.load('z', { h: 3, vp: 3, pf: 3 });
  expect(r3.get('z').vpip).toBeLessThan(0.5);
  expect(r3.get('nobody')).toBe(null);
}, 30000);

test('table talk: every bot has a voice, lines are clean, and it is rate limited', () => {
  const evts = [
    { type: 'handEnd', bb: 2, pot: 400, delta: 200, won: true, showdown: true, myHand: 'Two pair', myCat: 2, winners: [{ name: 'Me', cat: 2 }], busted: [], iBusted: false },
    { type: 'handEnd', bb: 2, pot: 400, delta: -200, won: false, showdown: true, myHand: 'Flush', myCat: 5, winners: [{ name: 'Ann', cat: 6 }], busted: [], iBusted: false },
    { type: 'handEnd', bb: 2, pot: 400, delta: 200, won: true, showdown: true, myHand: 'Flush', myCat: 5, winners: [{ name: 'Me', cat: 5 }], busted: ['Ann'], iBusted: false },
    { type: 'handEnd', bb: 2, pot: 400, delta: -200, won: false, showdown: true, myHand: 'Pair', myCat: 1, winners: [{ name: 'Ann', cat: 2 }], busted: [], iBusted: true },
    { type: 'greet', name: 'Ann' },
  ];
  for (const k of ALL) {
    const b = new BotBrain(k, 0.7);
    const said = [];
    for (let i = 0; i < 400; i++) {
      b.afterHand({ delta: 0, bb: 2 });
      const t = b.react(evts[i % evts.length]);
      if (t) said.push(t);
    }
    expect(said.length).toBeGreaterThan(3);
    expect(said.length).toBeLessThan(200);
    for (const t of said) { expect(t.length).toBeLessThanOrEqual(90); expect(/[<>{}%]/.test(t)).toBe(false); }
  }
  // quiet hands produce no talk
  const b = new BotBrain('tourist');
  let n = 0;
  for (let i = 0; i < 200; i++) { b.afterHand({ delta: 0, bb: 2 }); if (b.react({ type: 'handEnd', bb: 2, pot: 6, delta: 0, won: false, showdown: false, myCat: -1, winners: [], busted: [] })) n++; }
  expect(n).toBe(0);
});

test('tilt: the gambler steams after a bad beat and cools off', () => {
  const b = new BotBrain('gambler');
  b.afterHand({ delta: -120, bb: 2, showdown: true, won: false, score: HandEval.score([C('As'), C('Ks'), C('Qs'), C('Js'), C('9s')]) });
  expect(b.tilt).toBeGreaterThanOrEqual(0.3);
  for (let i = 0; i < 40; i++) b.afterHand({ delta: 0, bb: 2 });
  expect(b.tilt).toBe(0);
  const pro = new BotBrain('pro');
  pro.afterHand({ delta: -120, bb: 2 });
  expect(pro.tilt).toBeLessThan(0.05);
});
