import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExplosiveMove, signalTimeline, followTrailing, studySummary } from '../src/analysis/history.js';

// 5-minute candles: quiet base around $0.00001, breakout at t=3000, 10x peak at t=4800, fade.
const prices = [1, 1, 0.9, 1, 1.1, 1, 1.2, 1.1, 1, 1.1, 2.2, 3.5, 5, 7, 8.5, 10, 8, 6, 5, 4];
const vols = [5, 4, 6, 5, 5, 4, 6, 5, 30, 40, 80, 120, 150, 140, 160, 170, 90, 70, 50, 40];
const candles = prices.map((p, i) => ({ t: i * 300, open: p * 1e-5, close: p * 1e-5, high: p * 1e-5, low: p * 1e-5, volumeUsd: vols[i] }));

test('findExplosiveMove finds the base, the breakout and the peak of the biggest run', () => {
  const m = findExplosiveMove(candles, 300, { minMultiple: 7 });
  assert.ok(m);
  assert.equal(m.baseTs, 600, 'lowest point before the run');
  assert.equal(m.peakTs, 4500);
  assert.ok(Math.abs(m.multiple - 10 / 0.9) < 1e-9);
  assert.equal(m.breakoutTs, 3000, 'first candle at 2x the base: the move became visible');
  assert.equal(findExplosiveMove(candles.slice(0, 9), 300, { minMultiple: 7 }), null, 'no 7x in a flat chart');
});

test('followTrailing rides the move and sells after a 30% drop from the high', () => {
  const r = followTrailing(candles, 300, { entryTs: 3300, trailPct: 0.3 });
  assert.ok(Math.abs(r.entryPrice - 3.5e-5) < 1e-12);
  assert.equal(r.exitTs, 5100, 'sold on the first close 30% under the 10x high');
  assert.ok(Math.abs(r.multiple - 6 / 3.5) < 1e-9);
});

test('signalTimeline marks which signals came before the breakout and which were too late', () => {
  const move = findExplosiveMove(candles, 300, { minMultiple: 7 });
  const buyers = [
    { wallet: 'SMART1', firstBuyTs: 2500, tags: ['smart_degen'] },
    { wallet: 'EXP1', firstBuyTs: 2800, tags: [] },
    { wallet: 'LATE', firstBuyTs: 4300, tags: ['kol'] },
    { wallet: 'NOBODY', firstBuyTs: 2600, tags: [] },
  ];
  const t = signalTimeline({ move, candles, resSec: 300, buyers, explosive: new Set(['EXP1']), graduatedTs: 3600, delaySec: 30 });
  const by = Object.fromEntries(t.signals.map((s) => [s.key, s]));
  assert.equal(by['smart:SMART1'].timing, 'before');
  assert.equal(by['explosive:EXP1'].timing, 'before');
  assert.equal(by['kol:LATE'].timing, 'too late', 'only 10/8.5 left after it');
  assert.equal(by['NOBODY'], undefined, 'untagged unknown wallets are not signals');
  assert.equal(by['volume'].timing, 'before', 'volume jumped 6x at t=2400, before the 2x breakout');
  assert.equal(by['graduated'].timing, 'during');
  assert.ok(by['smart:SMART1'].follower.multiple > 2, 'a follower entering 30 s after the smart buy still caught over 2x with a trailing exit');
  assert.ok(by['smart:SMART1'].upsideLeft > 5);
});

test('studySummary tells how often each signal type showed up early enough to profit', () => {
  const ex = [
    { signals: [{ type: 'smart', timing: 'before', follower: { multiple: 4 } }, { type: 'volume', timing: 'before', follower: { multiple: 3 } }] },
    { signals: [{ type: 'smart', timing: 'too late', follower: { multiple: 0.8 } }] },
  ];
  const s = studySummary(ex);
  const smart = s.find((x) => x.type === 'smart');
  assert.equal(smart.seen, 2);
  assert.equal(smart.early, 1);
  assert.equal(smart.medianFollowerMultiple, 2.4);
  assert.equal(s.find((x) => x.type === 'volume').early, 1);
});

test('a single dust-trade wick is not a base: moves are measured on candle bodies', () => {
  const cs = [
    { t: 0, open: 1e-5, close: 1e-5, high: 1e-5, low: 1e-12, volumeUsd: 5 }, // one trade at a silly price
    { t: 60, open: 1e-5, close: 1.1e-5, high: 1.2e-5, low: 1e-5, volumeUsd: 5 },
    { t: 120, open: 1.1e-5, close: 3e-5, high: 3e-5, low: 1.1e-5, volumeUsd: 50 },
    { t: 180, open: 3e-5, close: 8e-5, high: 2e-3, low: 3e-5, volumeUsd: 90 }, // one silly high wick too
    { t: 240, open: 8e-5, close: 5e-5, high: 8e-5, low: 5e-5, volumeUsd: 40 },
  ];
  const m = findExplosiveMove(cs, 60, { minMultiple: 7 });
  assert.ok(m, 'body-to-body run is 8x');
  assert.equal(m.basePrice, 1e-5);
  assert.equal(m.peakPrice, 8e-5);
  assert.equal(m.multiple, 8);
});

test('a run inside one candle, or from below the lowest possible launch price, is not studied', () => {
  const one = [{ t: 0, open: 1e-5, close: 9e-5, high: 9e-5, low: 1e-5, volumeUsd: 5 }, { t: 60, open: 9e-5, close: 8e-5, high: 9e-5, low: 8e-5, volumeUsd: 5 }];
  assert.equal(findExplosiveMove(one, 60, { minMultiple: 7 }), null, 'needs at least one full candle between base and peak');
  const cs = [0, 60, 120].map((t, i) => ({ t, open: [1e-9, 1e-5, 9e-5][i], close: [1e-9, 1e-5, 9e-5][i], high: [1e-9, 1e-5, 9e-5][i], low: [1e-9, 1e-5, 9e-5][i], volumeUsd: 1 }));
  const m = findExplosiveMove(cs, 60, { minMultiple: 7, minBasePrice: 1e-6 });
  assert.equal(m, null, 'the 1e-9 base is below the floor, and 1e-5 -> 9e-5 sits in adjacent candles');
});
