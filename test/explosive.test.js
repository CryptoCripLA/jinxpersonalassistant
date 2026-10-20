import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakAfter, tradeOutcome, explosiveProfile, rankExplosive, walletFlags, MULTIPLE_STEPS } from '../src/analysis/explosive.js';

const c = (t, high, close = high) => ({ t, open: close, close, high, low: close });

test('peakAfter finds the highest price inside the horizon only', () => {
  const candles = [c(0, 1), c(300, 4), c(600, 9), c(900, 2), c(5000, 50)];
  const p = peakAfter(candles, 100, 1200, 300);
  assert.equal(p.peakPrice, 9);
  assert.equal(p.peakTs, 600);
  assert.equal(peakAfter([], 0, 100, 60), null);
  assert.equal(peakAfter(candles, 10_000, 100, 300), null, 'no candle after entry means unknown, not 1x');
});

const position = (o = {}) => ({
  token: 'T', symbol: 'TT', status: 'closed', openTs: 1000, closeTs: 4600, holdSec: 3600,
  entryPriceUsd: 0.001, entryMcapUsd: 1_000_000 * 0.001, buyUsd: 100, sellUsd: 500,
  buys: [{ ts: 1000, usd: 100, priceUsd: 0.001 }], sells: [{ ts: 4600, usd: 500, priceUsd: 0.005, fractionOfHolding: 1 }],
  ...o,
});

test('tradeOutcome keeps the token peak apart from what the wallet and a follower captured', () => {
  const o = tradeOutcome(position(), {
    peak: { peakPrice: 0.019, peakTs: 3000 },
    follower: { myEntryPrice: 0.0012, myExitPrice: 0.0049, myNetUsd: 70 },
    sizeUsd: 25,
  });
  assert.ok(Math.abs(o.tokenMaxMultiple - 19) < 1e-9, 'token went 19x after the wallet bought');
  assert.equal(o.walletCaptured, 5, 'wallet sold for 5x its cost');
  assert.ok(Math.abs(o.missedUpside - 3.8) < 1e-9, '19x available vs 5x taken');
  assert.equal(o.timeToPeakSec, 2000);
  assert.equal(o.followerNetUsd, 70);
  assert.ok(Math.abs(o.followerCaptured - (25 + 70) / 25) < 1e-9, 'follower multiple comes from the $25 replay, not the wallet');
  assert.equal(o.entryMcapUsd, 1000);
});

test('tradeOutcome reports unknown peaks and open trades as unavailable, not zero', () => {
  const o = tradeOutcome(position({ status: 'open', sellUsd: 0, sells: [] }), { peak: null, follower: null, sizeUsd: 25 });
  assert.equal(o.tokenMaxMultiple, null);
  assert.equal(o.walletCaptured, null);
  assert.equal(o.followerNetUsd, null);
  assert.equal(o.missedUpside, null);
});

const outcome = (o) => ({ status: 'closed', tokenMaxMultiple: 2, walletCaptured: 1.5, followerCaptured: 1.3, followerNetUsd: 7.5, holdSec: 1800, entryMcapUsd: 50_000, entryTs: 0, ...o });

