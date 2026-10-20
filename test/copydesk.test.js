import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/store/db.js';
import { CopyDesk } from '../src/copy/desk.js';

const SOL = 'So11111111111111111111111111111111111111112';
const rate = { usdPerSol: 100, source: 't', at: 0 };

function harness({ activity = [], env = {}, swapImpl, orderStatus = 'confirmed' } = {}) {
  let t = 1_800_000_000_000;
  const feed = { rows: activity };
  const sent = [];
  const g = {
    walletActivity: async () => ({ activities: feed.rows }),
    walletTokenBalance: async () => ({ balance: '0' }),
    quote: async (p) => ({ output_amount: '1000000', min_output_amount: '700000' }),
    swap: swapImpl ?? (async (p) => { sent.push(p); return { order_id: `o${sent.length}`, hash: `h${sent.length}`, status: 'pending' }; }),
    queryOrder: async (id) => ({ order_id: id, status: orderStatus, hash: 'h', report: { input_amount: '250000000', output_amount: '1000000', gas_usd: '0.01' } }),
  };
  const db = openDb(':memory:');
  const desk = new CopyDesk({ g, db, now: () => t, rate: async () => rate, myWallet: async () => 'ME', balanceUsd: async () => 100, env });
  return { desk, feed, sent, db, advance: (ms) => { t += ms; }, nowS: () => Math.floor(t / 1000) };
}

const buyRow = (tx, ts, o = {}) => ({
  tx_hash: tx, event_type: 'buy', timestamp: ts, cost_usd: '300', token_amount: '1000', price_usd: '0.3',
  launchpad_platform: 'Pump.fun', token: { address: o.token ?? 'TOK', symbol: 'TOK', total_supply: '1000000' }, ...o,
});
const watch = { sizeUsd: 25, minMcapUsd: 100_000, maxMcapUsd: 5_000_000, minCopyUsd: 50, platforms: ['Pump.fun'], followSells: true, slippage: 30, priorityFeeSol: 0.001, tipFeeSol: 0.001 };

test('first look at a wallet only records history; old trades are never copied', async () => {
  const h = harness({ activity: [buyRow('old', 1_799_999_000)] });
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  assert.equal(h.desk.intents().length, 0);
});

test('OFF records what it would have copied but never trades', async () => {
  const h = harness();
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  const [i] = h.desk.intents();
  assert.equal(i.state, 'observed');
  assert.match(i.detail.reason, /OFF/);
  assert.equal(h.sent.length, 0);
});

test('CONFIRM waits for your tap, then quotes and sends with a minimum output', async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  let [i] = h.desk.intents();
  assert.equal(i.state, 'awaiting_approval');
  assert.equal(h.sent.length, 0);
  await h.desk.approve(i.id);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].input_token, SOL);
  assert.equal(h.sent[0].input_amount, '250000000', '$25 at $100/SOL');
  assert.equal(h.sent[0].min_output_amount, '700000', 'min output comes from the quote');
  assert.equal(h.sent[0].is_anti_mev, true);
  await h.desk.reconcile();
  [i] = h.desk.intents();
  assert.equal(i.state, 'confirmed');
  assert.equal(h.desk.positions().length, 1);
});

test('the same wallet trade is only ever turned into one order', async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  await h.desk.tick();
  assert.equal(h.desk.intents().length, 1);
  const [i] = h.desk.intents();
  await h.desk.approve(i.id);
  await h.desk.approve(i.id);
  assert.equal(h.sent.length, 1);
});

test('AUTO without the operator flag still asks for approval', async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'auto' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  assert.equal(h.desk.intents()[0].state, 'awaiting_approval');
  assert.match(h.desk.intents()[0].detail.reason, /GMGN_ALLOW_AUTOMATED_TRADES/);
  assert.equal(h.sent.length, 0);
});

