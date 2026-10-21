import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrader, styleFit, describeBehavior } from '../src/analysis/traderType.js';
import { dailyPlan, walletDays } from '../src/analysis/mission.js';
import { feeModel } from '../src/money/fees.js';

const prefs = { minCoinsPerDay: 1, maxCoinsPerDay: 3, maxHoldSec: 2 * 3600, sizeUsd: 25, dailyTargetUsd: 50 };
const profile = (o = {}) => ({
  coinsPerActiveDay: 2, medianHoldSec: 50 * 60, stageMix: { snipe: 0, early: 0.1, graduated: 0.9, unknown: 0 },
  entryMcap: { p50: 120_000 }, entryAgeSec: { p50: 2 * 3600 }, sellPattern: { oneShot: 0.7, scaled: 0.3 }, addsPerPosition: 0.2,
  closedCount: 30, wins: 18, winRate: 0.6, realizedUsd: 840, lastTs: 1_000_000, flags: [], ...o,
});
const row = (o = {}) => ({ wallet: 'W', coinsPerActiveDay: 2, medianHoldSec: 50 * 60, flags: [], explosive: { trades: 12, copiedTrades: 12, followerNetUsd: 60, edgeKeptPct: 55, followerCaptured: { 3: 2, 5: 1, 7: 0, 10: 0, 19: 0 } }, ...o });

test('trader types come from where and when they buy', () => {
  assert.equal(classifyTrader(profile()).type, 'graduated');
  assert.equal(classifyTrader(profile({ stageMix: { snipe: 0.7, early: 0.2, graduated: 0.1 }, entryAgeSec: { p50: 20 } })).type, 'sniper');
  assert.equal(classifyTrader(profile({ stageMix: { snipe: 0.05, early: 0.8, graduated: 0.15 }, entryMcap: { p50: 12_000 } })).type, 'early');
  assert.equal(classifyTrader(profile({ stageMix: { snipe: 0, early: 0.7, graduated: 0.3 }, entryMcap: { p50: 48_000 } })).type, 'pregrad');
  assert.equal(classifyTrader(profile({ entryAgeSec: { p50: 3 * 86400 } })).type, 'momentum');
  assert.equal(classifyTrader(profile({ coinsPerActiveDay: 131, medianHoldSec: 20 })).type, 'bot');
  const c = classifyTrader(profile());
  assert.match(c.label, /Graduated-coin trader/);
  assert.match(c.plain, /90% of its coins after they graduated/);
});

test('a sniper picked by its launch timing is described by that timing, never as "0% in the first minute"', () => {
  // live 2026-10-21: median entry 25 s after launch, but GMGN tagged none of its buys as snipes
  const c = classifyTrader(profile({ stageMix: { snipe: 0, early: 0.9, graduated: 0.1 }, entryAgeSec: { p50: 25 }, entryMcap: { p50: 7_000 } }));
  assert.equal(c.type, 'sniper');
  assert.doesNotMatch(c.plain, /\b0%/);
  assert.match(c.plain, /within 25 seconds of launch/);
  assert.match(c.plain, /\$7K/);
});

test('style fit catches the contradictions instead of leaving them in a table', () => {
  assert.equal(styleFit(row(), profile(), prefs).level, 'fits');
  const busy = styleFit(row({ coinsPerActiveDay: 18.3 }), profile({ coinsPerActiveDay: 18.3 }), prefs);
  assert.equal(busy.level, 'no');
  assert.ok(busy.reasons.some((r) => /18\.3 coins a day/.test(r) && /you want 1 to 3/.test(r)));
  const flip = styleFit(row({ medianHoldSec: 60, flags: ['SNIPER_SPEED'], explosive: { ...row().explosive, edgeKeptPct: 538, followerNetUsd: 724 } }), profile({ medianHoldSec: 60 }), prefs);
  assert.equal(flip.level, 'no');
  assert.ok(flip.reasons.some((r) => /cannot be trusted/.test(r)), 'a copier beating the wallet on 1-minute flips is a replay artifact');
  const close = styleFit(row({ coinsPerActiveDay: 4.9 }), profile({ coinsPerActiveDay: 4.9 }), prefs);
  assert.equal(close.level, 'close');
  const thin = styleFit(row({ explosive: { ...row().explosive, copiedTrades: 3 } }), profile(), prefs);
  assert.equal(thin.level, 'no');
});

test('deal-breakers are listed before small differences, so the first reason explains the skip', () => {
  // live 2026-10-21: a +$453 wallet was shown skipped for "a bit more than your 1 to 3"
  const f = styleFit(row({ coinsPerActiveDay: 3.3, medianHoldSec: 32 }), profile({ coinsPerActiveDay: 3.3, medianHoldSec: 32 }), prefs);
  assert.equal(f.level, 'no');
  assert.match(f.reasons[0], /faster than a copy can follow/);
  assert.match(f.reasons[1], /a bit more than your 1 to 3/);
});

test('behavior is described in plain words with the numbers behind it', () => {
  const b = describeBehavior(profile(), { nowSec: 1_000_000 + 720 });
  assert.match(b.buys, /2 coins a day/);
  assert.match(b.holds, /50 minutes/);
  assert.match(b.sells, /all at once 70% of the time/);
  assert.match(b.last, /12 minutes ago/);
  assert.match(b.realized, /\$840\.00/);
});

const rate = { usdPerSol: 100, source: 't', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0.002 });

test('the daily plan turns a dollar target into what each trade must do, with your real money', () => {
  const p = dailyPlan({ targetUsd: 50, sizeUsd: 25, capitalUsd: 46.74, tradesPerDay: 3, fees, venue: 'pool', poolFeePct: 1 });
  assert.equal(p.slots, 1, '$46.74 holds one $25 position at a time, with room for fees');
  assert.ok(Math.abs(p.perTradeUsd - 50 / 3) < 1e-9);
  assert.ok(p.multipleEach > 1.7 && p.multipleEach < 1.8, `about 1.7x each (got ${p.multipleEach})`);
  assert.ok(p.singleMultiple > 3.1 && p.singleMultiple < 3.2, 'or one trade at about 3.1x');
  assert.match(p.text, /\$50/);
  assert.match(p.text, /1 position at a time/);
});

test('walletDays replays a wallet day by day at your pace and counts the days it hit your target', () => {
  const day = 86400;
  const outs = [
    { entryTs: 1 * day + 10, followerNetUsd: 40, status: 'closed' }, { entryTs: 1 * day + 20, followerNetUsd: 30, status: 'closed' }, { entryTs: 1 * day + 30, followerNetUsd: -20, status: 'closed' }, { entryTs: 1 * day + 40, followerNetUsd: 500, status: 'closed' },
    { entryTs: 2 * day + 10, followerNetUsd: -10, status: 'closed' },
    { entryTs: 3 * day + 10, followerNetUsd: 80, status: 'closed' },
  ];
  const d = walletDays(outs, { targetUsd: 50, maxCoinsPerDay: 3 });
  assert.equal(d.activeDays, 3);
  assert.deepEqual(d.days.map((x) => x.netUsd), [50, -10, 80], 'only the first 3 coins of a day count: the 4th was not one you would have taken');
  assert.equal(d.hitDays, 2);
  assert.equal(d.medianDayUsd, 50);
});
