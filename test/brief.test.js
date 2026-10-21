import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brief } from '../src/assistant/brief.js';

const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const W = 'J95t5ynghKnt445p8CD5PtdNNALFJR5b8i859V7kWbsJ';
const pick = { wallet: W, name: '@good', type: { label: 'Graduated-coin trader', plain: 'Buys graduated coins.' }, fit: { level: 'fits', reasons: [], good: ['Buys about 2.1 coins a day, inside your 1 to 3.'] }, copy: { netUsd: 120, trades: 10, sizeUsd: 25 }, days: { activeDays: 6, hitDays: 2, medianDayUsd: 18 }, why: 'Graduated-coin trader: buys graduated coins.', lastActiveSec: 720 };
const opp = { address: MINT, symbol: 'ZAP', marketCapUsd: 40_000, momentum: { score: 82, stage: 'Ignition', reasons: ['40 buys a minute right now.'], warnings: [] }, realistic: { multiple: 3.4, netUsd: 55.8, text: 'If it gives a follower what past runners typically did (3.4x)…' }, theoretical: { multiple: 10, netUsd: 212.9, text: 'A full 10x…' }, targetText: 'A 3.4x would cover 100% of your $50 target.', evidence: ['40 buys a minute right now.'], walletsIn: [{ wallet: W, name: '@good' }] };
const svc = {
  user: () => ({ sizeUsd: 25, prefs: { dailyTargetUsd: 50, maxCoinsPerDay: 3, minCoinsPerDay: 1 } }),
  today: async () => ({ traders: { picks: [pick], skipped: [{ wallet: 'BUSY', copy: { netUsd: 724 }, reasons: ['Buys about 18.3 coins a day; you want 1 to 3.'] }] }, opportunities: [opp], plan: { text: 'To make $50.00 today…' }, account: { cashUsd: 46.74, availableUsd: 45.74 } }),
  coin: async () => ({ address: MINT, symbol: 'ZAP', marketCapUsd: 40_000, momentum: { score: 82, stage: 'Ignition', reasons: ['40 buys a minute right now.'], warnings: [], disqualified: null }, early: { summary: { text: 'Of the first 20 buyers, 12 are in profit; 7 of the 12 still hold.' } }, explosiveIn: [{ wallet: W, name: '@good' }], scenario: { breakevenMultiple: 1.06 } }),
  traderCard: async () => pick,
  copyState: () => ({ watches: [], config: { mode: 'off' } }),
};

test('Today briefing leads with what to do: best trader, best opportunity, and the target math', async () => {
  const b = await brief({ view: 'today' }, svc);
  assert.match(b.text, /@good/);
  assert.match(b.text, /ZAP/);
  assert.ok(b.evidence.some((e) => /\$50/.test(e)));
  assert.ok(b.evidence.some((e) => /skipped/i.test(e) && /18\.3/.test(e)), 'says which headline wallet it rejected and why');
  assert.ok(b.actions.some((a) => a.kind === 'copy' && a.wallet === W));
  assert.ok(b.actions.some((a) => a.kind === 'coin' && a.address === MINT));
});

test('a coin briefing gives a verdict, the evidence, and realistic versus theoretical dollars', async () => {
  const b = await brief({ view: 'coin', coin: { address: MINT } }, svc);
  assert.match(b.text, /^ZAP: worth a small try/i);
  assert.ok(b.evidence.some((e) => /40 buys a minute/.test(e)));
  assert.ok(b.evidence.some((e) => /@good/.test(e)));
  assert.equal(b.label, 'LIVE');
});

test('a wallet briefing says copy, watch or skip, and why', async () => {
  const b = await brief({ view: 'wallet', wallet: W }, svc);
  assert.match(b.text, /^Copy-worthy/);
  assert.match(b.text, /Graduated-coin trader/);
  assert.ok(b.evidence.some((e) => /\$120\.00/.test(e)));
  assert.ok(b.actions.some((a) => a.kind === 'copy'));
});

test('an empty copy desk is explained and resolved with a one-click suggestion', async () => {
  const b = await brief({ view: 'desk' }, svc);
  assert.match(b.text, /not copying anyone yet/i);
  assert.ok(b.actions.some((a) => a.kind === 'copy' && a.wallet === W));
});
