// "Who bought before everyone else, and what have they done since?"
// Exact version: pump.fun's full trade list (every buy in order).
// Fallback: GMGN's top traders, ordered by when each wallet first held the coin.
import { plural } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function earlyBuyersFromTrades(trades, { totalSupply = 1e9, priceNowUsd = null, creationTs = null } = {}) {
  const by = new Map();
  for (const t of [...trades].sort((a, b) => a.ts - b.ts)) {
    let w = by.get(t.wallet);
    if (!w) {
      if (t.side !== 'buy') continue; // sold before we saw a buy: not an early buyer
      w = { wallet: t.wallet, firstBuyTs: t.ts, entryPriceUsd: t.priceUsd, boughtUsd: 0, boughtTokens: 0, soldUsd: 0, soldTokens: 0, buys: 0, sells: 0, lastSellTs: null };
      by.set(t.wallet, w);
    }
    if (t.side === 'buy') {
      w.boughtUsd += t.usd ?? 0;
      w.boughtTokens += t.tokens ?? 0;
      w.buys += 1;
    } else {
      w.soldUsd += t.usd ?? 0;
      w.soldTokens += t.tokens ?? 0;
      w.sells += 1;
      w.lastSellTs = t.ts;
    }
  }
  return [...by.values()].map((w, i) => {
    const held = Math.max(0, w.boughtTokens - w.soldTokens);
    const heldShare = w.boughtTokens > 0 ? held / w.boughtTokens : 0;
    const holdingValueUsd = priceNowUsd != null ? held * priceNowUsd : null;
    return {
      ...w,
      rank: i + 1,
      secondsAfterLaunch: creationTs != null ? w.firstBuyTs - creationTs : null,
      entryMcapUsd: w.entryPriceUsd != null ? w.entryPriceUsd * totalSupply : null,
      heldShare,
      stillHolding: heldShare > 0.01,
      holdingValueUsd,
      multipleNow: priceNowUsd != null && w.entryPriceUsd > 0 ? priceNowUsd / w.entryPriceUsd : null,
      capturedMultiple: w.soldTokens > 0 && w.boughtTokens > 0 ? (w.soldUsd / w.soldTokens) / (w.boughtUsd / w.boughtTokens) : null,
      profitUsd: holdingValueUsd != null ? w.soldUsd + holdingValueUsd - w.boughtUsd : w.soldUsd - w.boughtUsd,
      source: 'pump.fun trades',
    };
  });
}

export function earlyBuyersFromTopTraders(list, { totalSupply = 1e9, creationTs = null, priceNowUsd = null } = {}) {
  return (list ?? [])
    .filter((t) => t.addr_type == null || Number(t.addr_type) === 0)
    .filter((t) => num(t.start_holding_at) != null)
    .map((t) => {
      const avgCost = num(t.avg_cost);
      const avgSold = num(t.avg_sold);
      const amount = num(t.amount_cur) ?? 0;
      const soldShare = Math.min(1, Math.max(0, num(t.sell_amount_percentage) ?? 0));
      const value = num(t.usd_value) ?? (priceNowUsd != null ? amount * priceNowUsd : null);
      return {
        wallet: t.address,
        firstBuyTs: num(t.start_holding_at),
        secondsAfterLaunch: creationTs != null ? num(t.start_holding_at) - creationTs : null,
        entryPriceUsd: avgCost,
        entryMcapUsd: avgCost != null ? avgCost * totalSupply : null,
        boughtUsd: num(t.history_bought_cost),
        soldUsd: num(t.history_sold_income),
        heldShare: amount > 0 ? 1 - soldShare : 0,
        stillHolding: amount > 0,
        holdingValueUsd: value,
        multipleNow: priceNowUsd != null && avgCost > 0 ? priceNowUsd / avgCost : null,
        capturedMultiple: avgSold != null && avgCost > 0 ? avgSold / avgCost : null,
        profitUsd: (num(t.realized_profit) ?? 0) + (num(t.unrealized_profit) ?? 0),
        lastSellTs: soldShare > 0 ? num(t.end_holding_at) || num(t.last_active_timestamp) || null : null,
        tags: [...(t.tags ?? [])],
        makerTags: [...(t.maker_token_tags ?? [])],
        name: t.twitter_username || t.name || '',
        source: 'GMGN top traders',
      };
    })
    .sort((a, b) => a.firstBuyTs - b.firstBuyTs)
    .map((w, i) => ({ ...w, rank: i + 1 }));
}

export function summarizeEarly(buyers, { first = 20, now = Math.floor(Date.now() / 1000), explosive = new Set() } = {}) {
  const early = buyers.filter((b) => b.rank <= first);
  const profitable = early.filter((b) => b.profitUsd > 0);
  const profitableStillHolding = profitable.filter((b) => b.stillHolding);
  const recentSellers = early.filter((b) => b.lastSellTs != null && now - b.lastSellTs <= 900);
  const explosiveIn = early.filter((b) => explosive.has(b.wallet));
  const parts = [
    `Of the first ${plural(early.length, 'buyer')}, ${profitable.length} ${profitable.length === 1 ? 'is' : 'are'} in profit; ${profitableStillHolding.length} of the ${profitable.length} profitable early wallets still hold.`,
    recentSellers.length ? `${plural(recentSellers.length, 'early wallet')} sold in the last 15 minutes.` : 'None of them sold in the last 15 minutes.',
  ];
  if (explosiveIn.length) parts.push(`${plural(explosiveIn.length, 'wallet')} from your explosive list ${explosiveIn.length === 1 ? 'is' : 'are'} among them.`);
  return {
    first: early.length,
    profitable: profitable.length,
    profitableStillHolding: profitableStillHolding.length,
    recentSellers: recentSellers.length,
    explosiveIn: explosiveIn.length,
    text: parts.join(' '),
  };
}
