// Explosive-move intelligence: who keeps catching 3x-19x+ moves, how much of each move they
// actually captured, and how much a follower copying them a few seconds late would have kept.
//
// Three numbers are always kept apart:
//   tokenMaxMultiple  - how high the coin went after the wallet bought (the opportunity)
//   walletCaptured    - what the wallet actually sold for, as a multiple of its cost
//   followerCaptured  - what YOUR $size copy would have returned (copy simulator replay)
//
// Copyability ("edge kept") and the bot/distributor flags are adapted from Kelows/million
// (MIT, https://github.com/Kelows/million @ c89ad07, apps/api/src/copyability/copyability.service.ts
// and apps/api/src/analysis/metrics.ts), re-derived for GMGN round trips instead of Helius txs.

export const MULTIPLE_STEPS = [3, 5, 7, 10, 19];
export const PEAK_HORIZON_SEC = 8 * 3600; // "minutes to hours": the move must happen within 8 hours of the buy
const MIN_WALLET_RET = 0.05; // below 5% average return the edge ratio divides by noise (million: MIN_WHALE_RET_PCT)

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const median = (xs) => {
  const a = xs.filter(isNum).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (xs) => {
  const a = xs.filter(isNum);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
const countAtLeast = (xs) => Object.fromEntries(MULTIPLE_STEPS.map((m) => [m, xs.filter((x) => isNum(x) && x >= m).length]));

// Highest candle body (open/close) overlapping [fromTs, fromTs + horizonSec]; candle t is its
// start in seconds. Bodies, not wicks: one dust trade can print a wick nobody could sell into.
export function peakAfter(candles, fromTs, horizonSec, resSec) {
  let best = null;
  for (const k of candles ?? []) {
    if (k.t + resSec <= fromTs || k.t > fromTs + horizonSec) continue;
    const top = Math.max(k.open, k.close);
    if (!isNum(top)) continue;
    if (!best || top > best.peakPrice) best = { peakPrice: top, peakTs: Math.max(k.t, fromTs) };
  }
  return best;
}

export function tradeOutcome(p, { peak = null, follower = null, sizeUsd = 25 } = {}) {
  const entryPriceUsd = p.buys?.[0]?.priceUsd ?? p.entryPriceUsd ?? null;
  const tokenMaxMultiple = peak && isNum(entryPriceUsd) && entryPriceUsd > 0 ? peak.peakPrice / entryPriceUsd : null;
  const walletCaptured = p.status === 'closed' && p.buyUsd > 0 ? p.sellUsd / p.buyUsd : null;
  const followerNetUsd = isNum(follower?.myNetUsd) ? follower.myNetUsd : null;
  return {
    token: p.token,
    symbol: p.symbol,
    status: p.status,
    entryTs: p.openTs,
    exitTs: p.closeTs ?? null,
    holdSec: p.holdSec ?? null,
    entryPriceUsd,
    entryMcapUsd: p.entryMcapUsd ?? null,
    walletSpentUsd: p.buyUsd ?? null,
    tokenMaxMultiple,
    peakMcapUsd: tokenMaxMultiple != null && isNum(p.entryMcapUsd) ? p.entryMcapUsd * tokenMaxMultiple : null,
    peakTs: peak?.peakTs ?? null,
    timeToPeakSec: peak ? peak.peakTs - p.openTs : null,
    walletCaptured,
    missedUpside: tokenMaxMultiple != null && walletCaptured > 0 ? tokenMaxMultiple / walletCaptured : null,
    followerEntryPrice: follower?.myEntryPrice ?? null,
    followerExitPrice: follower?.myExitPrice ?? null,
    followerNetUsd,
    followerCaptured: followerNetUsd != null ? (sizeUsd + followerNetUsd) / sizeUsd : null,
    followerNote: follower?.note || '',
  };
}

export function explosiveProfile(outcomes, { sizeUsd = 25 } = {}) {
  const closed = outcomes.filter((o) => o.status === 'closed' && isNum(o.walletCaptured));
  const copied = closed.filter((o) => isNum(o.followerNetUsd));
  const losers = closed.filter((o) => o.walletCaptured < 1);
  const walletAvgRet = mean(closed.map((o) => o.walletCaptured - 1));
  const followerAvgRet = mean(copied.map((o) => o.followerCaptured - 1));
  const followerNetUsd = copied.reduce((s, o) => s + o.followerNetUsd, 0);
  return {
    trades: closed.length,
    copiedTrades: copied.length,
    found: countAtLeast(outcomes.map((o) => o.tokenMaxMultiple)),
    captured: countAtLeast(closed.map((o) => o.walletCaptured)),
    followerCaptured: countAtLeast(copied.map((o) => o.followerCaptured)),
    losses: losers.length,
    avgLossPct: mean(losers.map((o) => 1 - o.walletCaptured)),
    worstLossPct: losers.length ? Math.max(...losers.map((o) => 1 - o.walletCaptured)) : null,
    bestTokenMultiple: Math.max(0, ...outcomes.map((o) => o.tokenMaxMultiple).filter(isNum)) || null,
    bestWalletMultiple: Math.max(0, ...closed.map((o) => o.walletCaptured)) || null,
    bestFollowerMultiple: Math.max(0, ...copied.map((o) => o.followerCaptured)) || null,
    medianCaptureShare: median(closed.filter((o) => o.tokenMaxMultiple > 1).map((o) => Math.min(1, Math.max(0, (o.walletCaptured - 1) / (o.tokenMaxMultiple - 1))))),
    medianHoldSec: median(closed.map((o) => o.holdSec)),
    medianEntryMcapUsd: median(outcomes.map((o) => o.entryMcapUsd)),
    medianTimeToPeakSec: median(outcomes.filter((o) => o.tokenMaxMultiple >= 3).map((o) => o.timeToPeakSec)),
    followerNetUsd: copied.length ? followerNetUsd : null,
    avgFollowerNetUsd: copied.length ? followerNetUsd / copied.length : null,
    followerWins: copied.filter((o) => o.followerNetUsd > 0).length,
    followerLosses: copied.filter((o) => o.followerNetUsd < 0).length,
    edgeKeptPct: walletAvgRet != null && walletAvgRet >= MIN_WALLET_RET && followerAvgRet != null ? (followerAvgRet / walletAvgRet) * 100 : null,
    sizeUsd,
  };
}

// A replay where copiers beat a wallet that flips within 10 minutes is a candle-resolution
// artifact (the follower is filled at a 30-second candle's price, not the wallet's real fill),
// so its dollars say nothing about copying it. Slow holders can legitimately be beaten.
export const UNTRUSTED_HOLD_SEC = 600;
export function replayTrusted(r) {
  const edge = r.explosive?.edgeKeptPct;
  return !(isNum(edge) && edge > 100 && isNum(r.medianHoldSec) && r.medianHoldSec < UNTRUSTED_HOLD_SEC);
}

// Ranks by what a follower could realistically have banked per active day: the average
// copied-trade result times the coins a day you would actually take (your 1-3, not the
// wallet's 30). Wallets that never handed a follower a 3x are listed after every one that did,
// and replays that cannot be trusted come last.
export function rankExplosive(rows, { maxCoinsPerDay = 3 } = {}) {
  return rows
    .map((r) => {
      const ex = r.explosive ?? {};
      const perDay = Math.min(r.coinsPerActiveDay ?? 1, maxCoinsPerDay);
      const trusted = replayTrusted(r);
      return {
        ...r,
        replayTrusted: trusted,
        isExplosive: trusted && (ex.followerCaptured?.[3] ?? 0) > 0,
        perActiveDayUsd: isNum(ex.avgFollowerNetUsd) ? ex.avgFollowerNetUsd * perDay : null,
      };
    })
    .sort((a, b) => Number(b.replayTrusted) - Number(a.replayTrusted)
      || Number(b.isExplosive) - Number(a.isExplosive)
      || (b.perActiveDayUsd ?? -Infinity) - (a.perActiveDayUsd ?? -Infinity)
      || (b.explosive?.followerCaptured?.[5] ?? 0) - (a.explosive?.followerCaptured?.[5] ?? 0));
}

// Structural red flags (million metrics.ts): machine-speed flippers, distribution pipes,
// farmed win rates, thin samples and dormant wallets.
export function walletFlags({ positions, lastTs, nowSec = Math.floor(Date.now() / 1000) }) {
  const closed = positions.filter((p) => p.status === 'closed');
  const buys = positions.reduce((s, p) => s + (p.buys?.length ?? 0), 0);
  const sells = positions.reduce((s, p) => s + (p.sells?.length ?? 0), 0);
  const wins = closed.filter((p) => p.realizedUsd > 0).length;
  const flags = [];
  const mh = median(closed.map((p) => p.holdSec));
  if (mh != null && mh < 300 && closed.length >= 5) flags.push('SNIPER_SPEED');
  if (sells >= 20 && sells > buys * 4) flags.push('DISTRIBUTOR');
  if (closed.length >= 20 && wins / closed.length > 0.9) flags.push('HIGH_WINRATE_SUS');
  if (closed.length < 5) flags.push('LOW_ACTIVITY');
  if (lastTs != null && nowSec - lastTs > 14 * 86400) flags.push('DORMANT');
  return flags;
}

export const FLAG_WORDS = {
  SNIPER_SPEED: 'Usually sells within 5 minutes: faster than a copy can follow',
  DISTRIBUTOR: 'Sells far more often than it buys: looks like it is unloading coins it got elsewhere',
  HIGH_WINRATE_SUS: 'Wins over 90% of 20+ trades: often farmed or faked',
  LOW_ACTIVITY: 'Fewer than 5 finished trades to judge',
  DORMANT: 'Has not traded in 14+ days',
};
