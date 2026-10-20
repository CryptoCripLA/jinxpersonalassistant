import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, answer } from '../src/assistant/router.js';
import { explainTerm } from '../src/assistant/glossary.js';

const W = 'J95t5ynghKnt445p8CD5PtdNNALFJR5b8i859V7kWbsJ';

test('the six owner questions are understood without an AI', () => {
  assert.deepEqual(classify('Find the best trader who buys graduated coins.'), { intent: 'best_wallet', params: { category: 'graduated' } });
  assert.deepEqual(classify('Who makes the most money while trading only twice a day?'), { intent: 'few_trades', params: { perDay: 2 } });
  assert.deepEqual(classify(`What would I have made copying ${W} with $25?`), { intent: 'simulate', params: { wallet: W, sizeUsd: 25 } });
  assert.deepEqual(classify('Which new coin has the strongest opportunity right now?'), { intent: 'opportunity', params: { category: 'new' } });
  assert.equal(classify('What settings should I use for this wallet?', { wallet: W }).intent, 'settings');
  assert.equal(classify('Why did you choose this trader instead of the other one?').intent, 'compare');
  assert.deepEqual(classify('what is slippage?'), { intent: 'explain', params: { term: 'slippage' } });
});

test('"this wallet" uses the wallet you have open', () => {
  assert.equal(classify('What would I have made copying this wallet with $40?', { wallet: W }).params.wallet, W);
});

test('glossary explains terms in plain words with no SOL talk', () => {
  for (const t of ['slippage', 'market cap', 'liquidity', 'anti-mev', 'bonding curve', 'graduated', 'rug pull', 'priority fee', 'kol', 'smart money', 'sniping', 'win rate']) {
    const e = explainTerm(t);
    assert.ok(e && e.length > 30, t);
    assert.doesNotMatch(e, /\bSOL\b|lamport/i, t);
  }
});

test('answers carry USD evidence and point at an action', async () => {
  const svc = {
    suggestions: async () => ({ picks: [{ wallet: W, name: null, style: 'graduated', match: 'match', perWeekUsd: 19.88, netUsd: 39.77, periodDays: 14, headline: 'With $25.00 a trade you would have made about +$19.88 a week', reasons: ['a', 'b'] }], note: '' }),
    boards: async () => ({ graduated: [{ wallet: W, fits: true, keepPerWeekUsd: 12, reasons: ['Made $675.00 on 30 finished graduated trades (won 19 of 30).'] }], early: [], snipe: [] }),
    profiles: () => [],
    user: () => ({ sizeUsd: 25 }),
  };
  const a = await answer('Find the best trader who buys graduated coins.', {}, svc);
  assert.match(a.text, /\$/);
  assert.doesNotMatch(a.text, /\bSOL\b/);
  assert.ok(a.actions.some((x) => x.wallet === W));
});
