import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendSettings, maxConcurrent } from '../src/analysis/settings.js';
import { feeModel } from '../src/money/fees.js';

const rate = { usdPerSol: 100, source: 't', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0.002 });

const profile = (o = {}) => ({
  wallet: 'W', closedCount: 20, openCount: 2, winRate: 0.6, medianBuyUsd: 300, p25BuyUsd: 120,
  medianHoldSec: 1800, coinsPerActiveDay: 2, stageMix: { graduated: 0.8, early: 0.2, snipe: 0, unknown: 0 },
  entryMcap: { p10: 82_000, p50: 250_000, p90: 1_900_000 }, entryAgeSec: { p10: 1200, p50: 5000, p90: 40000 },
  platforms: ['Pump.fun'], addsPerPosition: 0.2, sellPattern: { oneShot: 0.7, scaled: 0.3 },
  positions: [
    { openTs: 0, closeTs: 100, status: 'closed', returnRatio: 0.8, sells: [{}] },
    { openTs: 50, closeTs: 150, status: 'closed', returnRatio: -0.3, sells: [{}] },
    { openTs: 300, closeTs: 400, status: 'closed', returnRatio: 0.5, sells: [{}, {}] },
  ],
  ...o,
});

test('max concurrent coins held is measured from the timeline', () => {
  assert.equal(maxConcurrent(profile().positions), 2);
});

test('settings use GMGN names, USD amounts with SOL for the GMGN screen, and kid-simple words', () => {
  const s = recommendSettings(profile(), { capitalUsd: 100, rate, fees });
  const names = s.items.map((i) => i.setting);
  for (const n of ['Single copy buying method', 'Selling method', 'Slippage', 'Priority fee', 'Anti-MEV', 'Market Cap limit',
    'Liquidity Limit', 'Token creation time limit', 'Minimum copy amount', 'Single coin position increase times', 'Filter platform', 'Lightning Mode']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  const buy = s.items.find((i) => i.setting === 'Single copy buying method');
  assert.match(buy.value, /Fixed buy/);
  assert.ok(buy.usd > 0 && buy.usd <= 100 / 3, `size ${buy.usd} leaves room for the 2 coins it holds at once plus fees`);
  assert.doesNotMatch(JSON.stringify(s.items.map((i) => [i.value, i.simple, i.why])), /SOL|lamport/i, 'owner reads USD only');
  assert.ok(buy.gmgnInput > 0, 'the SOL number GMGN\'s box needs is kept for the copy button only');
  const mc = s.items.find((i) => i.setting === 'Market Cap limit');
  assert.match(mc.value, /\$80K/);
  assert.match(mc.value, /\$2M|\$1.9M/);
  for (const i of s.items) assert.ok(i.simple.length > 20 && i.why.length > 10, `${i.setting} needs a simple explanation and a reason`);
  assert.equal(s.items.find((i) => i.setting === 'Lightning Mode').value, 'Off');
});

test('a tiny account gets a clear warning when fees would eat the trade', () => {
  const s = recommendSettings(profile(), { capitalUsd: 6, rate, fees: feeModel({ rate, networkSolPerTx: 0.006 }) });
  assert.ok(s.warnings.some((w) => /fees/.test(w)), s.warnings.join(' | '));
  assert.ok(s.feeCheck.shareOfTrade > 0.2);
});

test('a wallet that leaves bags open gets take-profit / stop-loss instead of follow-selling', () => {
  const s = recommendSettings(profile({ closedCount: 6, openCount: 10 }), { capitalUsd: 100, rate, fees });
  assert.match(s.items.find((i) => i.setting === 'Selling method').value, /Take profit and stop loss/);
});
