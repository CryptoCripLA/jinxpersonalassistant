import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestWallets } from '../src/analysis/suggest.js';
import { feeModel } from '../src/money/fees.js';

const rate = { usdPerSol: 100, source: 't', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0.002 });
const DAY = 86400;

const mkProfile = (wallet, o = {}) => {
  const positions = Array.from({ length: 12 }, (_, i) => ({
    token: `${wallet}${i}`, status: 'closed', entryStage: 'graduated', openTs: 1_800_000_000 + i * DAY, closeTs: 1_800_000_000 + i * DAY + 1800,
    holdSec: 1800, returnRatio: o.ret ?? 0.3, realizedUsd: 30, sells: [{}], buys: [{ usd: 100, dexFeeUsd: 1 }],
  }));
  return {
    wallet, positions, closedCount: 12, openCount: 0, spanDays: 12, coinsPerActiveDay: o.coins ?? 2, medianHoldSec: o.hold ?? 1800,
    shareHeldUnder2h: o.share ?? 1, winRate: 0.7, wins: 8, realizedUsd: 360, medianCopyWindowSec: 1800,
    stageMix: { graduated: 1, early: 0, snipe: 0, unknown: 0 }, flags: o.flags ?? [], gmgn30: null, ...o.extra,
  };
};

const fakeSim = (perWallet) => async (profile) => ({
  typical: { netUsd: perWallet[profile.wallet], wins: 6, losses: 4, taken: 10, txCount: 20, feesUsd: 9 },
  rough: { netUsd: perWallet[profile.wallet] - 10 },
  wallet: { realizedUsd: 300 },
  assumptions: { delaySec: 5 },
  unavailable: 0,
  periodDays: 14,
});

test('suggests 3-5 wallets by what you would have kept, best first, in dollars', async () => {
  const ps = ['A', 'B', 'C', 'D', 'E', 'F'].map((w) => mkProfile(w));
  const sim = fakeSim({ A: 40, B: 90, C: 10, D: 60, E: 25, F: -5 });
  const s = await suggestWallets({ profiles: ps, sizeUsd: 25, capitalUsd: 100, fees, simulate: sim });
  assert.deepEqual(s.picks.map((p) => p.wallet), ['B', 'D', 'A', 'E', 'C']);
  assert.ok(s.picks.length >= 3 && s.picks.length <= 5);
  assert.match(s.picks[0].headline, /\$/);
  assert.doesNotMatch(JSON.stringify(s), /\bSOL\b/);
  assert.ok(Math.abs(s.picks[0].perWeekUsd - (90 / 14) * 7) < 1e-9);
});

test('never suggests a wallet that loses you money, bots, or wallets with too little history', async () => {
  const ps = [
    mkProfile('GOOD'),
    mkProfile('LOSE'),
    mkProfile('BOT', { flags: ['bot-speed'] }),
    mkProfile('NEW', { extra: { spanDays: 1 } }),
  ];
  const s = await suggestWallets({ profiles: ps, sizeUsd: 25, capitalUsd: 100, fees, simulate: fakeSim({ GOOD: 20, LOSE: -3, BOT: 500, NEW: 500 }) });
  assert.deepEqual(s.picks.map((p) => p.wallet), ['GOOD']);
  assert.match(s.note, /only 1/i);
});

test('close matches are labelled when they break one of your style rules', async () => {
  const ps = [mkProfile('HOLDER', { hold: 3 * 3600, share: 0.45 })];
  const s = await suggestWallets({ profiles: ps, sizeUsd: 25, capitalUsd: 100, fees, simulate: fakeSim({ HOLDER: 30 }) });
  assert.equal(s.picks[0].match, 'close match');
  assert.ok(s.picks[0].differences.some((d) => /hours/.test(d)));
});
