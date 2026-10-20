// Explosive-wallet job: for every profiled wallet, measure each recent trade three ways
// (how high the coin went after the buy, what the wallet sold for, what a $25 copy a few
// seconds late would have made) and store the result for the Wallets board.
import { simulateCopy } from '../analysis/simulate.js';
import { peakAfter, tradeOutcome, explosiveProfile, rankExplosive, walletFlags, PEAK_HORIZON_SEC } from '../analysis/explosive.js';
import { loadProfiles } from '../discovery/discover.js';

export async function analyzeWallet(g, profile, { sizeUsd = 25, delaySec = 5, impactPct = 0.5, fees, days = 14, maxPositions = 40, nowSec = Math.floor(Date.now() / 1000), log = () => {} } = {}) {
  const from = nowSec - days * 86400;
  const positions = profile.positions
    .filter((p) => p.openTs >= from)
    .sort((a, b) => a.openTs - b.openTs)
    .slice(-maxPositions);
  // Cash never binds here: each trade is judged on its own, not on your balance that day.
  const sim = await simulateCopy({
    positions, sizeUsd, startCapitalUsd: 1e9, delaySec, impactPct, fees,
    candlesFor: (token, a, b) => g.candles(token, Math.floor(a), Math.ceil(b)),
  });
  const outcomes = [];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    let peak = null;
    try {
      const k = await g.klineRange(p.token, '5m', p.openTs - 300, Math.min(nowSec, p.openTs + PEAK_HORIZON_SEC));
      peak = peakAfter(k.candles, p.openTs, PEAK_HORIZON_SEC, k.resSec);
    } catch (e) {
      log(`peak unavailable for ${p.symbol}: ${e.message}`);
      if (e.code === 'RATE') throw e;
    }
    outcomes.push(tradeOutcome(p, { peak, follower: sim.rows[i], sizeUsd }));
  }
  const id = profile.gmgn30?.identity;
  return {
    wallet: profile.wallet,
    name: id?.twitter ? `@${id.twitter}` : id?.name || null,
    tags: id?.tags ?? [],
    coinsPerActiveDay: profile.coinsPerActiveDay,
    medianHoldSec: profile.medianHoldSec ?? null,
    lastTs: profile.lastTs,
    stageMix: profile.stageMix ?? null,
    discovery: profile.discovery ?? null,
    flags: walletFlags({ positions: profile.positions, lastTs: profile.lastTs, nowSec }),
    explosive: explosiveProfile(outcomes, { sizeUsd }),
    outcomes,
    sizeUsd, delaySec, periodDays: days, analyzedAt: nowSec,
    simResolution: sim.assumptions?.resolution ?? null,
  };
}

export function saveExplosive(db, row) {
  db.prepare(`INSERT INTO explosive_profiles (wallet, data, built_at) VALUES (?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET data = excluded.data, built_at = excluded.built_at`).run(row.wallet, JSON.stringify(row), Date.now());
}

export async function runExplosiveAnalysis(g, db, { wallets = null, days = 14, onProgress = () => {}, log = () => {}, ...opts } = {}) {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  let profiles = loadProfiles(db).filter((p) => (wallets ? wallets.includes(p.wallet) : true));
  profiles = profiles.filter((p) => p.positions?.some((x) => x.openTs >= nowSec - days * 86400));
  profiles.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
  let analyzed = 0;
  let failed = 0;
  for (const p of profiles) {
    onProgress({ phase: 'measuring wallets', done: analyzed + failed, total: profiles.length });
    try {
      saveExplosive(db, await analyzeWallet(g, p, { ...opts, days, nowSec, log }));
      analyzed += 1;
    } catch (e) {
      failed += 1;
      log(`explosive analysis failed for ${p.wallet}: ${e.message}`);
      if (e.code === 'RATE') break;
    }
  }
  onProgress({ phase: 'done', done: analyzed + failed, total: profiles.length });
  return { analyzed, failed, total: profiles.length };
}

export function loadExplosive(db, { maxCoinsPerDay = 3 } = {}) {
  const rows = db.prepare('SELECT data, built_at FROM explosive_profiles').all().map((r) => ({ ...JSON.parse(r.data), builtAt: r.built_at }));
  return rankExplosive(rows, { maxCoinsPerDay });
}
