// Wallet behaviour profile built from its round trips plus GMGN's own 30-day stats.
import { classifyEntry } from './trades.js';
import { duration, plural, roundNice } from '../text/plain.js';
import { usd, pct } from '../money/usd.js';

export const DEFAULT_PREFS = {
  minCoinsPerDay: 1,
  maxCoinsPerDay: 3,
  maxHoldSec: 2 * 3600,
  minShareUnderMaxHold: 0.6,
  minClosed: 5,
};

const median = (xs) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const quantile = (xs, q) => {
  const a = xs.filter((x) => x != null && Number.isFinite(x)).sort((p, r) => p - r);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};
const day = (ts) => Math.floor(ts / 86400);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function gmgnStats(stats) {
  if (!stats) return null;
  const s = Array.isArray(stats) ? stats[0] : stats;
  return {
    realizedUsd: num(s.realized_profit),
    totalCostUsd: num(s.total_cost),
    buys: num(s.buy ?? s.buy_count),
    sells: num(s.sell ?? s.sell_count),
    winRate: num(s.pnl_stat?.winrate ?? s.winrate),
    coins: num(s.pnl_stat?.token_num),
    avgHoldSec: num(s.pnl_stat?.avg_holding_period),
    feesUsd: (num(s.bought_fee) ?? 0) + (num(s.sold_fee) ?? 0),
    solBalance: num(s.native_balance),
    // GMGN's own return buckets over the period: how many coins ended above 5x, 2-5x, ...
    returnBuckets: s.pnl_stat
      ? { over5x: num(s.pnl_stat.pnl_gt_5x_num), from2to5x: num(s.pnl_stat.pnl_2x_5x_num), upTo2x: num(s.pnl_stat.pnl_0x_2x_num), loss: (num(s.pnl_stat.pnl_nd5_0x_num) ?? 0) + (num(s.pnl_stat.pnl_lt_nd5_num) ?? 0) }
      : null,
    identity: s.common
      ? {
          name: s.common.name || '',
          twitter: s.common.twitter_username || '',
          tags: s.common.tags || [],
          followers: num(s.common.follow_count),
          createdAt: num(s.common.created_at),
        }
      : null,
  };
}