test('AUTO with the operator flag sends inside the limits', async () => {
  const h = harness({ env: { GMGN_ALLOW_AUTOMATED_TRADES: '1' } });
  h.desk.setConfig({ mode: 'auto', limits: { perTradeUsd: 25, maxDailyUsd: 40, maxOpen: 5 } });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS(), { token: { address: 'T1', symbol: 'A', total_supply: '1000000' } })];
  await h.desk.tick();
  h.feed.rows = [buyRow('b2', h.nowS(), { token: { address: 'T2', symbol: 'B', total_supply: '1000000' } }), ...h.feed.rows];
  await h.desk.tick();
  assert.equal(h.sent.length, 1, 'second $25 would pass the $40 daily limit');
  const skipped = h.desk.intents().find((i) => i.target_tx === 'b2');
  assert.match(skipped.detail.reason, /daily limit/);
});

test('filters from the settings sheet are applied', async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('tiny', h.nowS(), { cost_usd: '10' }), buyRow('cheap', h.nowS(), { price_usd: '0.01', token: { address: 'C', symbol: 'C', total_supply: '1000000' } })];
  await h.desk.tick();
  const reasons = Object.fromEntries(h.desk.intents().map((i) => [i.target_tx, i.detail.reason]));
  assert.match(reasons.tiny, /spent \$10/);
  assert.match(reasons.cheap, /market cap/);
});

test('an unclear send is never retried; it waits for you to check', async () => {
  const h = harness({ swapImpl: async () => { throw new Error('socket hang up'); } });
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  const [i] = h.desk.intents();
  await h.desk.approve(i.id);
  await h.desk.approve(i.id);
  const [after] = h.desk.intents();
  assert.equal(after.state, 'unknown');
  assert.match(after.detail.reason, /check GMGN/);
});

test('three failed orders in a row switch the desk OFF', async () => {
  const h = harness({ orderStatus: 'failed' });
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  for (const tx of ['a', 'b', 'c']) {
    h.feed.rows = [buyRow(tx, h.nowS(), { token: { address: `T${tx}`, symbol: tx, total_supply: '1000000' } }), ...h.feed.rows];
    await h.desk.tick();
    const i = h.desk.intents().find((x) => x.target_tx === tx);
    await h.desk.approve(i.id);
    await h.desk.reconcile();
  }
  assert.equal(h.desk.config().mode, 'off');
  assert.match(h.desk.config().pausedReason, /3 orders failed/);
});

test('when the wallet sells, your copy sells the same share automatically', async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', watch);
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  await h.desk.approve(h.desk.intents()[0].id);
  await h.desk.reconcile();
  h.advance(60_000);
  // the wallet sells 400 of its 1000 tokens and keeps 600
  h.desk.g.walletTokenBalance = async () => ({ balance: '600' });
  h.feed.rows = [{ ...buyRow('s1', h.nowS()), event_type: 'sell', token_amount: '400' }, ...h.feed.rows];
  await h.desk.tick();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].input_token, 'TOK');
  assert.equal(h.sent[1].output_token, SOL);
  assert.equal(h.sent[1].input_amount, '400000', '40% of the 1,000,000 raw tokens the copy received');
});

test("take-profit / stop-loss from the settings sheet ride on the buy as GMGN condition orders", async () => {
  const h = harness();
  h.desk.setConfig({ mode: 'confirm' });
  h.desk.watch('W', { ...watch, followSells: false, takeProfitPct: 80, stopLossPct: 35 });
  await h.desk.tick();
  h.feed.rows = [buyRow('b1', h.nowS())];
  await h.desk.tick();
  await h.desk.approve(h.desk.intents()[0].id);
  assert.deepEqual(h.sent[0].condition_orders, [
    { order_type: 'profit_stop', side: 'sell', price_scale: '80', sell_ratio: '100' },
    { order_type: 'loss_stop', side: 'sell', price_scale: '35', sell_ratio: '100' },
  ]);
});
