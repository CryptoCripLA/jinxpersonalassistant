// "What happens if I put $25 into this?" Dollars in and out at each multiple, after GMGN's
// 1%, the launch-curve or pool fee and one network fee on the buy and on the sell.
// A SIMULATED projection from today's market cap, never a prediction.
import { tradeCosts } from '../money/fees.js';
import { usd, usdSigned, usdWhole, usdShort } from '../money/usd.js';

export const SCENARIO_MULTIPLES = [0, 0.5, 1, 2, 3, 5, 7, 10, 19, 50];

const costOf = (c) => (c.gmgnUsd ?? 0) + (c.venueUsd ?? 0) + (c.networkUsd ?? 0);

export function scenario({ sizeUsd, marketCapUsd, fees, venue = 'curve', poolFeePct = null, multiples = SCENARIO_MULTIPLES }) {
  const buy = tradeCosts(fees, { usd: sizeUsd, venue, poolFeePct });
  const inCoins = sizeUsd - costOf(buy);
  const proceedsAt = (m) => {
    const value = inCoins * m;
    if (value <= 0) return 0;
    return Math.max(0, value - costOf(tradeCosts(fees, { usd: value, venue, poolFeePct })));
  };
  const rows = multiples.map((m) => {
    const proceeds = proceedsAt(m);
    const net = proceeds - sizeUsd;
    return {
      multiple: m,
      targetMarketCapUsd: marketCapUsd != null ? marketCapUsd * m : null,
      sellValueUsd: inCoins * m,
      proceedsUsd: proceeds,
      netUsd: net,
      text: m === 0
        ? `If it goes to zero, the ${usdWhole(sizeUsd)} is gone.`
        : `At ${m}x${marketCapUsd != null ? ` (market cap ${usdShort(marketCapUsd * m)})` : ''}, ${usdWhole(sizeUsd)} becomes about ${usd(proceeds)} after fees (${usdSigned(net)}).`,
    };
  });
  // fees are linear in value, so break-even solves value * (1 - pct) - network = size
  const sell = tradeCosts(fees, { usd: 100, venue, poolFeePct });
  const pctOut = ((sell.gmgnUsd ?? 0) + (sell.venueUsd ?? 0)) / 100;
  const breakevenMultiple = inCoins > 0 ? (sizeUsd + (sell.networkUsd ?? 0)) / (1 - pctOut) / inCoins : null;
  return {
    label: 'SIMULATED',
    sizeUsd,
    marketCapUsd,
    buyFeesUsd: costOf(buy),
    feesIncomplete: buy.totalUsd == null,
    breakevenMultiple,
    rows,
  };
}
