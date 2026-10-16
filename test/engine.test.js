import { test, expect } from 'bun:test';
import { Cards, HandEval, Strength, Equity, PotManager } from '../shared/engine.js';
import { Game, Player, HandLog } from '../server/game.js';

const C = s => '23456789TJQKA'.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const H = str => str.split(' ').map(C);
const d = str => HandEval.describe(HandEval.score(H(str)));

test('hand evaluator', () => {
  expect(d('As Ks Qs Js Ts 2d 3c')).toBe('Royal flush');
  expect(d('5h 4h 3h 2h Ah Kd Kc')).toBe('Straight flush, five high');
  expect(d('9c 9d 9h 9s 2c 3d Kh')).toBe('Four nines');
  expect(d('Kc Kd Kh 4s 4c 4d 2h')).toBe('Kings full of fours');
  expect(d('Ac 3c 7c 9c Jc Kd Qh')).toBe('Flush, ace high');
  expect(d('Ad 2c 3h 4s 5d Kc Qh')).toBe('Straight, five high');
  expect(d('Ac Ad Kh Ks 2d 2c 9h')).toBe('Two pair, aces and kings');
  expect(d('2h 3h 4h 5h 6h 9h Kh')).toBe('Straight flush, six high');
  expect(HandEval.score(H('Ac Ad Kh Ks 2d 2c 9h'))).toBeGreaterThan(HandEval.score(H('Ac Ad Kh Ks 2d 3c 8h')));
  expect(Strength.chen(C('As'), C('Ah'))).toBe(20);
  expect(Strength.chen(C('7s'), C('2h'))).toBe(-1);
});

test('equity and pots', () => {
  const [aa] = Equity.known([H('As Ah'), H('Ks Kh')], []);
  expect(aa).toBeGreaterThan(0.77); expect(aa).toBeLessThan(0.87);
  const P = (seat, total, folded = false) => ({ seat, total, active: !folded });
  const pots = PotManager.build([P(0, 50), P(1, 200), P(2, 200), P(3, 20, true), P(4, 0, true), P(5, 300)]);
  expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(770);
  expect(pots[0].eligible).toEqual([0, 1, 2, 5]);
});

test('headless table: 1500 bot hands with empty seats, no chip drift', async () => {
  const noop = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => Promise.resolve()) });
  const g = new Game({ view: noop, log: new HandLog(), settings: { speed: 'turbo' }, headless: true,
    panel: { beforeHand: async g => {
      for (const p of g.players) if (p.isBot && p.stack < g.bb) { p.stack += g.buyIn; p.buyIns += g.buyIn; }
      return true;
    } } });
  g.players = ['rock', 'shark', null, 'maniac', 'station', null].map((k, i) => k ? new Player(i, k, g.buyIn, { profile: k }) : Player.empty(i));
  let drift = 0;
  const fin = g.finishHand.bind(g);
  g.finishHand = () => { fin(); if (g.totalChips() !== g.totalBuyIns()) drift++; };
  await g.run(1500);
  expect(g.handNo).toBe(1500);
  expect(drift).toBe(0);
  expect(g.players[2].stats.hands).toBe(0);
});

test('run it twice: two boards from one deck, each pot split in half, no chips lost', async () => {
  const noop = new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : () => Promise.resolve()) });
  let rits = 0, bad = [];
  const g = new Game({ view: noop, log: new HandLog(), settings: { speed: 'turbo', runTwice: true }, headless: true,
    panel: {
      beforeHand: async g => { for (const p of g.players) if (!p.isEmpty && p.stack < g.bb) { p.stack += g.buyIn; p.buyIns += g.buyIn; } return true; },
      // everyone shoves or calls: plenty of all-ins before the river
      ask: async (p, L) => (L.canRaise ? { type: 'raise', to: L.maxTo } : { type: L.canCheck ? 'check' : 'call' }),
      askRunTwice: async () => true,
    } });
  g.players = [0, 1, 2, 3, 4, 5].map(i => (i < 3 ? new Player(i, 'H' + i, g.buyIn, { kind: 'human' }) : Player.empty(i)));
  const fin = g.finishHand.bind(g);
  g.finishHand = () => {
    const pot = g.rec.pots.reduce((s, x) => s + x.amount, 0);
    fin();
    if (g.totalChips() !== g.totalBuyIns()) bad.push('drift');
    const r = g.rec;
    if (!r.rit) return;
    rits++;
    const b1 = r.board, b2 = r.board2;
    if (b1.length !== 5 || b2.length !== 5) bad.push('short board');
    if (b1.slice(0, r.ritFrom).join() !== b2.slice(0, r.ritFrom).join()) bad.push('shared cards differ');
    const all = [...b1, ...b2.slice(r.ritFrom), ...Object.values(r.hole).flat()];
    if (new Set(all).size !== all.length) bad.push('duplicate card');
    const run1 = r.pots.filter(x => x.run === 1).reduce((s, x) => s + x.amount, 0);
    const run2 = r.pots.filter(x => x.run === 2).reduce((s, x) => s + x.amount, 0);
    if (run1 + run2 !== pot || run1 - run2 > r.pots.filter(x => x.run === 1).length || run1 < run2) bad.push('bad split');
  };
  await g.run(300);
  expect(bad).toEqual([]);
  expect(rits).toBeGreaterThan(50);
});
