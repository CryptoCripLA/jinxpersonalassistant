// Three separate leaderboards (graduated / early momentum / sniping), each ordered by
// what YOU would have kept per week at your trade size after GMGN's fee, the venue fee
// the wallet actually paid, and one network fee per transaction you would send.
// This quick pass uses the wallet's own prices; the full simulator adds copy delay.
import { preferenceFit, DEFAULT_PREFS } from './profile.js';
import { solToUsd, usd, usdSigned, pct } from '../money/usd.js';
import { STAGE_SHORT, plural } from '../text/plain.js';

export const CATEGORIES = ['graduated', 'early', 'snipe'];

function venuePct(pos, fees) {
  const b = pos.buys?.[0];
  if (b && Number.isFinite(b.dexFeeUsd) && b.usd > 0) return (b.dexFeeUsd / b.usd) * 100;
  if (pos.entryStage === 'graduated') return fees.fallbackPoolFeePct;
  return fees.curveFeePct;
}

export function quickKeepEstimate(positions, { sizeUsd, fees }) {
  const networkUsd = solToUsd(fees.networkSolPerTx, fees.rate);
  let grossUsd = 0;
  let feesUsd = 0;
  let txCount = 0;
  let n = 0;
  let unknownFees = false;
  for (const p of positions) {
    if (p.status !== 'closed' || p.returnRatio == null) continue;
    n += 1;
    const out = sizeUsd * (1 + p.returnRatio);
    grossUsd += out - sizeUsd;
    const v = venuePct(p, fees);
    if (v == null) unknownFees = true;
    const tx = 1 + Math.max(1, p.sells.length);
    txCount += tx;
    feesUsd += ((sizeUsd + out) * fees.gmgnFeePct) / 100 + ((sizeUsd + out) * (v ?? 0)) / 100;
    if (networkUsd == null) unknownFees = true;
    else feesUsd += tx * networkUsd;
  }
  return {
    n, grossUsd, txCount,
    feesUsd: unknownFees ? null : feesUsd,
    keepUsd: unknownFees ? null : grossUsd - feesUsd,
  };
}

export function rankWallets(profiles, { sizeUsd, fees, prefs = DEFAULT_PREFS, minTrades = 5 }) {
  const boards = {};
  for (const stage of CATEGORIES) {
    const rows = [];
    for (const p of profiles) {
      const closed = p.positions.filter((x) => x.entryStage === stage && x.status === 'closed');
      if (closed.length < minTrades) continue;
      const est = quickKeepEstimate(closed, { sizeUsd, fees });
      const fit = preferenceFit(p, prefs);
      const wins = closed.filter((x) => x.realizedUsd > 0).length;
      const realized = closed.reduce((a, x) => a + x.realizedUsd, 0);
      const keepPerWeekUsd = est.keepUsd == null || !p.spanDays ? null : (est.keepUsd / p.spanDays) * 7;
      const reasons = [
        `Made ${usd(realized)} on ${plural(closed.length, `finished ${STAGE_SHORT[stage]} trade`)} (won ${wins} of ${closed.length}).`,
        keepPerWeekUsd == null
          ? 'What you would keep is unavailable because a fee input is missing.'
          : `Copying with ${usd(sizeUsd)} a trade would have kept about ${usdSigned(keepPerWeekUsd)} a week after fees (before copy delay).`,
        ...fit.good.slice(0, 2).map((g) => `${g}.`),
        ...fit.reasons.map((b) => `Watch out: ${b}.`),
      ];
      if (p.flags.includes('one-lucky-trade')) reasons.push(`Watch out: one trade made ${pct(p.topTradeShare, 0)} of its winnings.`);
      rows.push({
        wallet: p.wallet,
        stage,
        stageShare: p.stageMix[stage],
        trades: closed.length,
        wins,
        realizedUsd: realized,
        keepUsd: est.keepUsd,
        keepPerWeekUsd,
        feesUsd: est.feesUsd,
        txCount: est.txCount,
        fits: fit.fits,
        reasons,
        identity: p.gmgn30?.identity ?? null,
      });
    }
    rows.sort((a, b) => Number(b.fits) - Number(a.fits) || (b.keepPerWeekUsd ?? -Infinity) - (a.keepPerWeekUsd ?? -Infinity));
    boards[stage] = rows;
  }
  return boards;
}
