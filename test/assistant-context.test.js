import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, answer } from '../src/assistant/router.js';
import { ELEMENTS, explainElement } from '../src/assistant/explain.js';

const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const W = 'J95t5ynghKnt445p8CD5PtdNNALFJR5b8i859V7kWbsJ';

test('every explainable element says what it does, why it matters for big moves, and what good traders do', () => {
  assert.ok(Object.keys(ELEMENTS).length >= 30);
  for (const [k, e] of Object.entries(ELEMENTS)) {
    assert.ok(e.title && e.what && e.why && e.pros, k);
    assert.doesNotMatch(`${e.what} ${e.why} ${e.pros}`, /\bSOL\b|lamport/i, k);
  }
});

test('"explain this" uses the element you clicked and its live value', () => {
  assert.equal(classify('explain this', { element: { key: 'coin.momentum' } }).intent, 'explain_element');
  assert.equal(classify('What does this button do?', { element: { key: 'trade.buy' } }).intent, 'explain_element');
  const a = explainElement({ key: 'coin.momentum', value: '82', label: 'Momentum 82' }, { coin: { symbol: 'ZAP' } });
  assert.match(a.text, /Momentum score/);
  assert.match(a.text, /82/);
  assert.ok(a.evidence.length >= 2);
});

test('the owner\'s example questions map to intents using what is on screen', () => {
  const ctx = { coin: { address: MINT, symbol: 'ZAP' }, wallet: W };
  assert.equal(classify('Why is this coin pumping?', ctx).intent, 'why_pumping');
  assert.equal(classify('Who bought before everyone else?', ctx).intent, 'first_buyers');
  assert.equal(classify('Are the early profitable wallets still holding?', ctx).intent, 'early_holding');
  assert.deepEqual(classify('Could this coin realistically reach 10x from here?', ctx), { intent: 'reach_multiple', params: { coin: MINT, multiple: 10 } });
  assert.deepEqual(classify('What happens if I put $25 into this?', ctx), { intent: 'scenario', params: { coin: MINT, sizeUsd: 25, multiple: null } });
  assert.deepEqual(classify('How much could $25 make if this reaches 7x?', ctx), { intent: 'scenario', params: { coin: MINT, sizeUsd: 25, multiple: 7 } });
  assert.equal(classify('When are the profitable wallets selling?', ctx).intent, 'when_selling');
  assert.equal(classify('Which wallet repeatedly catches explosive moves?', ctx).intent, 'explosive_wallets');
  assert.equal(classify('Show me the explosive wallets', ctx).intent, 'explosive_wallets');
  assert.equal(classify('Find traders getting in before graduation', ctx).intent, 'before_graduation');
  assert.deepEqual(classify('Show me what this wallet did on its last 10 coins', ctx), { intent: 'wallet_last', params: { wallet: W, count: 10 } });
  assert.equal(classify("What's the most promising opportunity right now?", ctx).intent, 'opportunity');
  assert.equal(classify("What's the most promising opportunity right now?", ctx).params.category, 'explosive');
  assert.equal(classify('Which of these coins has the strongest early momentum?', ctx).params.category, 'explosive');
  assert.equal(classify('Why did that trader sell?', ctx).intent, 'when_selling');
  assert.notEqual(classify('Is this coin worth touching for a quick 2x?', ctx).intent, 'opportunity', 'a question about the open coin is not a "best coin" search');
  assert.equal(classify('Should I buy this coin?', ctx).intent, 'coin_verdict');
});

