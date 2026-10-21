import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendTraders, opportunitiesForYou } from '../src/intel/advisor.js';
import { feeModel } from '../src/money/fees.js';

const prefs = { minCoinsPerDay: 1, maxCoinsPerDay: 3, maxHoldSec: 2 * 3600, sizeUsd: 25, dailyTargetUsd: 50 };
const NOW = 100 * 86400;
const outs = (nets, startDay = 95) => nets.map((n, i) => ({ symbol: `C${i}`, token: `T${i}`, entryTs: (startDay + Math.floor(i / 2)) * 86400 + i * 60, status: 'closed', followerNetUsd: n, followerCaptured: (25 + n) / 25, tokenMaxMultiple: 4, walletCaptured: 2.5, entryMcapUsd: 30_000, holdSec: 3000 }));
const ex = (o) => ({ trades: 10, copiedTrades: 10, followerNetUsd: 120, followerWins: 7, followerLosses: 3, edgeKeptPct: 60, followerCaptured: { 3: 2, 5: 1, 7: 0, 10: 0, 19: 0 }, found: { 3: 4, 5: 2, 7: 1, 10: 0, 19: 0 }, ...o });
const board = [
  { wallet: 'BUSY', name: null, coinsPerActiveDay: 18.3, medianHoldSec: 60, flags: ['SNIPER_SPEED'], isExplosive: true, perActiveDayUsd: 63.9, explosive: ex({ followerNetUsd: 724, edgeKeptPct: 538 }), outcomes: outs([90, 80, 70, 60]), lastTs: NOW - 600 },
  { wallet: 'GOOD', name: '@good', coinsPerActiveDay: 2.1, medianHoldSec: 3000, flags: [], isExplosive: true, perActiveDayUsd: 24, explosive: ex({}), outcomes: outs([40, 30, -10, 60, 5, -5]), lastTs: NOW - 720 },
  { wallet: 'OKAY', name: null, coinsPerActiveDay: 4.5, medianHoldSec: 1800, flags: [], isExplosive: true, perActiveDayUsd: 18, explosive: ex({ followerNetUsd: 80 }), outcomes: outs([10, 10, 10, 10]), lastTs: NOW - 3600 },
  { wallet: 'LOSER', name: null, coinsPerActiveDay: 2, medianHoldSec: 3000, flags: [], isExplosive: false, perActiveDayUsd: -5, explosive: ex({ followerNetUsd: -40 }), outcomes: outs([-10, -30]), lastTs: NOW - 100 },
];
const profiles = new Map(board.map((r) => [r.wallet, { wallet: r.wallet, coinsPerActiveDay: r.coinsPerActiveDay, medianHoldSec: r.medianHoldSec, stageMix: { snipe: 0, early: 0.2, graduated: 0.8 }, entryMcap: { p50: 90_000 }, entryAgeSec: { p50: 3600 }, sellPattern: { oneShot: 0.6, scaled: 0.4 }, addsPerPosition: 0.1, closedCount: 20, wins: 12, realizedUsd: 500, lastTs: r.lastTs }]));

test('recommendations put wallets that fit your style first and explain why in one sentence', () => {
  const r = recommendTraders(board, profiles, prefs, { nowSec: NOW });
  assert.deepEqual(r.picks.map((p) => p.wallet), ['GOOD', 'OKAY']);
  const g = r.picks[0];
  assert.equal(g.fit.level, 'fits');
  assert.equal(g.type.type, 'graduated');
  assert.match(g.why, /graduated/i);
  assert.match(g.why, /\$120\.00/);
  assert.equal(g.copy.netUsd, 120);
  assert.equal(g.lastActiveSec, 720);
  assert.ok(g.days.activeDays >= 2);
  assert.equal(r.picks[1].fit.level, 'close');
});

test('high earners that do not fit are named with the reason, not silently dropped', () => {
  const r = recommendTraders(board, profiles, prefs, { nowSec: NOW });
  const busy = r.skipped.find((s) => s.wallet === 'BUSY');
  assert.ok(busy, 'the +$724 wallet is explained');
  assert.ok(busy.reasons.some((x) => /18\.3 coins a day/.test(x)));
  assert.ok(busy.reasons.some((x) => /cannot be trusted/.test(x)));
  assert.equal(r.skipped[0].wallet, 'BUSY', 'biggest headline numbers explained first');
});

