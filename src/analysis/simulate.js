// Copy-trade simulator: replays a wallet's real trade sequence as if YOU copied it.
//   * You buy `delaySec` after the wallet's first buy and sell `delaySec` after each of
//     its sells, selling the same share of your bag it sold of its own (GMGN's
//     "automatic follow-up selling"). Adds are not copied (GMGN "position increase times" 0).
//   * Prices come from GMGN candles at your delayed time (1s on Pro, else 30s).
//     "typical" interpolates inside the candle; "rough" buys the candle high and sells
//     the candle low, bounded by the wallet's own fill.
//   * Every transaction pays GMGN's 1%, the venue fee, and one network fee.
//   * Your cash is tracked in time order, so trades you could not afford are skipped.
// The wallet's own historical result is reported separately from yours.
import { tradeCosts } from '../money/fees.js';

const RES = { '1s': 1, '30s': 30, '1m': 60 };

export function priceAt(candles, t, resSec) {
  if (!candles?.length) return null;
  for (const c of candles) {
    if (c.t <= t && t < c.t + resSec) {
      const f = (t - c.t) / resSec;
      return { typical: c.open + (c.close - c.open) * f, high: c.high, low: c.low, candleT: c.t };
    }
  }
  let last = null;
  for (const c of candles) if (c.t + resSec <= t && t - (c.t + resSec) <= 120) last = c;
  return last ? { typical: last.close, high: last.close, low: last.close, candleT: last.t, stale: true } : null;
}

function venueOf(p) {
  const b = p.buys?.[0];
  const measured = b && b.dexFeeUsd > 0 && b.usd > 0 ? (b.dexFeeUsd / b.usd) * 100 : null;
  if (measured != null) return { venue: 'measured', poolFeePct: measured };
  return p.entryStage === 'graduated' ? { venue: 'pool', poolFeePct: null } : { venue: 'curve', poolFeePct: null };
}

function newLedger(startCapitalUsd) {
  return {
    cash: startCapitalUsd, start: startCapitalUsd, holdings: new Map(), lastPrice: new Map(),
    taken: 0, skippedNoCash: 0, txCount: 0, wins: 0, losses: 0, feesIncomplete: false,
    fees: { gmgnUsd: 0, venueUsd: 0, networkUsd: 0 }, equity: [],
  };
}

function charge(L, c) {
  L.fees.gmgnUsd += c.gmgnUsd;
  if (c.venueUsd == null || c.networkUsd == null) L.feesIncomplete = true;
  L.fees.venueUsd += c.venueUsd ?? 0;
  L.fees.networkUsd += c.networkUsd ?? 0;
  L.txCount += 1;
  return (c.gmgnUsd ?? 0) + (c.venueUsd ?? 0) + (c.networkUsd ?? 0);
}

function summary(L) {
  let openValueUsd = 0;
  for (const [key, h] of L.holdings) openValueUsd += h.tokens * (L.lastPrice.get(key) ?? 0);
  const end = L.cash + openValueUsd;
  return {
    taken: L.taken, skippedNoCash: L.skippedNoCash, txCount: L.txCount, wins: L.wins, losses: L.losses,
    fees: L.fees, feesUsd: L.fees.gmgnUsd + L.fees.venueUsd + L.fees.networkUsd, feesIncomplete: L.feesIncomplete,
    cashUsd: L.cash, openValueUsd, openPositions: L.holdings.size, endCapitalUsd: end, netUsd: end - L.start, equity: L.equity,
  };
}

