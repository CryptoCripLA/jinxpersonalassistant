import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/store/db.js';
import { reachedFromBase } from '../src/intel/study.js';
import { Service } from '../src/service.js';

const ex = (closes, supply = 1e9) => ({ totalSupply: supply, move: { peakTs: closes.length * 300 }, candles: closes.map((c, i) => ({ t: i * 300, open: c, close: c, high: c, low: c })) });

test('reachedFromBase counts past runners that traded near this market cap and went N times higher after', () => {
  const examples = [
    ex([1e-5, 4e-5, 5e-5, 6e-4]), // traded at $40K-$50K, later $600K: 12x+ from $50K
    ex([1e-5, 4.5e-5, 2e-4]), // traded at $45K, later $200K: ~4.4x
    ex([1e-3, 2e-2]), // never near $45K
  ];
  const r = reachedFromBase(examples, 45_000, 10);
  assert.equal(r.of, 2, 'two runners traded near $45K');
  assert.equal(r.count, 1, 'one of them went 10x from there');
});

test('the service answers built-in questions first and sends open questions to Grok', async () => {
  const db = openDb(':memory:');
  const svc = new Service({ g: {}, db, exportDir: '/tmp', env: {}, log: () => {} });
  const asked = [];
  svc.grok = { ask: async (q, ctx) => { asked.push({ q, ctx }); return { text: 'grok says hi', by: 'grok', costUsd: 0.001 }; } };
  const a = await svc.ask('what is slippage?', {});
  assert.equal(a.by, 'built-in');
  const b = await svc.ask('tell me a story about this chart pattern', { view: 'coin' });
  assert.equal(b.text, 'grok says hi');
  assert.equal(asked[0].ctx.view, 'coin');
});

test('the balance falls back to the last known value, marked stale with the reason, when GMGN pauses', async () => {
  let fail = false;
  const g = {
    userInfo: async () => {
      if (fail) throw new Error('GMGN paused requests until 23:56:41 UTC (rate limit).');
      return { wallets: [{ chain: 'sol', address: 'ME', balances: [{ symbol: 'SOL', balance: '0.5' }] }] };
    },
    solUsd: async () => ({ usdPerSol: 100, source: 'GMGN gas-price', at: 1 }),
  };
  const svc = new Service({ g, db: openDb(':memory:'), exportDir: '/tmp', env: {}, log: () => {} });
  const a1 = await svc.account();
  assert.equal(a1.totalUsd, 50);
  assert.equal(a1.stale, false);
  fail = true;
  const a2 = await svc.account();
  assert.equal(a2.totalUsd, 50, 'last known balance, not "unavailable"');
  assert.equal(a2.stale, true);
  assert.match(a2.staleReason, /paused/);
});

test('preferences are editable and validated', () => {
  const svc = new Service({ g: {}, db: openDb(':memory:'), exportDir: '/tmp', env: {}, log: () => {} });
  const p = svc.setPrefs({ sizeUsd: 30, dailyTargetUsd: 75, minCoinsPerDay: 1, maxCoinsPerDay: 2, maxHoldMin: 90 });
  assert.equal(p.sizeUsd, 30);
  assert.equal(p.dailyTargetUsd, 75);
  assert.equal(svc.user().prefs.maxHoldSec, 5400);
  assert.throws(() => svc.setPrefs({ minCoinsPerDay: 5, maxCoinsPerDay: 2 }), /at most/);
});