export function computeProfile({ wallet, positions, orphanSells = 0, metaByToken = () => null, stats30 = null }) {
  for (const p of positions) p.entryStage = classifyEntry(p, metaByToken(p.token));
  const closed = positions.filter((p) => p.status === 'closed');
  const allTs = positions.flatMap((p) => [p.openTs, ...p.sells.map((s) => s.ts)]);
  const firstTs = allTs.length ? Math.min(...allTs) : null;
  const lastTs = allTs.length ? Math.max(...allTs) : null;
  const spanDays = firstTs != null ? Math.max(1, (lastTs - firstTs) / 86400) : null;
  const perDay = new Map();
  for (const p of positions) perDay.set(day(p.openTs), (perDay.get(day(p.openTs)) ?? 0) + 1);
  const activeDays = perDay.size;
  const holds = closed.map((p) => p.holdSec);
  const maxHold = DEFAULT_PREFS.maxHoldSec;
  const wins = closed.filter((p) => p.realizedUsd > 0).length;
  const realizedUsd = closed.reduce((a, p) => a + p.realizedUsd, 0);
  const positiveSum = closed.filter((p) => p.realizedUsd > 0).reduce((a, p) => a + p.realizedUsd, 0);
  const best = closed.reduce((a, p) => Math.max(a, p.realizedUsd), 0);
  const stages = ['graduated', 'early', 'snipe', 'unknown'];
  const stageMix = {};
  const byStage = {};
  for (const s of stages) {
    const ps = positions.filter((p) => p.entryStage === s);
    const cs = ps.filter((p) => p.status === 'closed');
    stageMix[s] = positions.length ? ps.length / positions.length : 0;
    byStage[s] = {
      n: ps.length,
      closed: cs.length,
      wins: cs.filter((p) => p.realizedUsd > 0).length,
      realizedUsd: cs.reduce((a, p) => a + p.realizedUsd, 0),
    };
  }
  const trades = positions.reduce((a, p) => a + p.buys.length + p.sells.length, 0);
  const copyWindow = median(positions.map((p) => p.copyWindowSec));
  const g = gmgnStats(stats30);
  const flags = [];
  if (copyWindow != null && copyWindow < 30 && closed.length >= 5) flags.push('bot-speed');
  if (g?.identity?.tags?.includes('wash_trader')) flags.push('wash-trader');
  if (positiveSum > 0 && best / positiveSum > 0.5 && closed.length >= 3) flags.push('one-lucky-trade');
  return {
    wallet,
    positions,
    orphanSells,
    openCount: positions.length - closed.length,
    closedCount: closed.length,
    firstTs, lastTs, spanDays,
    activeDays,
    coinsPerActiveDay: activeDays ? positions.length / activeDays : null,
    coinsPerActiveDayMedian: median([...perDay.values()]),
    tradesPerDay: spanDays ? trades / spanDays : null,
    medianHoldSec: median(holds),
    shareHeldUnder2h: closed.length ? closed.filter((p) => p.holdSec <= maxHold).length / closed.length : null,
    medianCopyWindowSec: copyWindow,
    winRate: closed.length ? wins / closed.length : null,
    wins,
    realizedUsd,
    feesUsd: positions.reduce((a, p) => a + p.feesUsd, 0),
    medianBuyUsd: median(positions.map((p) => p.buys[0]?.usd)),
    p25BuyUsd: quantile(positions.map((p) => p.buys[0]?.usd), 0.25),
    entryMcap: {
      p10: quantile(positions.map((p) => p.entryMcapUsd), 0.1),
      p50: median(positions.map((p) => p.entryMcapUsd)),
      p90: quantile(positions.map((p) => p.entryMcapUsd), 0.9),
    },
    entryAgeSec: (() => {
      const ages = positions.map((p) => {
        const m = metaByToken(p.token);
        return m?.creationTs != null ? p.openTs - m.creationTs : null;
      });
      return { p10: quantile(ages, 0.1), p50: median(ages), p90: quantile(ages, 0.9) };
    })(),
    stageMix,
    byStage,
    sellPattern: {
      oneShot: closed.length ? closed.filter((p) => p.sellPattern === 'one-shot').length / closed.length : null,
      scaled: closed.length ? closed.filter((p) => p.sellPattern === 'scaled').length / closed.length : null,
    },
    addsPerPosition: positions.length ? positions.reduce((a, p) => a + p.buys.length - 1, 0) / positions.length : null,
    platforms: [...new Set(positions.map((p) => p.launchpad).filter(Boolean))],
    topTradeShare: positiveSum > 0 ? best / positiveSum : null,
    gmgn30: g,
    flags,
  };
}

export function preferenceFit(p, prefs = DEFAULT_PREFS) {
  const blocks = [];
  const good = [];
  const c = p.coinsPerActiveDay;
  if (c == null) blocks.push('No trades in the data GMGN returned');
  else if (c > prefs.maxCoinsPerDay + 0.5) blocks.push(`Buys about ${roundNice(c)} coins a day (you want ${prefs.minCoinsPerDay} to ${prefs.maxCoinsPerDay})`);
  else good.push(`Buys about ${roundNice(c)} coin${roundNice(c) === 1 ? '' : 's'} a day on days it trades`);
  if (p.shareHeldUnder2h != null) {
    if (p.shareHeldUnder2h < prefs.minShareUnderMaxHold) {
      blocks.push(`Holds longer than ${duration(prefs.maxHoldSec)} on ${pct(1 - p.shareHeldUnder2h, 0)} of its trades`);
    } else {
      good.push(`Usually sells within ${duration(p.medianHoldSec)}`);
    }
  }
  if (p.closedCount < prefs.minClosed) blocks.push(`Only ${plural(p.closedCount, 'finished trade')} to judge it by`);
  if (p.flags.includes('bot-speed')) blocks.push(`Sells about ${duration(p.medianCopyWindowSec)} after buying, faster than a copy can follow`);
  if (p.flags.includes('wash-trader')) blocks.push('GMGN tags this wallet as a wash trader (fake volume)');
  if (p.winRate != null) good.push(`Won ${p.wins} of ${p.closedCount} finished trades (${pct(p.winRate, 0)})`);
  if (Number.isFinite(p.realizedUsd)) good.push(`Made ${usd(p.realizedUsd)} on finished trades in this data`);
  return { fits: blocks.length === 0, reasons: blocks, good };
}
