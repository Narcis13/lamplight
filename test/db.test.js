import { test, expect } from 'bun:test';
import { DB, START_BANKROLL } from '../server/db.js';

const C = s => '23456789TJQKA'.indexOf(s[0]) * 4 + 'shdc'.indexOf(s[1]);
const H = str => str.split(' ').map(C);
import { HandEval } from '../shared/engine.js';

/** A minimal two-player hand record, as Game produces it. */
function rec({ holeA, holeB, board, winner = 0, pot = 100, bb = 2, showdown = true, riverBet = false }) {
  const a = H(holeA), b = H(holeB), bd = H(board);
  const scores = showdown ? { 0: HandEval.score(a.concat(bd)), 1: HandEval.score(b.concat(bd)) } : undefined;
  return {
    no: 1, startedAt: Date.now(), endedAt: Date.now(), sb: bb / 2, bb, button: 0, sbI: 0, bbI: 1,
    seats: [
      { seat: 0, id: 'pA', name: 'Ann', kind: 'human', profile: null, stack: 200, pos: 'SB' },
      { seat: 1, id: 'bot:shark', name: 'Viktor', kind: 'bot', profile: 'shark', stack: 200, pos: 'BB' },
    ],
    hole: { 0: a, 1: b },
    events: [
      { k: 'blind', s: 0, a: 1 }, { k: 'blind', s: 1, a: 2 },
      { k: 'act', s: 0, type: 'raise', to: 6, paid: 5, allIn: false, street: 'preflop' },
      { k: 'act', s: 1, type: 'call', to: 6, paid: 4, allIn: false, street: 'preflop' },
      ...(riverBet ? [{ k: 'act', s: 0, type: 'bet', to: 50, paid: 50, allIn: false, street: 'river' }, { k: 'act', s: 1, type: 'fold', to: 0, paid: 0, allIn: false, street: 'river' }] : []),
    ],
    board: bd, pots: [{ amount: pot, winners: [winner], label: 'the pot', score: showdown ? scores[winner] : null }],
    shown: showdown ? [0, 1] : [], end: winner === 0 ? { 0: 200 + pot / 2, 1: 200 - pot / 2 } : { 0: 200 - pot / 2, 1: 200 + pot / 2 },
    scores, potTotal: pot,
  };
}
const meta = { tableId: 't1', tableName: 'Test', mode: 'cash' };

test('accounts start with a bankroll; buy-ins go to escrow and come back after a crash', () => {
  const db = new DB(':memory:');
  db.account('pA', 'Ann');
  expect(db.wallet('pA').bankroll).toBe(START_BANKROLL);
  expect(db.buyIn('pA', 't1', 200)).toBe(true);
  expect(db.buyIn('pA', 't1', START_BANKROLL)).toBe(false);
  db.checkpoint('pA', 't1', 340);
  expect(db.wallet('pA')).toMatchObject({ bankroll: START_BANKROLL - 200, inPlay: 340 });
  expect(db.recover()).toBe(1);
  expect(db.wallet('pA')).toMatchObject({ bankroll: START_BANKROLL + 140, inPlay: 0 });
  db.buyIn('pA', 't1', 200);
  db.cashOut('pA', 't1', 50);
  expect(db.wallet('pA')).toMatchObject({ bankroll: START_BANKROLL - 10, inPlay: 0 });
});

test('the daily bonus pays once, and free chips are only for empty bankrolls', () => {
  const db = new DB(':memory:');
  db.account('pA', 'Ann');
  expect(db.wallet('pA').bonus.ready).toBe(true);
  const b = db.claimBonus('pA');
  expect(b.amount).toBeGreaterThan(0);
  expect(db.claimBonus('pA')).toBe(null);
  expect(db.refill('pA')).toBe(null);
  db.buyIn('pA', 't1', db.wallet('pA').bankroll - 20);
  db.cashOut('pA', 't1', 0);
  expect(db.wallet('pA').refill).toBe(true);
  expect(db.refill('pA').amount).toBeGreaterThan(0);
  expect(db.wallet('pA').refill).toBe(false);
});

test('hands are saved with stats and unlock the right achievements', () => {
  const db = new DB(':memory:');
  db.account('pA', 'Ann');
  // a royal flush that busts the shark, in a 100 BB+ pot
  const r = rec({ holeA: 'As Ks', holeB: 'Qd Qc', board: 'Qs Js Ts 2d 3c', pot: 400 });
  r.end[1] = 0;
  const { id, unlocked } = db.recordHand(r, meta);
  const keys = unlocked.map(u => u.key).sort();
  expect(keys).toEqual(['big_pot', 'double_up', 'first_pot', 'royal', 'shark_hunter'].sort()); // 200 to 400 doubles the stack too
  const p = db.profile('pA');
  expect(p.stats).toMatchObject({ hands: 1, vpip: 1, pfr: 1, potsWon: 1, showdowns: 1, showdownsWon: 1, net: 200 });
  expect(p.stats.bestHand).toBe('Royal flush');
  expect(p.recent[0].id).toBe(id);
  expect(p.graph).toEqual([200]);
  // the same achievement never unlocks twice
  expect(db.recordHand(rec({ holeA: 'As Ks', holeB: 'Qd Qc', board: 'Qs Js Ts 2d 3c' }), meta).unlocked.map(u => u.key)).not.toContain('royal');
  // a river bet that takes it down, and losing a showdown with aces
  expect(db.recordHand(rec({ holeA: '7h 2c', holeB: 'Qd Qc', board: '3s 8s Ts 4d 5c', showdown: false, riverBet: true }), meta).unlocked.map(u => u.key).sort()).toEqual(['bluff', 'hammer']);
  expect(db.recordHand(rec({ holeA: 'Ah Ad', holeB: 'Qd Qc', board: 'Qs 8s Ts 4d 5c', winner: 1 }), meta).unlocked.map(u => u.key)).toContain('cracked');
  const lb = db.leaderboard();
  expect(lb.winners[0].id).toBe('pA');
  expect(lb.bots.find(b => b.key === 'shark').busted).toBe(1);
});

test('replays hide cards nobody showed', () => {
  const db = new DB(':memory:');
  db.account('pA', 'Ann');
  const r = rec({ holeA: '7h 2c', holeB: 'Qd Qc', board: '3s 8s Ts 4d 5c', showdown: false, riverBet: true });
  const { id } = db.recordHand(r, meta);
  expect(Object.keys(db.hand(id, 'pA').hole)).toEqual(['0']);
  expect(Object.keys(db.hand(id, 'someone-else').hole)).toEqual([]);
  db.markShown(id, 1);
  expect(Object.keys(db.hand(id, 'someone-else').hole)).toEqual(['1']);
});