const coin = {
  address: MINT, symbol: 'ZAP', marketCapUsd: 50_000, ageSec: 1800, changes: { m5: 0.6, h1: 2.1 },
  momentum: { score: 78, stage: 'Ignition', reasons: ['40 buys a minute right now.', '3 smart-money wallets holding (GMGN tag).'], warnings: ['The creator\'s team still holds 8%.'] },
  early: { source: 'pump.fun trades', summary: { text: 'Of the first 20 buyers, 12 are in profit; 7 of the 12 profitable early wallets still hold. 2 early wallets sold in the last 15 minutes.' },
    buyers: [{ wallet: 'A1', rank: 1, secondsAfterLaunch: 4, entryMcapUsd: 5000, multipleNow: 10, stillHolding: true, profitUsd: 400, explosive: true, explosiveName: '@fast' }, { wallet: 'B2', rank: 2, secondsAfterLaunch: 9, entryMcapUsd: 6000, multipleNow: 8.3, stillHolding: false, profitUsd: 90, capturedMultiple: 4, lastSellTs: 1000 }] },
  explosiveIn: [{ wallet: 'A1', name: '@fast' }],
  scenario: { breakevenMultiple: 1.058, rows: [{ multiple: 7, targetMarketCapUsd: 350_000, proceedsUsd: 166.5, netUsd: 141.5, text: 'At 7x (market cap $350K), $25 becomes about $166.50 after fees (+$141.50).' }, { multiple: 10, targetMarketCapUsd: 500_000, proceedsUsd: 237.94, netUsd: 212.94, text: 'At 10x ...' }, { multiple: 0, netUsd: -25, text: 'If it goes to zero, the $25 is gone.' }] },
};
const svc = {
  user: () => ({ sizeUsd: 25 }),
  coin: async () => coin,
  scenarioFor: async (c, size) => coin.scenario,
  studyStats: () => ({ examples: 26, reachedFromBase: (base, m) => ({ count: 9, of: 26 }) }),
  explosiveBoard: () => [{ wallet: W, name: '@hunter', isExplosive: true, perActiveDayUsd: 61, explosive: { followerCaptured: { 3: 4, 5: 2, 7: 1, 10: 0, 19: 0 }, found: { 7: 5 }, trades: 20, followerNetUsd: 610, edgeKeptPct: 71 }, coinsPerActiveDay: 2, stageMix: { early: 0.7, snipe: 0.1, graduated: 0.2 } }],
  walletExplosive: () => ({ wallet: W, outcomes: Array.from({ length: 12 }, (_, i) => ({ symbol: `C${i}`, tokenMaxMultiple: i + 2, walletCaptured: i + 1, followerCaptured: i, followerNetUsd: 25 * (i - 1), entryMcapUsd: 9000, holdSec: 600, entryTs: i })) }),
  pulseColumns: () => ({ explosive: [{ address: MINT, symbol: 'ZAP', momentum: { score: 78, stage: 'Ignition', reasons: ['40 buys a minute right now.'] }, marketCapUsd: 50_000 }] }),
};

test('why is this coin pumping: live flow, smart money and early-buyer behaviour, with what could go wrong', async () => {
  const a = await answer('Why is this coin pumping?', { coin: { address: MINT, symbol: 'ZAP' } }, svc);
  assert.match(a.text, /ZAP/);
  assert.ok(a.evidence.some((e) => /40 buys a minute/.test(e)));
  assert.ok(a.evidence.some((e) => /@fast/.test(e)));
  assert.ok(a.evidence.some((e) => /creator/i.test(e)), 'risks are part of the answer');
});

test('who bought first lists the earliest wallets with entry market cap and whether they still hold', async () => {
  const a = await answer('Who bought before everyone else?', { coin: { address: MINT } }, svc);
  assert.match(a.text, /A1/);
  assert.ok(a.evidence.some((e) => /\$5K/.test(e) && /still holding/.test(e)));
  assert.ok(a.actions.some((x) => x.kind === 'wallet' && x.wallet === 'A1'));
});

test('could it reach 10x answers with the target market cap, the history base rate and an honest caveat', async () => {
  const a = await answer('Could this coin realistically reach 10x from here?', { coin: { address: MINT } }, svc);
  assert.match(a.text, /\$500K/);
  assert.ok(a.evidence.some((e) => /9 of the 26/.test(e)));
  assert.match(a.text, /not a prediction|no one can know/i);
});

test('the $25 scenario quotes dollars after fees and the break-even rise', async () => {
  const a = await answer('How much could $25 make if this reaches 7x?', { coin: { address: MINT } }, svc);
  assert.match(a.text, /\$166\.50/);
  assert.ok(a.evidence.some((e) => /6%/.test(e)));
  assert.equal(a.label, 'SIMULATED');
});

test('explosive wallets and a wallet\'s last coins come from the measured board, with follower results', async () => {
  const a = await answer('Which wallet repeatedly catches explosive moves?', {}, svc);
  assert.match(a.text, /@hunter/);
  assert.match(a.text, /\$61/);
  assert.ok(a.actions.some((x) => x.kind === 'view' && x.view === 'wallets'));
  const b = await answer('Show me what this wallet did on its last 10 coins', { wallet: W }, svc);
  assert.equal(b.evidence.length, 10);
  assert.match(b.evidence[0], /C11/, 'newest first');
  assert.match(b.evidence[0], /went 13x/);
  assert.equal(b.label, 'HISTORICAL + SIMULATED');
});

test('most promising right now comes from the live Explosive-now column', async () => {
  const a = await answer("What's the most promising opportunity right now?", {}, svc);
  assert.match(a.text, /ZAP/);
  assert.match(a.text, /78/);
  assert.ok(a.actions.some((x) => x.kind === 'coin' && x.address === MINT));
});
