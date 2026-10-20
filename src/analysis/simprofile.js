// Runs the copy simulator on a stored wallet profile over its most recent days.
import { simulateCopy } from './simulate.js';

// Window is the last `days` up to now, and the wallet's buys under its own 25th-percentile
// size are skipped, exactly as the recommended "Minimum copy amount" would skip them.
export async function simulateProfile(g, profile, { sizeUsd, capitalUsd, delaySec = 5, impactPct = 0.5, fees, days = 14, nowSec = Math.floor(Date.now() / 1000), minBuyUsd = profile.p25BuyUsd ?? 0 }) {
  const last = nowSec;
  const from = last - days * 86400;
  const positions = profile.positions
    .filter((p) => p.openTs >= from && (p.buys?.[0]?.usd ?? 0) >= minBuyUsd)
    .sort((a, b) => a.openTs - b.openTs);
  const first = positions.length ? positions[0].openTs : last;
  const r = await simulateCopy({
    positions, sizeUsd, startCapitalUsd: capitalUsd, delaySec, impactPct, fees,
    candlesFor: (token, a, b) => g.candles(token, Math.floor(a), Math.ceil(b)),
  });
  r.periodDays = days;
  r.skippedSmallBuys = profile.positions.filter((p) => p.openTs >= from && (p.buys?.[0]?.usd ?? 0) < minBuyUsd).length;
  r.periodFromTs = first;
  r.periodToTs = last;
  return r;
}

// Median venue fee GMGN recorded on real graduated-coin buys across all profiles.
export function measuredPoolFeePct(profiles) {
  const xs = [];
  for (const p of profiles) for (const x of p.positions ?? []) {
    const b = x.buys?.[0];
    if (x.entryStage === 'graduated' && b?.dexFeeUsd > 0 && b.usd > 0) xs.push((b.dexFeeUsd / b.usd) * 100);
  }
  if (xs.length < 20) return null;
  xs.sort((a, b) => a - b);
  return { pct: xs[Math.floor(xs.length / 2)], samples: xs.length };
}
