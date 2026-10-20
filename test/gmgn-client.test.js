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
