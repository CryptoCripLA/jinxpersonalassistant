// The daily mission: turn "I want $X today" into what each trade has to do with the owner's real
// money, and replay each wallet day by day at his pace to count the days it would have got there.
import { tradeCosts } from '../money/fees.js';
import { usd, usdWhole } from '../money/usd.js';
import { roundNice } from '../text/plain.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const costOf = (c) => (c.gmgnUsd ?? 0) + (c.venueUsd ?? 0) + (c.networkUsd ?? 0);

export function dailyPlan({ targetUsd, sizeUsd, capitalUsd, tradesPerDay = 3, fees, venue = 'pool', poolFeePct = null, feeFloatUsd = 1 }) {
  const buy = tradeCosts(fees, { usd: sizeUsd, venue, poolFeePct });
  const inCoins = sizeUsd - costOf(buy);
  const sell = tradeCosts(fees, { usd: 100, venue, poolFeePct });
  const pctOut = ((sell.gmgnUsd ?? 0) + (sell.venueUsd ?? 0)) / 100;
  const net = sell.networkUsd ?? 0;
  // multiple m whose sale, after fees, returns size + gain
  const multipleFor = (gain) => (inCoins > 0 ? (sizeUsd + gain + net) / (1 - pctOut) / inCoins : null);
  const slots = isNum(capitalUsd) ? Math.max(0, Math.floor(capitalUsd / (sizeUsd + feeFloatUsd))) : null;
  const perTradeUsd = targetUsd / tradesPerDay;
  const multipleEach = multipleFor(perTradeUsd);
  const singleMultiple = multipleFor(targetUsd);
  const money = slots == null
    ? 'Your balance is unavailable right now.'
    : slots === 0
      ? `You have ${usd(capitalUsd)}: not enough for one ${usd(sizeUsd)} trade plus fees.`
      : `You have ${usd(capitalUsd)}, enough for ${slots} position${slots === 1 ? '' : 's'} at a time.`;
  return {
    targetUsd, sizeUsd, capitalUsd, tradesPerDay, slots, perTradeUsd, multipleEach, singleMultiple,
    text: `To make ${usdWhole(targetUsd)} today with ${usdWhole(sizeUsd)} trades: ${tradesPerDay} trades at about ${roundNice(multipleEach)}x each, or one trade at about ${roundNice(singleMultiple)}x. ${money}`,
  };
}

// Group a wallet's copied trades by your local day, keep only the first maxCoinsPerDay of each day
// (the ones you would have taken), and count the days that reached the target.
export function walletDays(outcomes, { targetUsd, maxCoinsPerDay = 3, tzOffsetSec = 0 } = {}) {
  const by = new Map();
  for (const o of [...outcomes].filter((x) => isNum(x.followerNetUsd)).sort((a, b) => a.entryTs - b.entryTs)) {
    const d = Math.floor((o.entryTs + tzOffsetSec) / 86400);
    const list = by.get(d) ?? [];
    if (list.length < maxCoinsPerDay) list.push(o);
    by.set(d, list);
  }
  const days = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([d, list]) => ({ day: d, trades: list.length, netUsd: list.reduce((s, o) => s + o.followerNetUsd, 0) }));
  const nets = days.map((x) => x.netUsd).sort((a, b) => a - b);
  const m = Math.floor(nets.length / 2);
  return {
    activeDays: days.length,
    hitDays: isNum(targetUsd) ? days.filter((x) => x.netUsd >= targetUsd).length : null,
    medianDayUsd: nets.length ? (nets.length % 2 ? nets[m] : (nets[m - 1] + nets[m]) / 2) : null,
    bestDayUsd: nets.length ? nets[nets.length - 1] : null,
    worstDayUsd: nets.length ? nets[0] : null,
    days,
  };
}