test('opportunities separate the coin\'s theoretical multiple from what a follower realistically captured', () => {
  const rate = { usdPerSol: 100, source: 't', at: 0 };
  const fees = feeModel({ rate, networkSolPerTx: 0.002 });
  const explosive = [{ address: 'MINT', symbol: 'ZAP', marketCapUsd: 40_000, ageSec: 900, progress: 0.9, momentum: { score: 82, stage: 'Ignition', reasons: ['40 buys a minute right now.'], warnings: [] }, explosiveIn: [{ wallet: 'GOOD' }] }];
  const study = { followableMedian: 3.4, examples: 20, tenXFollowable: 2 };
  const o = opportunitiesForYou(explosive, { study, fees, sizeUsd: 25, targetUsd: 50, picks: [{ wallet: 'GOOD', name: '@good' }] });
  const z = o[0];
  assert.equal(z.symbol, 'ZAP');
  assert.ok(z.realistic.multiple === 3.4 && z.realistic.netUsd > 50 && z.realistic.netUsd < 70, 'a 3.4x follower capture on $25 after fees');
  assert.ok(z.theoretical.multiple === 10 && z.theoretical.netUsd > 200);
  assert.match(z.realistic.text, /past runners/);
  assert.match(z.targetText, /of your \$50 target/);
  assert.ok(z.walletsIn.some((w) => w.name === '@good'), 'your recommended trader is in it');
  assert.match(z.entry, /Ignition/);
  assert.match(z.exit, /30%/);
});

test('a trader that rides losers to zero is marked down, and every pick shows its exit habits', () => {
  const zero = (n) => ({ symbol: 'Z', entryTs: 95 * 86400 + n, status: 'closed', followerNetUsd: 5, walletCaptured: n % 2 ? 0.05 : 2.2 });
  const b = [{ ...board[1], wallet: 'RIDER', outcomes: Array.from({ length: 8 }, (_, i) => zero(i)) }];
  const r = recommendTraders(b, new Map(), prefs, { nowSec: NOW });
  const p = r.picks[0];
  assert.equal(p.exits.rodeToZero, 4);
  assert.equal(p.fit.level, 'close');
  assert.ok(p.fit.reasons.some((x) => /almost zero/.test(x)));
});

test('coins failing the hard filters never become opportunities; fresh migrations are their own kind', () => {
  const rate = { usdPerSol: 100, source: 't', at: 0 };
  const fees = feeModel({ rate, networkSolPerTx: 0.002 });
  const ok = { pass: true, checks: [{ key: 'mint', ok: true, text: 'Mint authority revoked.' }] };
  const coins = [
    { address: 'BAD', symbol: 'BAD', marketCapUsd: 30_000, momentum: { score: 90, stage: 'Ignition', reasons: [], warnings: [] }, checks: { pass: false, checks: [{ key: 'mint', ok: false, hard: true, text: 'Mint authority active.' }] } },
    { address: 'GOOD', symbol: 'GOOD', marketCapUsd: 30_000, momentum: { score: 70, stage: 'Ignition', reasons: [], warnings: [] }, checks: ok },
  ];
  const o = opportunitiesForYou(coins, { study: { followableMedian: 3 }, fees, sizeUsd: 25 });
  assert.deepEqual(o.map((x) => x.symbol), ['GOOD']);
  assert.equal(o[0].kind, 'momentum');
  assert.deepEqual(o[0].checks.checks.map((c) => c.key), ['mint']);
  const m = opportunitiesForYou([{ ...coins[1], completeTs: 1000, progress: 1 }], { study: { followableMedian: 3, migrationMedian: 1.8 }, fees, sizeUsd: 25, kind: 'migration' });
  assert.equal(m[0].kind, 'migration');
  assert.equal(m[0].realistic.multiple, 1.8, 'migration plays use what followers made entering at graduation');
  assert.match(m[0].entry, /graduated/i);
});