export async function simulateCopy({
  positions, sizeUsd, startCapitalUsd, delaySec = 5, impactPct = 0.5, fees, candlesFor,
}) {
  const impact = impactPct / 100;
  const events = [];
  positions.forEach((p, i) => {
    events.push({ kind: 'buy', ts: p.openTs, i, p });
    for (const s of p.sells) events.push({ kind: 'sell', ts: s.ts, i, p, s });
  });
  events.sort((a, b) => a.ts - b.ts || (a.kind === 'buy' ? -1 : 1));
  const T = newLedger(startCapitalUsd);
  const R = newLedger(startCapitalUsd);
  const rows = positions.map((p) => ({
    token: p.token, symbol: p.symbol, stage: p.entryStage, openTs: p.openTs, walletStatus: p.status,
    walletRealizedUsd: p.realizedUsd, walletReturn: p.returnRatio,
    myEntryPrice: null, myExitPrice: null, myNetUsd: null, roughNetUsd: null, note: '',
  }));
  const dead = new Set();
  let resolution = null;
  let unavailable = 0;
  const look = async (p, t) => {
    const k = await candlesFor(p.token, t - 60, t + 60);
    resolution = k.resolution;
    return priceAt(k.candles, t, RES[k.resolution] ?? 30);
  };

  for (const e of events) {
    const row = rows[e.i];
    if (dead.has(e.i)) continue;
    const at = e.ts + delaySec;
    if (e.kind === 'buy') {
      const px = await look(e.p, at);
      if (!px) {
        dead.add(e.i);
        unavailable += 1;
        row.note = 'no price data from GMGN at your copy time';
        continue;
      }
      const walletPx = e.p.buys[0]?.priceUsd ?? e.p.entryPriceUsd;
      const v = venueOf(e.p);
      const legs = [
        [T, px.typical * (1 + impact)],
        [R, Math.max(px.high, walletPx ?? 0) * (1 + impact)],
      ];
      let bought = false;
      for (const [L, price] of legs) {
        const c = tradeCosts(fees, { usd: sizeUsd, ...v });
        const need = sizeUsd + (c.gmgnUsd ?? 0) + (c.venueUsd ?? 0) + (c.networkUsd ?? 0);
        if (L.cash < need) {
          L.skippedNoCash += 1;
          continue;
        }
        L.cash -= sizeUsd + charge(L, c);
        L.taken += 1;
        L.holdings.set(e.i, { tokens: sizeUsd / price, costUsd: need, proceedsUsd: 0 });
        L.lastPrice.set(e.i, price);
        L.equity.push({ t: at, equity: L.cash });
        if (L === T) {
          row.myEntryPrice = price;
          bought = true;
        }
      }
      if (!bought) row.note = row.note || 'skipped: not enough cash at that moment';
      continue;
    }
    // sell
    const px = await look(e.p, at);
    const walletSell = e.s.priceUsd;
    const v = venueOf(e.p);
    for (const [L, pick] of [[T, (q) => q.typical], [R, (q) => Math.min(q.low, walletSell ?? Infinity)]]) {
      const h = L.holdings.get(e.i);
      if (!h) continue;
      let price = px ? pick(px) : walletSell;
      if (!px && L === T) row.note = "exit priced at the wallet's own sell price (no candle at your copy time)";
      price *= 1 - impact;
      const qty = e.s.fractionOfHolding >= 1 ? h.tokens : h.tokens * e.s.fractionOfHolding;
      const proceeds = qty * price;
      const c = tradeCosts(fees, { usd: proceeds, ...v });
      const cost = charge(L, c);
      L.cash += proceeds - cost;
      h.tokens -= qty;
      h.costUsd += cost;
      h.proceedsUsd += proceeds;
      L.lastPrice.set(e.i, price);
      if (L === T) row.myExitPrice = price;
      if (h.tokens <= 1e-12) {
        const net = h.proceedsUsd - h.costUsd;
        if (net > 0) L.wins += 1;
        else L.losses += 1;
        if (L === T) row.myNetUsd = net;
        else row.roughNetUsd = net;
        L.holdings.delete(e.i);
      }
      L.equity.push({ t: at, equity: L.cash });
    }
  }
  for (const [i] of T.holdings) rows[i].note = rows[i].note || 'still open: valued at the last price seen';
  const walletRealizedUsd = positions.reduce((a, p) => a + (p.realizedUsd ?? 0), 0);
  return {
    assumptions: { sizeUsd, startCapitalUsd, delaySec, impactPct, resolution, networkSolPerTx: fees.networkSolPerTx, rate: fees.rate },
    wallet: { realizedUsd: walletRealizedUsd, trades: positions.length },
    typical: summary(T),
    rough: summary(R),
    unavailable,
    rows,
  };
}
