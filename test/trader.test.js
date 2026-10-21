import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/store/db.js';
import { Trader } from '../src/trade/manual.js';
import { GmgnError } from '../src/gmgn/client.js';

const rate = { usdPerSol: 100, source: 'GMGN gas-price', at: 0 };
const SOL = 'So11111111111111111111111111111111111111112';

function setup({ swap, quote, now = () => 1_000_000, balance = { balance: '2000' }, order } = {}) {
  const calls = { quote: [], swap: [], query: [] };
  const g = {
    quote: async (p) => { calls.quote.push(p); return quote ? quote(p) : { input_amount: p.input_amount, output_amount: '50000000000', min_output_amount: '35000000000' }; },
    swap: async (b) => { calls.swap.push(b); return swap ? swap(b) : { order_id: 'ord1', hash: 'h1' }; },
    queryOrder: async (id) => { calls.query.push(id); return order ?? { status: 'confirmed', hash: 'h1', report: { input_amount: '250000000', output_amount: '50000000000', gas_usd: '0.21' } }; },
    tokenInfo: async () => ({ decimals: 6, symbol: 'ZAP', price: { price: '0.0000005' } }),
    walletTokenBalance: async () => balance,
  };
  const t = new Trader({ g, db: openDb(':memory:'), rate: async () => rate, myWallet: async () => 'ME', now });
  return { t, g, calls };
}

test('a buy quote is in dollars: what you pay, what you get, and the worst fill you accept', async () => {
  const { t, calls } = setup();
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25, slippage: 30 });
  assert.equal(calls.quote[0].input_token, SOL);
  assert.equal(calls.quote[0].input_amount, '250000000', '$25 at $100 per SOL');
  assert.equal(q.payUsd, 25);
  assert.equal(q.receiveTokens, 50000);
  assert.ok(Math.abs(q.receiveUsd - 0.025) < 1e-9, 'valued at the live price');
  assert.equal(q.minReceiveTokens, 35000);
  assert.ok(q.quoteId && q.expiresAt === 1_000_000 + 30_000);
});

test('confirming sends exactly the quoted minimum, records the order first, and reconciles the fill', async () => {
  const { t, calls } = setup();
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25, slippage: 30 });
  const o = await t.confirm(q.quoteId);
  assert.equal(o.state, 'submitted');
  assert.equal(calls.swap.length, 1);
  assert.equal(calls.swap[0].min_output_amount, '35000000000');
  assert.equal(calls.swap[0].is_anti_mev, true);
  await t.reconcile();
  const done = t.orders()[0];
  assert.equal(done.state, 'confirmed');
  assert.ok(Math.abs(done.detail.paidUsd - 25.21) < 1e-9, '2.5 SOL-worth of $25 plus $0.21 network');
  await assert.rejects(() => t.confirm(q.quoteId), /already used/, 'one quote, one order');
});

test('a quote older than 30 seconds cannot be confirmed: the price may have run', async () => {
  let now = 1_000_000;
  const { t, calls } = setup({ now: () => now });
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25 });
  now += 31_000;
  await assert.rejects(() => t.confirm(q.quoteId), /expired/);
  assert.equal(calls.swap.length, 0);
});

test('when GMGN never answers, the order is marked unknown and never sent again', async () => {
  const { t, calls } = setup({ swap: async () => { throw new GmgnError('fetch failed', { answered: false }); } });
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25 });
  const o = await t.confirm(q.quoteId);
  assert.equal(o.state, 'unknown');
  await t.reconcile();
  assert.equal(calls.swap.length, 1);
  assert.match(t.orders()[0].detail.reason, /will NOT be sent again/);
});

test('sell 50% quotes half your real coin balance', async () => {
  const { t, calls } = setup({ quote: (p) => ({ input_amount: p.input_amount, output_amount: '120000000', min_output_amount: '90000000' }) });
  const q = await t.quote({ side: 'sell', token: 'ZAP', pct: 50 });
  assert.equal(calls.quote[0].input_token, 'ZAP');
  assert.equal(calls.quote[0].output_token, SOL);
  assert.equal(calls.quote[0].input_amount, '1000000000', 'half of 2,000 coins at 6 decimals');
  assert.ok(Math.abs(q.receiveUsd - 12) < 1e-9, '0.12 SOL back');
  assert.ok(Math.abs(q.minReceiveUsd - 9) < 1e-9);
});

test('a refused order is reported with GMGN\'s reason', async () => {
  const { t } = setup({ swap: async () => { throw new GmgnError('GMGN swap error: insufficient balance', { answered: true }); } });
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25 });
  const o = await t.confirm(q.quoteId);
  assert.equal(o.state, 'failed');
  assert.match(o.detail.reason, /insufficient balance/);
});

test('an exit plan rides on the buy as GMGN condition orders: partial take-profits, trailing stop, hard stop', async () => {
  const { t, calls } = setup();
  const plan = { takeProfits: [{ multiple: 2, sellPct: 30 }, { multiple: 3, sellPct: 30 }, { multiple: 5, sellPct: 20 }], trailFromMultiple: 2, trailDrawdownPct: 30, hardStopPct: 40 };
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25, exitPlan: plan, tip: 'fast' });
  assert.match(q.exitText, /30% at 2x/);
  assert.match(q.exitText, /if it falls 40%/);
  await t.confirm(q.quoteId);
  const b = calls.swap[0];
  assert.equal(b.sell_ratio_type, 'buy_amount');
  assert.deepEqual(b.condition_orders, [
    { order_type: 'profit_stop', side: 'sell', price_scale: '100', sell_ratio: '30' },
    { order_type: 'profit_stop', side: 'sell', price_scale: '200', sell_ratio: '30' },
    { order_type: 'profit_stop', side: 'sell', price_scale: '400', sell_ratio: '20' },
    { order_type: 'profit_stop_trace', side: 'sell', price_scale: '100', drawdown_rate: '30', sell_ratio: '100' },
    { order_type: 'loss_stop', side: 'sell', price_scale: '40', sell_ratio: '100' },
  ]);
  assert.ok(Number(b.priority_fee) > 0.001 && Number(b.tip_fee) > 0.001, 'fast tip pays more to land first');
});

test('without an exit plan the buy carries no condition orders and normal tips', async () => {
  const { t, calls } = setup();
  const q = await t.quote({ side: 'buy', token: 'ZAP', usd: 25 });
  await t.confirm(q.quoteId);
  assert.equal(calls.swap[0].condition_orders, undefined);
  assert.equal(calls.swap[0].priority_fee, '0.001');
});
