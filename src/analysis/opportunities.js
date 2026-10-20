// Coin opportunities, scored with GMGN's own published checklist
// (gmgn-market SKILL.md "Token Quality Filter Criteria" and "Token Lifecycle Stage").
// Every point is one checklist line; every reason names the number behind it.
// Rate fields (rug_ratio, top_10_holder_rate, ...) are fractions 0-1, compared as fractions.
import { roundTripCosts } from '../money/fees.js';
import { usd, pct } from '../money/usd.js';
import { duration, cleanLabel } from '../text/plain.js';

const n = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const CATEGORY_LABELS = {
  new: 'Brand-new coins',
  near: 'About to graduate',
  graduated: 'Just graduated',
  smart: 'Smart money buying now',
  trending: 'Trending this hour',
};

export function lifecycleStage(t, now) {
  const ageSec = n(t.created_timestamp ?? t.creation_timestamp) != null ? now - n(t.created_timestamp ?? t.creation_timestamp) : null;
  const smart = n(t.smart_degen_count) ?? 0;
  const kol = n(t.renowned_count) ?? 0;
  const s1h = n(t.swaps_1h);
  const s24 = n(t.swaps_24h);
  const ch1h = n(t.price_change_percent1h);
  const surging = s1h != null && s24 != null && s24 > 0 && s1h > (s24 / 24) * 2;
  const fading = s1h != null && s24 != null && s24 > 0 && s1h < (s24 / 24) * 0.5;
  if (ageSec != null && ageSec < 3600 && smart === 0 && kol === 0) {
    return { stage: 1, name: 'Early (new born)', when: 'Too early to judge. GMGN says to wait for smart money to show up before acting.' };
  }
  if (smart >= 3 && (surging || (ch1h != null && ch1h > 20))) {
    return { stage: 2, name: 'Breakout', when: 'GMGN calls this the strongest entry window. It is often short, so act on confirmation, not hope.' };
  }
  if ((smart === 0 && fading) || (fading && (n(t.holder_count) ?? 1) === 0)) {
    return { stage: 4, name: 'Decline', when: 'Activity is drying up. GMGN says avoid new entries here.' };
  }
  if (t.creator_token_status === 'creator_close' && kol > 0 && !surging) {
    return { stage: 3, name: 'Distribution', when: 'Late. Smart money may be selling to newcomers. Only small, quick trades if any.' };
  }
  return { stage: 2.5, name: 'Building', when: 'Not a clear breakout yet. Watch whether smart-money wallets keep joining.' };
}

export function scoreToken(t, { now, sizeUsd, fees, yourWalletsIn = [] }) {
  const reasons = [];
  const rug = n(t.rug_ratio);
  if (rug != null && rug > 0.3) return { disqualified: `High rug-pull risk (${pct(rug, 0)})`, score: 0, reasons };
  if (t.is_wash_trading === true || t.is_wash_trading === 'true') return { disqualified: 'Fake volume detected (wash trading)', score: 0, reasons };
  if (Number(t.is_honeypot) === 1 || t.is_honeypot === 'yes') return { disqualified: 'Cannot be sold (honeypot)', score: 0, reasons };

  let pts = 0;
  let max = 0;
  const grade = (passed, watch, text) => {
    max += 2;
    if (passed) pts += 2;
    else if (watch) pts += 1;
    reasons.push(text);
  };
  const smart = n(t.smart_degen_count) ?? 0;
  grade(smart >= 3, smart >= 1, smart >= 1 ? `${smart} smart-money wallets hold it.` : 'No smart-money wallets hold it yet.');
  if (rug != null) grade(rug < 0.1, rug <= 0.3, `Rug-pull risk score ${pct(rug, 0)} (GMGN: under 10% is good).`);
  const dev = t.creator_token_status;
  if (dev) grade(dev === 'creator_close', false, dev === 'creator_close' ? 'The creator already sold, so no dev dump is waiting.' : 'The creator still holds coins and could sell on you.');
  const top10 = n(t.top_10_holder_rate);
  if (top10 != null) grade(top10 < 0.2, top10 <= 0.5, `The 10 biggest holders own ${pct(top10, 0)} of it (GMGN: under 20% is healthy).`);
  const liq = n(t.liquidity);
  if (liq != null) grade(liq > 50_000, liq >= 10_000, `${usd(liq)} in the trading pool (GMGN: over $50,000 is good, under $10,000 is a skip).`);
  const social = Boolean(t.twitter || t.website || t.telegram || t.twitter_username || t.has_at_least_one_social);
  grade(social, false, social ? 'Has social links.' : 'No social links.');
  const kol = n(t.renowned_count) ?? 0;
  if (kol > 0) reasons.push(`${kol} KOL wallet${kol === 1 ? ' holds' : 's hold'} it (attention, not proof).`);
  if (yourWalletsIn.length) reasons.push(`${yourWalletsIn.length} of your wallets bought it.`);

  const score = max ? Math.round((pts / max) * 100) : 0;
  const life = lifecycleStage(t, now);
  // Graduated pools: GMGN's lists carry no pool fee, so the service passes the venue fee
  // measured on real graduated-coin trades as fees.fallbackPoolFeePct; absent that it is unavailable.
  const rt = roundTripCosts(fees, { usd: sizeUsd, venue: (n(t.progress) ?? 1) < 1 ? 'curve' : 'pool', poolFeePct: null });
  const age = n(t.created_timestamp ?? t.creation_timestamp);
  return {
    address: t.address,
    symbol: cleanLabel(t.symbol, 16),
    name: cleanLabel(t.name, 40),
    marketCapUsd: n(t.usd_market_cap ?? t.market_cap),
    liquidityUsd: liq,
    age: age != null ? duration(now - age) : 'unknown',
    score,
    disqualified: null,
    stage: life,
    reasons,
    yourWalletsIn,
    breakevenPct: rt.shareOfTrade,
    breakevenText: rt.shareOfTrade != null ? `At ${usd(sizeUsd)}, fees cost about ${usd(rt.totalUsd)} in and out, so it must rise about ${pct(rt.shareOfTrade, 0)} before you make a cent.` : null,
  };
}

export function rankOpportunities(items, ctx) {
  return items
    .map((t) => scoreToken(t, { ...ctx, yourWalletsIn: ctx.walletsByToken?.get(t.address) ?? [] }))
    .filter((s) => !s.disqualified)
    .sort((a, b) => b.yourWalletsIn.length - a.yourWalletsIn.length || b.score - a.score);
}
