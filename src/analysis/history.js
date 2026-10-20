// Historical study of real explosive moves (7x, 10x, 19x+ within hours).
//   1. findExplosiveMove: the biggest low-to-high run in a coin's candles, with the moment the
//      run became visible (first candle at 2x the base) and its peak.
//   2. signalTimeline: every signal we could have seen (smart-money, explosive-list and KOL
//      wallets buying, a volume surge, graduation), each marked BEFORE the breakout, DURING it
//      (at least 2x left) or TOO LATE (under 2x left), plus what a follower entering a few
//      seconds after the signal and selling on a 30% drop from the high would have made.
//   3. studySummary: per signal type, how often it came early and what following it returned.
// Prices are candle prices, so a follower's fill is approximate; real fills pay fees and slippage.

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const median = (xs) => {
  const a = xs.filter(isNum).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export function candleAt(candles, ts, resSec) {
  let last = null;
  for (const c of candles) {
    if (c.t <= ts && ts < c.t + resSec) return c;
    if (c.t <= ts) last = c;
  }
  return last;
}

// Candle bodies (open/close), not wicks: on thin launch curves a single dust trade can print a
// wick thousands of times away from where anyone could really buy or sell.
export const bodyLow = (c) => Math.min(c.open, c.close);
export const bodyHigh = (c) => Math.max(c.open, c.close);

// minGapCandles: the base must be at least two candles before the peak. A run inside one or two
// candles is a launch spike only snipers catch; there is no signal anyone could have followed.
// minBasePrice: bases below the lowest possible launch price are bad ticks, not real prices.
export function findExplosiveMove(candles, resSec, { minMultiple = 7, maxDurationSec = 24 * 3600, minBasePrice = 0, minGapCandles = 2 } = {}) {
  let best = null;
  for (let j = minGapCandles; j < candles.length; j++) {
    const peak = candles[j];
    const top = bodyHigh(peak);
    if (!isNum(top)) continue;
    let base = null;
    for (let i = 0; i <= j - minGapCandles; i++) {
      const c = candles[i];
      const v = bodyLow(c);
      if (peak.t - c.t > maxDurationSec || !isNum(v) || v <= 0 || v < minBasePrice) continue;
      if (!base || v <= bodyLow(base)) base = c; // the last low before the run, not the first
    }
    if (!base) continue;
    const multiple = top / bodyLow(base);
    if (!best || multiple > best.multiple) best = { base, peak, multiple };
  }
  if (!best || best.multiple < minMultiple) return null;
  const basePrice = bodyLow(best.base);
  const breakout = candles.find((c) => c.t > best.base.t && c.t <= best.peak.t && bodyHigh(c) >= basePrice * 2);
  return {
    baseTs: best.base.t,
    basePrice,
    peakTs: best.peak.t,
    peakPrice: bodyHigh(best.peak),
    multiple: best.multiple,
    durationSec: best.peak.t - best.base.t,
    breakoutTs: breakout?.t ?? best.peak.t,
    resSec,
  };
}

// Enter at the candle covering entryTs; sell on the first close `trailPct` under the highest
// high seen since entry. If that never happens, the trade is marked open at the last candle.
export function followTrailing(candles, resSec, { entryTs, trailPct = 0.3 }) {
  const entry = candleAt(candles, entryTs, resSec);
  if (!entry || !isNum(entry.close) || entry.close <= 0) return null;
  let high = entry.close;
  for (const c of candles) {
    if (c.t <= entry.t) continue;
    high = Math.max(high, bodyHigh(c));
    if (c.close <= high * (1 - trailPct)) {
      return { entryTs, entryPrice: entry.close, exitTs: c.t, exitPrice: c.close, multiple: c.close / entry.close, highAfterEntry: high / entry.close, open: false };
    }
  }
  const last = candles[candles.length - 1];
  return { entryTs, entryPrice: entry.close, exitTs: last.t, exitPrice: last.close, multiple: last.close / entry.close, highAfterEntry: high / entry.close, open: true };
}

const LABELS = {
  explosive: 'A wallet from your explosive list bought',
  smart: 'A GMGN smart-money wallet bought',
  kol: 'A KOL (influencer) wallet bought',
  volume: 'Trading volume jumped to 3x its recent pace',
  graduated: 'The coin graduated off the launch curve',
};

export function signalTimeline({ move, candles, resSec, buyers = [], explosive = new Set(), graduatedTs = null, delaySec = 30, trailPct = 0.3 }) {
  const raw = [];
  for (const b of buyers) {
    if (!isNum(b.firstBuyTs) || b.firstBuyTs > move.peakTs) continue;
    const tags = b.tags ?? [];
    const type = explosive.has(b.wallet) ? 'explosive' : tags.includes('smart_degen') ? 'smart' : tags.some((t) => t === 'kol' || t === 'renowned') ? 'kol' : null;
    if (type) raw.push({ key: `${type}:${b.wallet}`, type, wallet: b.wallet, ts: b.firstBuyTs });
  }
  for (let i = 3; i < candles.length; i++) {
    const c = candles[i];
    if (c.t > move.peakTs) break;
    const prior = median(candles.slice(Math.max(0, i - 6), i).map((x) => x.volumeUsd));
    if (prior > 0 && c.volumeUsd >= prior * 3) {
      raw.push({ key: 'volume', type: 'volume', ts: c.t });
      break;
    }
  }
  if (isNum(graduatedTs) && graduatedTs <= move.peakTs) raw.push({ key: 'graduated', type: 'graduated', ts: graduatedTs });

  const signals = raw
    .map((s) => {
      const at = candleAt(candles, s.ts + delaySec, resSec);
      const priceAtSignal = at?.close ?? null;
      const upsideLeft = priceAtSignal > 0 ? move.peakPrice / priceAtSignal : null;
      const timing = s.ts < move.breakoutTs ? 'before' : upsideLeft != null && upsideLeft >= 2 ? 'during' : 'too late';
      return {
        ...s,
        label: LABELS[s.type],
        timing,
        priceAtSignal,
        upsideLeft,
        secondsBeforeBreakout: move.breakoutTs - s.ts,
        follower: followTrailing(candles, resSec, { entryTs: s.ts + delaySec, trailPct }),
      };
    })
    .sort((a, b) => a.ts - b.ts);
  return { move, signals, firstUsefulSignal: signals.find((s) => s.timing !== 'too late') ?? null };
}

export function studySummary(examples) {
  const by = new Map();
  for (const ex of examples) {
    for (const s of ex.signals ?? []) {
      const row = by.get(s.type) ?? { type: s.type, label: LABELS[s.type] ?? s.type, seen: 0, early: 0, during: 0, late: 0, multiples: [], earlyMultiples: [] };
      row.seen += 1;
      if (s.timing === 'before') row.early += 1;
      else if (s.timing === 'during') row.during += 1;
      else row.late += 1;
      if (isNum(s.follower?.multiple)) {
        row.multiples.push(s.follower.multiple);
        if (s.timing === 'before') row.earlyMultiples.push(s.follower.multiple);
      }
      by.set(s.type, row);
    }
  }
  return [...by.values()].map(({ multiples, earlyMultiples, ...r }) => ({
    ...r,
    medianFollowerMultiple: median(multiples),
    medianEarlyFollowerMultiple: median(earlyMultiples),
    followedProfitably: multiples.filter((m) => m > 1).length,
  })).sort((a, b) => b.early - a.early);
}
