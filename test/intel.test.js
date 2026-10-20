import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/store/db.js';
import { feeModel } from '../src/money/fees.js';
import { analyzeWallet, runExplosiveAnalysis, loadExplosive, MEASURE_METHOD } from '../src/intel/wallets.js';
import { studyToken, runStudy, loadExamples } from '../src/intel/study.js';

const rate = { usdPerSol: 100, source: 't', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0, gmgnFeePct: 0, curveFeePct: 0 });
const NOW = 2_000_000;

// One coin that goes 1 -> 20 between t=1000 and t=4000, then fades.
const path = (t) => (t < 1000 ? 1 : t < 4000 ? 1 + ((t - 1000) / 3000) * 19 : Math.max(2, 20 - (t - 4000) / 200));
const series = (from, to, res) => {
  const out = [];
  for (let t = Math.floor(from / res) * res; t <= to; t += res) out.push({ t, open: path(t) * 1e-5, close: path(t + res) * 1e-5, high: Math.max(path(t), path(t + res)) * 1e-5, low: Math.min(path(t), path(t + res)) * 1e-5, volumeUsd: t >= 900 && t < 4000 ? 500 : 20 });
  return out;
};
const fakeG = (extra = {}) => ({
  klineRange: async (token, res, from, to) => ({ resolution: res, resSec: { '1m': 60, '5m': 300 }[res], candles: series(from, to, { '1m': 60, '5m': 300 }[res]) }),
  candles: async (token, from, to) => ({ resolution: '30s', candles: series(from, to, 30) }),
  ...extra,
});

const profile = {
  wallet: 'W1', coinsPerActiveDay: 2, lastTs: 3000, spanDays: 5, closedCount: 1,
  positions: [{
    token: 'T', symbol: 'TT', status: 'closed', openTs: 1000, closeTs: 2895, holdSec: 1895, entryPriceUsd: 1e-5, entryMcapUsd: 10_000,
    buyUsd: 50, sellUsd: 50 * 13, realizedUsd: 600, returnRatio: 12, entryStage: 'early',
    buys: [{ ts: 1000, usd: 50, priceUsd: 1e-5, dexFeeUsd: 0 }],
    sells: [{ ts: 2895, usd: 650, priceUsd: 1.3e-4, fractionOfHolding: 1, dexFeeUsd: 0 }], // price path is ~13x at t=2895
  }],
  gmgn30: { identity: { twitter: 'caller' } },
};

test('analyzeWallet measures the coin peak, the wallet capture and a $25 follower replay per trade', async () => {
  const r = await analyzeWallet(fakeG(), profile, { sizeUsd: 25, delaySec: 5, fees, days: 14, nowSec: 3000 + 86400 });
  const o = r.outcomes[0];
  assert.ok(o.tokenMaxMultiple > 18 && o.tokenMaxMultiple <= 20.1, `coin ran ~20x after the buy (got ${o.tokenMaxMultiple})`);
  assert.equal(o.walletCaptured, 13);
  assert.ok(o.followerCaptured > 10 && o.followerCaptured < 13, 'a follower 5 s late still caught most of it');
  assert.equal(r.explosive.followerCaptured[10], 1);
  assert.equal(r.explosive.found[19], 1);
  assert.equal(r.name, '@caller');
  assert.deepEqual(r.flags, ['LOW_ACTIVITY']);
});

test('runExplosiveAnalysis stores each wallet and loadExplosive ranks them for the board', async () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, ?)').run('W1', JSON.stringify(profile), 1, 't');
  const job = await runExplosiveAnalysis(fakeG(), db, { sizeUsd: 25, delaySec: 5, fees, nowSec: 3000 + 86400 });
  assert.equal(job.analyzed, 1);
  const rows = loadExplosive(db, { maxCoinsPerDay: 3 });
  assert.equal(rows[0].wallet, 'W1');
  assert.equal(rows[0].isExplosive, true);
  assert.ok(rows[0].perActiveDayUsd > 400, 'two copied coins a day at ~$270 each');
});

const tokenInfo = { address: 'T', symbol: 'TT', name: 'Test Token', logo: '', creation_timestamp: 600, total_supply: '1000000000', migrated_timestamp: 2500, launchpad: 'pump' };
const traders = { list: [
  { address: 'EARLY', addr_type: 0, start_holding_at: 850, avg_cost: 1e-5, avg_sold: 1.5e-4, history_bought_cost: 30, history_sold_income: 450, amount_cur: 0, sell_amount_percentage: 1, realized_profit: 420, unrealized_profit: 0, tags: ['smart_degen'], end_holding_at: 3600 },
  { address: 'LATE', addr_type: 0, start_holding_at: 3500, avg_cost: 1.9e-4, avg_sold: 1.5e-4, history_bought_cost: 30, history_sold_income: 20, amount_cur: 0, sell_amount_percentage: 1, realized_profit: -10, unrealized_profit: 0, tags: ['kol'] },
] };

test('studyToken turns a real 7x+ run into a dated example with its early signals and early wallets', async () => {
  const g = fakeG({ tokenInfo: async () => tokenInfo, tokenTraders: async () => traders });
  const ex = await studyToken(g, 'T', { explosive: new Set(), delaySec: 30, nowSec: NOW });
  assert.ok(ex.move.multiple >= 7);
  assert.equal(ex.symbol, 'TT');
  assert.equal(ex.baseMcapUsd, ex.move.basePrice * 1e9);
  const smart = ex.signals.find((s) => s.key === 'smart:EARLY');
  assert.equal(smart.timing, 'before');
  assert.equal(ex.signals.find((s) => s.key === 'kol:LATE').timing, 'too late');
  assert.deepEqual(ex.earlyWallets.map((w) => w.wallet), ['EARLY'], 'only wallets in before the breakout');
  assert.ok(Math.abs(ex.earlyWallets[0].capturedMultiple - 15) < 1e-9);
});