test('explosiveProfile counts how often big moves were found, captured by the wallet, and captured by a follower', () => {
  const outs = [
    outcome({ tokenMaxMultiple: 25, walletCaptured: 12, followerCaptured: 8, followerNetUsd: 175 }),
    outcome({ tokenMaxMultiple: 8, walletCaptured: 6, followerCaptured: 2, followerNetUsd: 25 }),
    outcome({ tokenMaxMultiple: 1.1, walletCaptured: 0.5, followerCaptured: 0.4, followerNetUsd: -15 }),
    outcome({ status: 'open', walletCaptured: null, followerCaptured: null, followerNetUsd: null, tokenMaxMultiple: 4 }),
  ];
  const p = explosiveProfile(outs, { sizeUsd: 25 });
  assert.deepEqual(MULTIPLE_STEPS, [3, 5, 7, 10, 19]);
  assert.equal(p.trades, 3, 'open trades are not judged');
  assert.deepEqual(p.found, { 3: 3, 5: 2, 7: 2, 10: 1, 19: 1 }, 'found counts open trades too: the coin still ran after the buy');
  assert.deepEqual(p.captured, { 3: 2, 5: 2, 7: 1, 10: 1, 19: 0 });
  assert.deepEqual(p.followerCaptured, { 3: 1, 5: 1, 7: 1, 10: 0, 19: 0 });
  assert.equal(p.losses, 1);
  assert.equal(p.followerNetUsd, 185);
  assert.equal(p.followerLosses, 1);
  assert.equal(p.bestFollowerMultiple, 8);
  assert.ok(p.edgeKeptPct > 0 && p.edgeKeptPct < 100, 'follower keeps only part of the wallet edge');
});

test('edge kept is unavailable when the wallet itself barely made money', () => {
  const p = explosiveProfile([outcome({ walletCaptured: 1.01, followerCaptured: 1.0, followerNetUsd: 0 })], { sizeUsd: 25 });
  assert.equal(p.edgeKeptPct, null);
});

const row = (o) => ({
  wallet: o.wallet, coinsPerActiveDay: 2, lastTs: 1000, flags: [],
  explosive: { trades: 10, followerCaptured: { 3: 1, 5: 0, 7: 0, 10: 0, 19: 0 }, followerNetUsd: 50, avgFollowerNetUsd: 5, ...o.explosive },
  ...o,
});

test('rankExplosive orders by realizable follower dollars per active day, capped at your 3 coins a day', () => {
  const busy = row({ wallet: 'busy', coinsPerActiveDay: 30, explosive: { avgFollowerNetUsd: 4, followerNetUsd: 1200, followerCaptured: { 3: 9, 5: 4, 7: 1, 10: 0, 19: 0 } } });
  const sharp = row({ wallet: 'sharp', coinsPerActiveDay: 2, explosive: { avgFollowerNetUsd: 30, followerNetUsd: 600, followerCaptured: { 3: 4, 5: 3, 7: 2, 10: 1, 19: 0 } } });
  const flat = row({ wallet: 'flat', coinsPerActiveDay: 2, explosive: { avgFollowerNetUsd: 6, followerNetUsd: 120, followerCaptured: { 3: 0, 5: 0, 7: 0, 10: 0, 19: 0 } } });
  const r = rankExplosive([busy, flat, sharp], { maxCoinsPerDay: 3 });
  assert.deepEqual(r.map((x) => x.wallet), ['sharp', 'busy', 'flat']);
  assert.equal(r[0].perActiveDayUsd, 60);
  assert.equal(r[1].perActiveDayUsd, 12, 'a busy wallet only counts the 3 coins a day you would take');
  assert.equal(r[2].isExplosive, false, 'never handed you a 3x: not an explosive wallet');
  assert.equal(r[0].isExplosive, true);
});

test('walletFlags ports the bot and distributor checks (Kelows/million, MIT)', () => {
  const pos = (holdSec, sells = 1, buys = 1) => ({ status: 'closed', holdSec, buys: Array(buys).fill({}), sells: Array(sells).fill({}), realizedUsd: 1 });
  const flags = walletFlags({ positions: Array(6).fill(0).map(() => pos(60)), lastTs: 0, nowSec: 20 * 86400 });
  assert.ok(flags.includes('SNIPER_SPEED'), 'median hold under 5 minutes');
  assert.ok(flags.includes('DORMANT'), 'no trade for 14+ days');
  const dist = walletFlags({ positions: [pos(3600, 25, 2)], lastTs: 100, nowSec: 200 });
  assert.ok(dist.includes('DISTRIBUTOR'));
  assert.ok(dist.includes('LOW_ACTIVITY'));
});
