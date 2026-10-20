import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenTape, momentumScore } from '../src/analysis/momentum.js';

const snap = (o) => ({
  address: 'MINT', symbol: 'ZAP', created_timestamp: 1000, market_cap: 20_000, liquidity: 15_000, progress: 0.4,
  swaps_24h: 100, buys_24h: 60, sells_24h: 40, volume_24h: 10_000, holder_count: 50, smart_degen_count: 0, renowned_count: 0,
  rug_ratio: 0.05, bundler_trader_amount_rate: 0.05, rat_trader_amount_rate: 0, entrapment_ratio: 0, bot_degen_rate: 0.1,
  top_10_holder_rate: 0.2, dev_team_hold_rate: 0, suspected_insider_hold_rate: 0, creator_token_status: 'creator_close',
  twitter: 'https://x.com/zap', is_wash_trading: false, ...o,
});

test('TokenTape turns cumulative counters into per-minute rates', () => {
  const tape = new TokenTape();
  tape.add(snap({}), 1000);
  tape.add(snap({ swaps_24h: 160, buys_24h: 110, sells_24h: 50, volume_24h: 16_000, holder_count: 80, progress: 0.55, smart_degen_count: 2 }), 1060);
  const r = tape.rates('MINT', 1060);
  assert.equal(r.windowSec, 60);
  assert.equal(r.buysPerMin, 50);
  assert.equal(r.sellsPerMin, 10);
  assert.equal(r.volumePerMinUsd, 6000);
  assert.equal(r.holdersPerMin, 30);
  assert.ok(Math.abs(r.progressPerMin - 0.15) < 1e-9);
  assert.equal(r.smartAdded, 2);
  assert.equal(tape.rates('OTHER', 1060), null, 'one snapshot is not a rate');
});

test('TokenTape measures acceleration: last minute against the five before it', () => {
  const tape = new TokenTape();
  let swaps = 0;
  for (let i = 0; i <= 6; i++) {
    swaps += i < 6 ? 10 : 40; // steady 10 a minute, then 40 in the last minute
    tape.add(snap({ swaps_24h: swaps, buys_24h: swaps }), 1000 + i * 60);
  }
  const r = tape.rates('MINT', 1360);
  assert.equal(r.buysPerMin, 40);
  assert.equal(r.acceleration, 4, 'last minute runs 4x the earlier pace');
});

test('momentumScore rewards ignition plus smart money and explains every point', () => {
  const now = 1600;
  const rates = { windowSec: 60, buysPerMin: 40, sellsPerMin: 10, volumePerMinUsd: 5000, holdersPerMin: 20, progressPerMin: 0.03, smartAdded: 2, acceleration: 2 };
  const s = momentumScore(snap({ smart_degen_count: 3, progress: 0.85 }), { now, rates, explosiveWalletsIn: [{ wallet: 'W1', ts: now - 120 }] });
  assert.ok(s.score >= 70, `strong setup scores high (got ${s.score})`);
  assert.ok(s.reasons.some((r) => /40 buys a minute/.test(r)));
  assert.ok(s.reasons.some((r) => /explosive wallet/.test(r)));
  assert.ok(s.reasons.some((r) => /graduat/i.test(r)));
  assert.equal(s.disqualified, null);
  assert.equal(s.stage, 'Ignition');
});

test('momentumScore disqualifies rugs and fake volume outright', () => {
  assert.match(momentumScore(snap({ rug_ratio: 0.6 }), { now: 1100 }).disqualified, /rug/i);
  assert.match(momentumScore(snap({ is_wash_trading: true }), { now: 1100 }).disqualified, /fake volume/i);
});

test('momentumScore warns when buyers turn into sellers and the coin is fading', () => {
  const rates = { windowSec: 60, buysPerMin: 5, sellsPerMin: 25, volumePerMinUsd: 3000, holdersPerMin: -4, progressPerMin: 0, smartAdded: -2, acceleration: 0.4 };
  const s = momentumScore(snap({}), { now: 5000, rates });
  assert.equal(s.stage, 'Fading');
  assert.ok(s.warnings.some((w) => /selling/.test(w)));
  assert.ok(s.warnings.some((w) => /smart-money wallets left/.test(w)));
});

test('missing live rates are reported as unknown, never scored as zero activity', () => {
  const s = momentumScore(snap({}), { now: 1100, rates: null });
  assert.ok(s.reasons.some((r) => /not measured yet/.test(r)));
  assert.equal(s.stage, 'Watching');
});
