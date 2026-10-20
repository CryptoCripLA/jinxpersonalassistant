import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivity, buildPositions } from '../src/analysis/trades.js';
import { computeProfile, preferenceFit, DEFAULT_PREFS } from '../src/analysis/profile.js';
import { rankWallets, quickKeepEstimate } from '../src/analysis/rank.js';
import { feeModel } from '../src/money/fees.js';

const DAY = 86400;
let n = 0;
const r = (side, ts, usd, amt, token, extra = {}) => ({
  tx_hash: `t${n++}`, event_type: side, timestamp: ts, cost_usd: String(usd), token_amount: String(amt),
  price_usd: String(usd / amt), gas_usd: '0.002', dex_usd: String(usd * 0.0095), launchpad_platform: 'Pump.fun',
  token: { address: token, symbol: token, total_supply: '1000000000' }, ...extra,
});

// A selective trader: 2 coins a day for 5 days, sells each within ~40 minutes, wins 7 of 10.
function selectiveWallet() {
  const rows = [];
  for (let d = 0; d < 5; d++) {
    for (let k = 0; k < 2; k++) {
      const tok = `D${d}K${k}`;
      const t0 = 1_800_000_000 + d * DAY + k * 3600;
      const win = (d * 2 + k) % 10 < 7;
      rows.push(r('buy', t0, 100, 1000, tok));
      rows.push(r('sell', t0 + 2400, win ? 180 : 60, 1000, tok));
    }
  }
  return rows;
}

const meta = (tok) => ({ creationTs: 1_700_000_000, migratedAt: 1_700_000_100, launchpad: 'pump' }); // all graduated entries

test('profile measures the behaviour the owner asked for', () => {
  const { positions, orphanSells } = buildPositions(selectiveWallet().map(normalizeActivity));
  const p = computeProfile({ wallet: 'W1', positions, orphanSells, metaByToken: meta });
  assert.equal(p.closedCount, 10);
  assert.equal(p.activeDays, 5);
  assert.equal(p.coinsPerActiveDay, 2);
  assert.equal(p.medianHoldSec, 2400);
  assert.equal(p.shareHeldUnder2h, 1);
  assert.equal(p.winRate, 0.7);
  assert.equal(p.realizedUsd, 7 * 80 - 3 * 40);
  assert.equal(p.stageMix.graduated, 1);
  assert.equal(p.medianBuyUsd, 100);
  assert.ok(p.feesUsd > 0);
  const fit = preferenceFit(p, DEFAULT_PREFS);
  assert.equal(fit.fits, true, fit.reasons.join('; '));
});

test('a 300-trades-a-day bot does not fit and says why in plain words', () => {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const tok = `B${i}`;
    rows.push(r('buy', 1_800_000_000 + i * 200, 50, 500, tok));
    rows.push(r('sell', 1_800_000_000 + i * 200 + 8, 51, 500, tok));
  }
  const { positions } = buildPositions(rows.map(normalizeActivity));
  const p = computeProfile({ wallet: 'BOT', positions, metaByToken: meta });
  const fit = preferenceFit(p, DEFAULT_PREFS);
  assert.equal(fit.fits, false);
  assert.ok(fit.reasons.some((x) => /coins a day/.test(x)), fit.reasons.join('; '));
  assert.ok(p.flags.includes('bot-speed'), 'sells within seconds are flagged');
});

test('quick keep estimate charges every follow-sell its own network fee', () => {
  const rate = { usdPerSol: 100, source: 't', at: 0 };
  const fees = feeModel({ rate, networkSolPerTx: 0.003 });
  const pos = { status: 'closed', returnRatio: 0.5, sells: [{}, {}, {}], buys: [{ usd: 100, dexFeeUsd: 1 }], entryStage: 'graduated' };
  const est = quickKeepEstimate([pos], { sizeUsd: 20, fees });
  // gross +$10; GMGN 1% buy $0.20 + sells on $30 out $0.30; venue 1% of buy $0.20 + $0.30; network 4 tx * $0.30
  assert.equal(est.grossUsd, 10);
  assert.equal(est.txCount, 4);
  assert.ok(Math.abs(est.feesUsd - (0.2 + 0.3 + 0.2 + 0.3 + 1.2)) < 1e-9, String(est.feesUsd));
  assert.ok(Math.abs(est.keepUsd - (10 - 2.2)) < 1e-9);
});

test('rankings are separate per entry stage and ordered by what you would keep', () => {
  const rate = { usdPerSol: 100, source: 't', at: 0 };
  const fees = feeModel({ rate, networkSolPerTx: 0.003 });
  const { positions } = buildPositions(selectiveWallet().map(normalizeActivity));
  const good = computeProfile({ wallet: 'GOOD', positions, metaByToken: meta });
  const flat = computeProfile({
    wallet: 'FLAT',
    positions: buildPositions(selectiveWallet().map((x) => ({ ...x, cost_usd: x.event_type === 'sell' ? '101' : '100' })).map(normalizeActivity)).positions,
    metaByToken: meta,
  });
  const ranks = rankWallets([flat, good], { sizeUsd: 25, fees, prefs: DEFAULT_PREFS });
  assert.equal(ranks.graduated[0].wallet, 'GOOD');
  assert.ok(ranks.graduated[0].keepPerWeekUsd > ranks.graduated[1].keepPerWeekUsd);
  assert.equal(ranks.snipe.length, 0, 'no wallet sniped, so the snipe board is empty');
  assert.ok(ranks.graduated[0].reasons.length >= 3);
});
