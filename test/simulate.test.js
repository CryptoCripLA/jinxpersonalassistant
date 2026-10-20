import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateCopy, priceAt } from '../src/analysis/simulate.js';
import { feeModel } from '../src/money/fees.js';

const rate = { usdPerSol: 100, source: 't', at: 0 };
const noNetwork = feeModel({ rate, networkSolPerTx: 0, gmgnFeePct: 0, curveFeePct: 0 });

const candle = (t, open, close, high = Math.max(open, close), low = Math.min(open, close)) => ({ t, open, close, high, low });
const book = {
  TOK: [candle(990, 1.0, 1.3, 1.4, 0.95), candle(1980, 2.0, 1.7, 2.1, 1.6), candle(3000, 1.7, 1.7)],
};
const candlesFor = async (token, from, to) => ({
  resolution: '30s',
  candles: (book[token] ?? []).filter((c) => c.t + 30 > from && c.t <= to),
});

const pos = (o) => ({
  token: 'TOK', symbol: 'TOK', status: 'closed', entryStage: 'graduated', openTs: 1000, entryPriceUsd: 1.0,
  buyUsd: 100, sellUsd: 200, realizedUsd: 100, returnRatio: 1,
  buys: [{ ts: 1000, usd: 100, priceUsd: 1.0, dexFeeUsd: 0 }],
  sells: [{ ts: 2000, usd: 200, priceUsd: 2.0, fractionOfHolding: 1, dexFeeUsd: 0 }],
  ...o,
});

test('priceAt interpolates inside a candle and reports the candle bounds', () => {
  const p = priceAt(book.TOK, 1005, 30);
  assert.ok(Math.abs(p.typical - 1.15) < 1e-9);
  assert.equal(p.high, 1.4);
  assert.equal(p.low, 0.95);
  assert.equal(priceAt([], 1005, 30), null);
});

test('copy delay moves your prices: you buy later and sell later than the wallet', async () => {
  const r = await simulateCopy({ positions: [pos()], sizeUsd: 20, startCapitalUsd: 100, delaySec: 5, impactPct: 0, fees: noNetwork, candlesFor });
  const row = r.rows[0];
  assert.ok(Math.abs(row.myEntryPrice - 1.15) < 1e-9, 'bought 5 s after the wallet, mid-candle');
  const exit = 2.0 - 0.3 * (25 / 30);
  assert.ok(Math.abs(row.myExitPrice - exit) < 1e-9);
  const out = 20 * (exit / 1.15);
  assert.ok(Math.abs(r.typical.netUsd - (out - 20)) < 1e-9);
  assert.equal(r.wallet.realizedUsd, 100, "the wallet's own result is reported separately");
  assert.ok(r.rough.netUsd < r.typical.netUsd, 'rough-luck case buys the candle high and sells the low');
});

test('fees are charged on every transaction you would send', async () => {
  const fees = feeModel({ rate, networkSolPerTx: 0.003 }); // $0.30 per transaction, 1% GMGN, 1% curve or pool fee
  const p = pos({ entryStage: 'early', sells: [
    { ts: 2000, usd: 100, priceUsd: 2.0, fractionOfHolding: 0.5, dexFeeUsd: 0 },
    { ts: 2005, usd: 100, priceUsd: 2.0, fractionOfHolding: 1, dexFeeUsd: 0 },
  ] });
  const r = await simulateCopy({ positions: [p], sizeUsd: 20, startCapitalUsd: 100, delaySec: 5, impactPct: 0, fees, candlesFor });
  assert.equal(r.typical.txCount, 3, 'one buy plus two follow-sells');
  assert.ok(Math.abs(r.typical.fees.networkUsd - 0.9) < 1e-9);
  assert.ok(r.typical.fees.gmgnUsd > 0.2 && r.typical.fees.venueUsd > 0.2);
});

test('trades you could not afford are skipped and counted, not silently added', async () => {
  const many = [0, 1, 2].map((i) => pos({ openTs: 1000 + i, buys: [{ ts: 1000 + i, usd: 100, priceUsd: 1, dexFeeUsd: 0 }] }));
  const r = await simulateCopy({ positions: many, sizeUsd: 40, startCapitalUsd: 100, delaySec: 5, impactPct: 0, fees: noNetwork, candlesFor });
  assert.equal(r.typical.taken, 2);
  assert.equal(r.typical.skippedNoCash, 1);
});

test('missing price data is reported as unavailable, never as a zero result', async () => {
  const r = await simulateCopy({ positions: [pos({ token: 'NOPE' })], sizeUsd: 20, startCapitalUsd: 100, delaySec: 5, impactPct: 0, fees: noNetwork, candlesFor });
  assert.equal(r.typical.taken, 0);
  assert.equal(r.unavailable, 1);
  assert.match(r.rows[0].note, /no price data/);
});
