import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PumpFun, normalizeTrade } from '../src/pumpfun/client.js';

// Shape of a live swap-api.pump.fun/v2 trade (verified 2026-10-20).
const raw = (o) => ({
  slotIndexId: '0004594068720005700000', tx: o.tx, timestamp: o.iso, userAddress: o.wallet, type: o.type,
  program: 'pump', priceUsd: String(o.price), amountUsd: String(o.usd), baseAmount: String(o.usd / o.price), quoteAmount: '1',
});

test('normalizeTrade keeps wallet, side, dollars and seconds', () => {
  const t = normalizeTrade(raw({ tx: 'a', iso: '2026-10-20T23:07:51.000Z', wallet: 'W', type: 'buy', price: 0.0002, usd: 5 }));
  assert.equal(t.wallet, 'W');
  assert.equal(t.side, 'buy');
  assert.equal(t.usd, 5);
  assert.equal(t.priceUsd, 0.0002);
  assert.equal(t.tokens, 25000);
  assert.equal(t.ts, Date.parse('2026-10-20T23:07:51.000Z') / 1000);
  assert.equal(normalizeTrade({ ...raw({ tx: 'b', iso: '2026-10-20T00:00:00Z', wallet: 'W', type: 'create', price: 1, usd: 1 }) }), null);
});

const pages = {
  '0': { trades: [raw({ tx: 't3', iso: '2026-10-20T00:03:00Z', wallet: 'C', type: 'sell', price: 3, usd: 30 }), raw({ tx: 't2', iso: '2026-10-20T00:02:00Z', wallet: 'B', type: 'buy', price: 2, usd: 20 })], pagination: { nextCursor: 'c1' } },
  c1: { trades: [raw({ tx: 't1', iso: '2026-10-20T00:01:00Z', wallet: 'A', type: 'buy', price: 1, usd: 10 })], pagination: { nextCursor: null } },
};

function fakeFetch(log, { failAt } = {}) {
  return async (url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    log.push(cursor);
    if (failAt === cursor) return { status: 429, json: async () => ({ title: 'rate limited' }) };
    return { status: 200, json: async () => pages[cursor] };
  };
}

test('trades pages to the very first trade and returns them oldest first', async () => {
  const log = [];
  const waits = [];
  const pf = new PumpFun({ fetch: fakeFetch(log), sleep: async (ms) => waits.push(ms), now: () => 0, minGapMs: 400 });
  const r = await pf.trades('MINT', { maxPages: 10 });
  assert.deepEqual(r.trades.map((t) => t.tx), ['t1', 't2', 't3']);
  assert.equal(r.complete, true, 'reached the first trade');
  assert.deepEqual(log, ['0', 'c1']);
  assert.ok(waits.some((w) => w >= 400), 'requests are spaced out so Cloudflare does not block us');
});

test('a Cloudflare 429 stops paging and marks the history partial instead of failing', async () => {
  const pf = new PumpFun({ fetch: fakeFetch([], { failAt: 'c1' }), sleep: async () => {}, now: () => 0 });
  const r = await pf.trades('MINT', { maxPages: 10 });
  assert.equal(r.complete, false);
  assert.match(r.note, /rate limit/i);
  assert.deepEqual(r.trades.map((t) => t.tx), ['t2', 't3']);
});

test('maxPages bounds the cost and says the history is partial', async () => {
  const pf = new PumpFun({ fetch: fakeFetch([]), sleep: async () => {}, now: () => 0 });
  const r = await pf.trades('MINT', { maxPages: 1 });
  assert.equal(r.complete, false);
  assert.equal(r.trades.length, 2);
});
