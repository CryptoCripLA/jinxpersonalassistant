// Trading cost model, from GMGN's own published fee page
// (https://docs.gmgn.ai/index/gmgn-fees-settings, read 2026-10-20):
//   * GMGN handling fee: 1% of every transaction (buy and sell).
//   * Launchpad fee: Pump.fun charges 1% per trade while a coin is on its bonding curve.
//   * On-chain fee per transaction = priority fee + tip fee + gas, paid in SOL.
//     GMGN suggests 0.002-0.005 SOL total when speed doesn't matter and 0.006 SOL or more
//     for automatic buy/sell orders.
// After graduation the venue fee is the pool's own fee ratio, which GMGN reports as
// token info `pool.fee_ratio` in percent units (0.25 means 0.25%).

import { solToUsd, round9, isNum } from './usd.js';

export const GMGN_FEE_PCT = 1;
export const PUMP_CURVE_FEE_PCT = 1;
export const GMGN_SUGGESTED_SOL = { calm: [0.002, 0.005], auto: 0.006 };

export function feeModel({
  rate,
  networkSolPerTx = 0.003,
  gmgnFeePct = GMGN_FEE_PCT,
  curveFeePct = PUMP_CURVE_FEE_PCT,
  fallbackPoolFeePct = null,
} = {}) {
  return { rate, networkSolPerTx, gmgnFeePct, curveFeePct, fallbackPoolFeePct };
}

export function tradeCosts(model, { usd: amount, venue = 'curve', poolFeePct = null }) {
  const gmgnUsd = round9((amount * model.gmgnFeePct) / 100);
  let venuePct = null;
  let venueSource;
  if (venue === 'curve') {
    venuePct = model.curveFeePct;
    venueSource = 'Pump.fun bonding-curve fee (GMGN docs)';
  } else if (isNum(poolFeePct)) {
    venuePct = poolFeePct;
    venueSource = 'pool fee reported by GMGN';
  } else if (isNum(model.fallbackPoolFeePct)) {
    venuePct = model.fallbackPoolFeePct;
    venueSource = 'your assumed pool fee (GMGN did not report one)';
  } else {
    venueSource = 'pool fee unavailable';
  }
  const venueUsd = venuePct == null ? null : round9((amount * venuePct) / 100);
  const networkUsd = solToUsd(model.networkSolPerTx, model.rate);
  const parts = [gmgnUsd, venueUsd, networkUsd];
  const totalUsd = parts.every(isNum) ? round9(parts.reduce((a, b) => a + b, 0)) : null;
  return { gmgnUsd, venueUsd, venueSource, networkUsd, totalUsd };
}

export function roundTripCosts(model, { usd: amount, venue = 'curve', poolFeePct = null }) {
  const buy = tradeCosts(model, { usd: amount, venue, poolFeePct });
  const sell = tradeCosts(model, { usd: amount, venue, poolFeePct });
  const totalUsd = isNum(buy.totalUsd) && isNum(sell.totalUsd) ? round9(buy.totalUsd + sell.totalUsd) : null;
  return { buy, sell, totalUsd, shareOfTrade: totalUsd == null ? null : totalUsd / amount };
}
