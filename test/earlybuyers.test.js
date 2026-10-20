import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyBuyersFromTrades, earlyBuyersFromTopTraders, summarizeEarly } from '../src/analysis/earlybuyers.js';

const tr = (wallet, side, ts, price, usd) => ({ wallet, side, ts, priceUsd: price, usd, tokens: usd / price });

test('early buyers come out in true buy order with entry market cap and what they did since', () => {
  const trades = [
    tr('A', 'buy', 100, 0.00001, 10),
    tr('B', 'buy', 105, 0.00002, 50),
    tr('A', 'sell', 400, 0.0001, 50), // A sold half its coins for 10x
    tr('C', 'buy', 500, 0.00005, 20),
    tr('B', 'sell', 900, 0.00008, 200), // B sold everything for 4x
  ];
  const r = earlyBuyersFromTrades(trades, { totalSupply: 1e9, priceNowUsd: 0.00009, creationTs: 90 });
  assert.deepEqual(r.map((x) => x.wallet), ['A', 'B', 'C']);
  const a = r[0];
  assert.equal(a.rank, 1);
  assert.equal(a.firstBuyTs, 100);
  assert.equal(a.secondsAfterLaunch, 10);
  assert.equal(a.entryMcapUsd, 10_000);
  assert.equal(a.boughtUsd, 10);
  assert.equal(a.soldUsd, 50);
  assert.ok(Math.abs(a.heldShare - 0.5) < 1e-9, 'still holds half');
  assert.ok(Math.abs(a.holdingValueUsd - 45) < 1e-9);
  assert.ok(Math.abs(a.multipleNow - 9) < 1e-9, 'coin is 9x its entry price now');
  assert.equal(r[1].heldShare, 0, 'B sold out');
  assert.equal(r[1].lastSellTs, 900);
});

test('top traders from GMGN fill in when the full trade list is unavailable', () => {
  const list = [
    { address: 'X', start_holding_at: 300, avg_cost: 0.00002, avg_sold: 0.0001, history_bought_cost: 40, history_sold_income: 120, amount_cur: 0, sell_amount_percentage: 1, realized_profit: 80, unrealized_profit: 0, tags: ['smart_degen'], end_holding_at: 800 },
    { address: 'Y', start_holding_at: 200, avg_cost: 0.00001, avg_sold: null, history_bought_cost: 10, history_sold_income: 0, amount_cur: 1_000_000, usd_value: 90, sell_amount_percentage: 0, realized_profit: 0, unrealized_profit: 80, tags: [] },
  ];
  const r = earlyBuyersFromTopTraders(list, { totalSupply: 1e9, creationTs: 100, priceNowUsd: 0.00009 });
  assert.deepEqual(r.map((x) => x.wallet), ['Y', 'X'], 'ordered by when they first held');
  assert.equal(r[0].entryMcapUsd, 10_000);
  assert.equal(r[0].stillHolding, true);
  assert.equal(r[1].stillHolding, false);
  assert.equal(r[1].capturedMultiple, 5);
  assert.deepEqual(r[1].tags, ['smart_degen']);
});

test('summary answers "are the early profitable wallets still holding?" in plain numbers', () => {
  const buyers = [
    { wallet: 'A', rank: 1, profitUsd: 40, heldShare: 0.5, stillHolding: true, lastSellTs: 400 },
    { wallet: 'B', rank: 2, profitUsd: 150, heldShare: 0, stillHolding: false, lastSellTs: 900 },
    { wallet: 'C', rank: 3, profitUsd: -5, heldShare: 1, stillHolding: true, lastSellTs: null },
  ];
  const s = summarizeEarly(buyers, { first: 20, now: 1000, explosive: new Set(['B']) });
  assert.equal(s.profitable, 2);
  assert.equal(s.profitableStillHolding, 1);
  assert.equal(s.explosiveIn, 1);
  assert.equal(s.recentSellers, 2, 'sold within the last 15 minutes');
  assert.match(s.text, /1 of the 2 profitable early wallets still hold/);
});
