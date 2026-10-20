import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreToken, lifecycleStage } from '../src/analysis/opportunities.js';
import { feeModel } from '../src/money/fees.js';

const rate = { usdPerSol: 100, source: 't', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0.002, fallbackPoolFeePct: 1.2 });
const base = {
  address: 'M', symbol: 'GOOD', smart_degen_count: 4, renowned_count: 1, rug_ratio: 0.05, is_wash_trading: false,
  creator_token_status: 'creator_close', top_10_holder_rate: 0.15, liquidity: 80000, twitter: 'x.com/good',
  created_timestamp: 1_000_000 - 4 * 3600, usd_market_cap: 400000, swaps_1h: 900, swaps_24h: 3000,
};

test("a coin that passes every item on GMGN's checklist scores high and says why", () => {
  const s = scoreToken(base, { now: 1_000_000, sizeUsd: 25, fees });
  assert.equal(s.disqualified, null);
  assert.ok(s.score >= 90, String(s.score));
  assert.ok(s.reasons.some((r) => /4 smart-money wallets/.test(r)));
  assert.ok(s.breakevenPct > 0, 'shows how much the coin must rise just to pay your fees');
});

test('GMGN quick-disqualify rules remove a coin outright', () => {
  assert.match(scoreToken({ ...base, rug_ratio: 0.45 }, { now: 1_000_000, sizeUsd: 25, fees }).disqualified, /rug/i);
  assert.match(scoreToken({ ...base, is_wash_trading: true }, { now: 1_000_000, sizeUsd: 25, fees }).disqualified, /fake volume/i);
});

test('rate fields arrive as fractions and are compared as fractions', () => {
  const s = scoreToken({ ...base, top_10_holder_rate: 0.62 }, { now: 1_000_000, sizeUsd: 25, fees });
  assert.ok(s.reasons.some((r) => /62%/.test(r)), s.reasons.join(' | '));
  assert.ok(s.score < scoreToken(base, { now: 1_000_000, sizeUsd: 25, fees }).score);
});

test('lifecycle stage follows GMGN guide wording', () => {
  assert.equal(lifecycleStage({ created_timestamp: 999_000, smart_degen_count: 0, renowned_count: 0 }, 1_000_000).stage, 1);
  assert.equal(lifecycleStage({ ...base, price_change_percent1h: 35, creator_token_status: 'creator_hold' }, 1_000_000).stage, 2);
  assert.equal(lifecycleStage({ ...base, smart_degen_count: 0, swaps_1h: 5, swaps_24h: 2000 }, 1_000_000).stage, 4);
});

test('your own suggested wallets buying the coin is shown as a personal signal', () => {
  const s = scoreToken(base, { now: 1_000_000, sizeUsd: 25, fees, yourWalletsIn: ['W1', 'W2'] });
  assert.ok(s.reasons.some((r) => /2 of your wallets/.test(r)));
});

test('without a measured pool fee the break-even is unavailable, not zero', () => {
  const s = scoreToken(base, { now: 1_000_000, sizeUsd: 25, fees: feeModel({ rate, networkSolPerTx: 0.002 }) });
  assert.equal(s.breakevenPct, null);
  assert.equal(s.breakevenText, null);
});
