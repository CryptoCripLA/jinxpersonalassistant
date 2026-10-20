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
