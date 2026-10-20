import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd, usdSigned, solToUsd, usdToLamports, lamportsToUsd, pct } from '../src/money/usd.js';
import { feeModel, tradeCosts, roundTripCosts } from '../src/money/fees.js';

test('usd formats like the owner reads money', () => {
  assert.equal(usd(1.2049), '$1.20');
  assert.equal(usd(1234.5), '$1,234.50');
  assert.equal(usd(0.004), '$0.004');
  assert.equal(usd(0), '$0.00');
  assert.equal(usd(null), 'unavailable');
  assert.equal(usd(NaN), 'unavailable');
  assert.equal(usdSigned(-0.21), '-$0.21');
  assert.equal(usdSigned(3), '+$3.00');
  assert.equal(usd(2_500_000), '$2.50M');
});

test('sol and lamport conversions use the supplied rate, never a constant', () => {
  const rate = { usdPerSol: 105.92, source: 'test', at: 0 };
  assert.equal(solToUsd(0.006, rate), 0.63552);
  assert.equal(usdToLamports(25, rate), 236_027_190n);
  assert.ok(Math.abs(lamportsToUsd(236_027_190n, rate) - 25) < 1e-6);
  assert.equal(solToUsd(1, null), null, 'no rate means unavailable, not zero');
  assert.equal(usdToLamports(25, null), null);
});

test('pct renders ratios as percent', () => {
  assert.equal(pct(0.1234), '12.3%');
  assert.equal(pct(-0.5), '-50.0%');
  assert.equal(pct(undefined), 'unavailable');
});

test('GMGN fee model: 1% GMGN fee each side, launchpad or pool fee, network fee per transaction', () => {
  const rate = { usdPerSol: 100, source: 'test', at: 0 };
  const m = feeModel({ rate, networkSolPerTx: 0.003 });
  // $25 buy of a Pump.fun bonding-curve coin: GMGN 1% + Pump.fun 1% + 0.003 SOL network
  const buy = tradeCosts(m, { usd: 25, venue: 'curve' });
  assert.equal(buy.gmgnUsd, 0.25);
  assert.equal(buy.venueUsd, 0.25);
  assert.equal(buy.networkUsd, 0.3);
  assert.equal(buy.totalUsd, 0.8);
  // graduated coin with a known pool fee ratio (GMGN reports pool.fee_ratio in percent units)
  const sell = tradeCosts(m, { usd: 25, venue: 'pool', poolFeePct: 0.25 });
  assert.equal(sell.venueUsd, 0.0625);
  assert.equal(sell.venueSource, 'pool fee reported by GMGN');
});

test('round trip cost shows how fees crush tiny trades', () => {
  const rate = { usdPerSol: 100, source: 'test', at: 0 };
  const m = feeModel({ rate, networkSolPerTx: 0.006 });
  const small = roundTripCosts(m, { usd: 5, venue: 'curve' });
  const big = roundTripCosts(m, { usd: 50, venue: 'curve' });
  assert.equal(small.totalUsd, 1.4);            // 0.05+0.05 each side + 0.6+0.6 network
  assert.ok(small.shareOfTrade > 0.27 && small.shareOfTrade < 0.29);
  assert.ok(big.shareOfTrade < 0.065);
});

test('fee model refuses to invent a network fee when the SOL price is unknown', () => {
  const m = feeModel({ rate: null, networkSolPerTx: 0.003 });
  const c = tradeCosts(m, { usd: 10, venue: 'curve' });
  assert.equal(c.networkUsd, null);
  assert.equal(c.totalUsd, null);
});