test('studyToken returns null when the coin never ran 7x', async () => {
  const g = fakeG({ tokenInfo: async () => tokenInfo, tokenTraders: async () => traders, klineRange: async (t, res, from, to) => ({ resolution: res, resSec: 300, candles: series(0, 900, 300) }) });
  assert.equal(await studyToken(g, 'T', { nowSec: NOW }), null);
});

test('runStudy keeps the examples and turns early winners into wallet candidates', async () => {
  const db = openDb(':memory:');
  const g = fakeG({ tokenInfo: async () => tokenInfo, tokenTraders: async () => traders });
  const r = await runStudy(g, db, { tokens: ['T'], nowSec: NOW });
  assert.equal(r.examples, 1);
  assert.equal(loadExamples(db)[0].token, 'T');
  const cand = db.prepare('SELECT * FROM candidates WHERE wallet = ?').get('EARLY');
  assert.ok(cand, 'early winner saved for profiling');
  assert.match(JSON.parse(cand.sources).sources[0], /before TT ran/);
});

test('runExplosiveAnalysis skips wallets measured recently so an interrupted run resumes', async () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, ?)').run('W1', JSON.stringify(profile), 1, 't');
  db.prepare('INSERT INTO explosive_profiles (wallet, data, built_at) VALUES (?, ?, ?)').run('W1', JSON.stringify({ wallet: 'W1', explosive: {}, method: MEASURE_METHOD }), Date.now());
  let calls = 0;
  const g = fakeG({ candles: async (...a) => { calls += 1; return fakeG().candles(...a); } });
  const job = await runExplosiveAnalysis(g, db, { sizeUsd: 25, delaySec: 5, fees, nowSec: 3000 + 86400, skipFreshMs: 6 * 3600_000 });
  assert.equal(job.analyzed, 0);
  assert.equal(job.skipped, 1);
  assert.equal(calls, 0);
});

test('a wallet measured with an older method is measured again even if recent', async () => {
  const db = openDb(':memory:');
  db.prepare('INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, ?)').run('W1', JSON.stringify(profile), 1, 't');
  db.prepare('INSERT INTO explosive_profiles (wallet, data, built_at) VALUES (?, ?, ?)').run('W1', JSON.stringify({ wallet: 'W1', explosive: {} }), Date.now());
  const job = await runExplosiveAnalysis(fakeG(), db, { sizeUsd: 25, delaySec: 5, fees, nowSec: 3000 + 86400, skipFreshMs: 6 * 3600_000 });
  assert.equal(job.analyzed, 1);
  assert.equal(loadExplosive(db)[0].method, MEASURE_METHOD);
});

test('studyToken reads 1-minute candles for the first hours and labels launch spikes apart from later breakouts', async () => {
  const seen = [];
  const g = fakeG({ tokenInfo: async () => tokenInfo, tokenTraders: async () => traders, klineRange: async (token, res, from, to) => { seen.push(res); return { resolution: res, resSec: 60, candles: series(from, to, 60) }; } });
  const ex = await studyToken(g, 'T', { nowSec: NOW });
  assert.deepEqual([...new Set(seen)], ['1m']);
  assert.equal(ex.resSec, 60);
  assert.equal(ex.kind, 'breakout', 'the run started 7 minutes after launch, not in the launch candles');
});

test('a launch spike is kept and labelled, with the part a follower could still have caught', async () => {
  // $3K at launch to $45K inside the first minute, then $45K to $180K over the next 20 minutes.
  const p = (t) => (t < 660 ? 3e-6 + ((t - 600) / 60) * 42e-6 : 45e-6 + Math.min(1, (t - 660) / 1200) * 135e-6);
  const cs = [];
  for (let t = 600; t < 600 + 3600; t += 60) cs.push({ t, open: p(t), close: p(t + 60), high: p(t + 60), low: p(t), volumeUsd: 10 });
  const g = fakeG({ tokenInfo: async () => tokenInfo, tokenTraders: async () => traders, klineRange: async () => ({ resolution: '1m', resSec: 60, candles: cs }) });
  const ex = await studyToken(g, 'T', { nowSec: NOW });
  assert.ok(ex, 'a 60x launch run is kept as an example');
  assert.equal(ex.kind, 'launch');
  assert.ok(ex.move.multiple > 50);
  assert.ok(ex.followable, 'the best run after the launch minute is reported');
  assert.ok(ex.followable.multiple > 3.5 && ex.followable.multiple < 4.1, `about 4x from $45K (got ${ex.followable.multiple})`);
  assert.ok(Math.abs(ex.followable.baseMcapUsd - 45_000) < 5_000);
});

test('runStudy counts what it studied and why coins were left out', async () => {
  const db = openDb(':memory:');
  const flat = series(0, 900, 60);
  const g = fakeG({
    tokenInfo: async (t) => ({ ...tokenInfo, address: t }),
    tokenTraders: async () => traders,
    klineRange: async (t, res, from, to) => ({ resolution: '1m', resSec: 60, candles: t === 'RUN' ? series(from, to, 60) : t === 'FLAT' ? flat : flat.slice(0, 2) }),
  });
  const r = await runStudy(g, db, { tokens: ['RUN', 'FLAT', 'THIN'], nowSec: NOW });
  assert.deepEqual(r.reasons, { 'never ran 7x within 6 hours': 1, 'too little trading data': 1 });
  assert.equal(r.examples, 1);
  assert.equal(r.breakouts, 1);
  assert.equal(r.launches, 0);
});
