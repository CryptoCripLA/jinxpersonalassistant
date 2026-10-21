import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/store/db.js';
import { Gmgn } from '../src/gmgn/client.js';

function fakeApi(handlers) {
  const calls = [];
  const api = new Proxy({}, {
    get: (_, name) => async (...args) => {
      calls.push({ name, args });
      const h = handlers[name];
      if (!h) throw new Error(`no handler for ${name}`);
      return h(...args);
    },
  });
  return { api, calls };
}

const opts = (api, extra = {}) => ({ api, db: openDb(':memory:'), plan: 'pro', sleep: async () => {}, now: () => 1_000_000, ...extra });

test('caches responses by route and arguments', async () => {
  const { api, calls } = fakeApi({ getTokenInfo: async () => ({ symbol: 'AAA' }) });
  const g = new Gmgn(opts(api));
  assert.deepEqual(await g.tokenInfo('MINT'), { symbol: 'AAA' });
  await g.tokenInfo('MINT');
  assert.equal(calls.length, 1);
});

test('a route the plan cannot afford fails fast with a plain explanation', async () => {
  const { api, calls } = fakeApi({ getFollowWallet: async () => ({ list: [] }) });
  const g = new Gmgn(opts(api, { plan: 'free' }));
  await assert.rejects(() => g.followWallet({}), /needs a bigger GMGN API plan/);
  assert.equal(calls.length, 0);
});

test('1-second candles fall back to 30-second candles when the key is not on Pro', async () => {
  const proErr = Object.assign(new Error('1s kline is available to Pro users only'), { name: 'OpenApiError', status: 403, apiError: 'PRO_PLAN_REQUIRED' });
  const { api, calls } = fakeApi({
    getTokenKline: async (chain, addr, res) => {
      if (res === '1s') throw proErr;
      return { list: [{ time: 1_000_000_000_000, open: '1', close: '2', high: '2', low: '1', volume: '10', amount: '5' }] };
    },
  });
  const g = new Gmgn(opts(api));
  const k = await g.candles('MINT', 1_000_000_000, 1_000_000_060);
  assert.equal(k.resolution, '30s');
  assert.equal(k.candles[0].t, 1_000_000_000, 'GMGN sends candle time in milliseconds; we store seconds');
  assert.equal(k.candles[0].close, 2);
  await g.candles('MINT', 1_000_000_100, 1_000_000_160);
  assert.equal(calls.filter((c) => c.args[2] === '1s').length, 1, 'stops asking for 1s once refused');
  const last = calls[calls.length - 1];
  assert.deepEqual([last.args[3], last.args[4]], [1_000_000_100_000, 1_000_000_160_000], 'GMGN candle range must be sent in milliseconds');
});

test('a server rate-limit ban pauses all calls and is reported, not retried in a loop', async () => {
  const ban = Object.assign(new Error('banned'), { name: 'OpenApiError', status: 429, apiError: 'RATE_LIMIT_BANNED', resetAtUnix: 1_300 });
  let slept = 0;
  const { api } = fakeApi({ getTokenInfo: async () => { throw ban; } });
  const g = new Gmgn(opts(api, { sleep: async (ms) => { slept += ms; } }));
  await assert.rejects(() => g.tokenInfo('X'), /GMGN paused requests until/);
  assert.ok(g.bucket.bannedUntil >= 1_300_000);
});

test('SOL price comes from GMGN gas-price with its source and time', async () => {
  const { api } = fakeApi({ getGasPrice: async () => ({ native_token_usd_price: 105.98 }) });
  const g = new Gmgn(opts(api));
  const rate = await g.solUsd();
  assert.deepEqual(rate, { usdPerSol: 105.98, source: 'GMGN gas-price', at: 1_000_000 });
});

test('klineRange pages through GMGN 100-candle windows and returns one ordered series', async () => {
  // GMGN returns at most 100 candles per request: the newest 100 inside [from, to].
  const { api, calls } = fakeApi({
    getTokenKline: async (chain, addr, res, fromMs, toMs) => {
      const out = [];
      for (let t = fromMs; t < toMs; t += 300_000) out.push({ time: t, open: '1', close: '2', high: '3', low: '0.5', volume: '10' });
      return { list: out.slice(-100) };
    },
  });
  const g = new Gmgn(opts(api));
  const T0 = 1_792_000_000; // real epoch seconds; GMGN candle times arrive in milliseconds
  const k = await g.klineRange('MINT', '5m', T0, T0 + 24 * 3600);
  assert.equal(k.resolution, '5m');
  assert.equal(k.resSec, 300);
  assert.equal(k.candles.length, 288, 'one day of 5-minute candles');
  assert.equal(calls.length, 3, '288 candles need three 100-candle requests');
  assert.ok(k.candles.every((c, i) => i === 0 || c.t > k.candles[i - 1].t), 'sorted, no duplicates');
  assert.deepEqual(Object.keys(k.candles[0]).sort(), ['close', 'high', 'low', 'open', 't', 'volumeUsd']);
  assert.equal(k.candles[0].high, 3);
});

test('trending reads the rank list whether GMGN wraps it in data or not', async () => {
  const { api } = fakeApi({ getTrendingSwaps: async (chain, interval) => (interval === '1m' ? { code: 0, data: { rank: [{ address: 'A' }] } } : { rank: [{ address: 'B' }] }) });
  const g = new Gmgn(opts(api));
  assert.deepEqual((await g.trending('1m')).rank, [{ address: 'A' }]);
  assert.deepEqual((await g.trending('1h')).rank, [{ address: 'B' }]);
});

test('one budget per key: research may only fill part of it, clicks and trades can use all of it', async () => {
  const { api } = fakeApi({ quoteOrder: async () => ({ output_amount: '1' }), getTokenInfo: async () => ({}) });
  const db = openDb(':memory:');
  let t = 1_000_000;
  const slept = [];
  const live = new Gmgn({ api, db, plan: 'plus', sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t });
  const job = new Gmgn({ api, db, plan: 'plus', bucket: live.bucket, ceiling: 0.6, sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t });
  assert.equal(job.bucket, live.bucket, 'one shared bucket, so the key can never be over-asked');
  await live.quote({ from_address: 'ME', input_token: 'A', output_token: 'B', input_amount: '1', slippage: 30 });
  assert.equal(slept.length, 0, 'a weight-10 quote fits the interactive budget');
  for (let i = 0; i < 5; i++) await job.tokenInfo(`M${i}`);
  assert.ok(slept.length > 0, 'research waits once the bucket is past its 60% share');
});

test('a GMGN pause pauses every lane on the shared budget', async () => {
  const rate = Object.assign(new Error('limit'), { name: 'OpenApiError', status: 429, apiError: 'RATE_LIMIT_BANNED', resetAtUnix: 2_000 });
  const { api } = fakeApi({ getTokenInfo: async () => { throw rate; }, getGasPrice: async () => ({ native_token_usd_price: '100' }) });
  const db = openDb(':memory:');
  const slept = [];
  const live = new Gmgn({ api, db, plan: 'plus', sleep: async (ms) => slept.push(ms), now: () => 1_000_000 });
  const job = new Gmgn({ api, db, plan: 'plus', bucket: live.bucket, ceiling: 0.6, sleep: async () => {}, now: () => 1_000_000 });
  await assert.rejects(() => job.tokenInfo('MINT'), /rate limit/);
  await live.solUsd();
  assert.ok(slept[0] >= 1_000_000);
});
