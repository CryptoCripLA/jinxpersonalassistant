// Live explosive-momentum read for coins in GMGN's feeds.
//
// GMGN's launch lists carry running totals (swaps, buys, sells, volume, holders, curve
// progress, smart-money count). TokenTape keeps a few snapshots per coin and turns those
// totals into real per-minute flow, so "buying is speeding up" is measured, not guessed.
// For coins under a day old the 24h totals are lifetime totals, so the deltas are exact.
//
// momentumScore is a transparent checklist (every point has a sentence). It is a starting
// heuristic; the history study (analysis/history.js) measures which of these signals actually
// came before real 7x+ moves, and the app shows those hit rates beside the live signals.
import { usd, pct } from '../money/usd.js';
import { roundNice, plural } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const MAX_SNAPS = 14;
const KEEP_SEC = 15 * 60;

const read = (t) => ({
  swaps: num(t.swaps_24h ?? t.swaps),
  buys: num(t.buys_24h ?? t.buys),
  sells: num(t.sells_24h ?? t.sells),
  volume: num(t.volume_24h ?? t.volume),
  holders: num(t.holder_count),
  progress: num(t.progress),
  smart: num(t.smart_degen_count),
  mcap: num(t.market_cap ?? t.usd_market_cap),
});

export class TokenTape {
  constructor() {
    this.snaps = new Map();
  }

  add(t, ts) {
    if (!t?.address) return;
    const list = this.snaps.get(t.address) ?? [];
    if (list.length && list[list.length - 1].ts >= ts) return;
    list.push({ ts, ...read(t) });
    while (list.length > MAX_SNAPS || (list.length > 2 && ts - list[0].ts > KEEP_SEC)) list.shift();
    this.snaps.set(t.address, list);
  }

  prune(nowTs) {
    for (const [k, list] of this.snaps) if (!list.length || nowTs - list[list.length - 1].ts > KEEP_SEC) this.snaps.delete(k);
  }

  rates(address, _now) {
    const list = this.snaps.get(address);
    if (!list || list.length < 2) return null;
    const last = list[list.length - 1];
    let base = list[0];
    for (const s of list) if (s.ts <= last.ts - 45) base = s;
    const windowSec = last.ts - base.ts;
    if (windowSec <= 0) return null;
    const perMin = (k) => (last[k] != null && base[k] != null ? ((last[k] - base[k]) * 60) / windowSec : null);
    let prev = base;
    for (const s of list) if (s.ts >= base.ts - 300 && s.ts < prev.ts) prev = s;
    const prevSec = base.ts - prev.ts;
    const prevBuys = prevSec > 0 && base.buys != null && prev.buys != null ? ((base.buys - prev.buys) * 60) / prevSec : null;
    const buysPerMin = perMin('buys');
    let acceleration = null;
    if (prevBuys != null && buysPerMin != null) acceleration = prevBuys > 0 ? buysPerMin / prevBuys : buysPerMin > 0 ? 10 : null;
    return {
      windowSec,
      buysPerMin,
      sellsPerMin: perMin('sells'),
      swapsPerMin: perMin('swaps'),
      volumePerMinUsd: perMin('volume'),
      holdersPerMin: perMin('holders'),
      progressPerMin: perMin('progress'),
      smartAdded: last.smart != null && base.smart != null ? last.smart - base.smart : null,
      mcapChange: last.mcap != null && base.mcap > 0 ? last.mcap / base.mcap - 1 : null,
      acceleration,
    };
  }
}

export function momentumScore(t, { now, rates = null, explosiveWalletsIn = [] } = {}) {
  const reasons = [];
  const warnings = [];
  const rug = num(t.rug_ratio);
  if (rug != null && rug > 0.3) return { disqualified: `High rug-pull risk (${pct(rug, 0)})`, score: 0, reasons, warnings, stage: 'Avoid' };
  if (t.is_wash_trading === true || t.is_wash_trading === 'true') return { disqualified: 'Fake volume detected (wash trading)', score: 0, reasons, warnings, stage: 'Avoid' };
  if (Number(t.is_honeypot) === 1 || t.is_honeypot === true) return { disqualified: 'Cannot be sold (honeypot)', score: 0, reasons, warnings, stage: 'Avoid' };

  const parts = { ignition: 0, smart: 0, curve: 0, health: 20 };

  // 1. Ignition: are buyers piling in right now, and faster than a minute ago?
  if (!rates) {
    reasons.push('Live buying speed not measured yet (needs two looks about a minute apart).');
  } else {
    const b = rates.buysPerMin ?? 0;
    const s = rates.sellsPerMin ?? 0;
    if (b >= 30) parts.ignition += 15;
    else if (b >= 10) parts.ignition += 10;
    else if (b >= 3) parts.ignition += 5;
    reasons.push(`${roundNice(b)} buys a minute right now.`);
    const share = b + s > 0 ? b / (b + s) : null;
    if (share != null) {
      if (share >= 0.65) parts.ignition += 10;
      else if (share >= 0.55) parts.ignition += 5;
      reasons.push(`${pct(share, 0)} of recent trades are buys.`);
    }
    const a = rates.acceleration;
    if (a != null) {
      if (a >= 1.5) parts.ignition += 10;
      else if (a >= 1.1) parts.ignition += 5;
      if (a >= 1.1) reasons.push(`Buying is speeding up: ${roundNice(a)}x the pace of the minutes before.`);
    }
    if (s > b * 1.5 && s >= 3) warnings.push(`More selling than buying (${roundNice(s)} sells vs ${roundNice(b)} buys a minute).`);
    if ((rates.holdersPerMin ?? 0) < 0) warnings.push('Holders are leaving.');
    if ((rates.smartAdded ?? 0) < 0) warnings.push(`${plural(-rates.smartAdded, 'smart-money wallet')} left in the last minute or so.`);
  }

  // 2. Smart money: the wallets on your explosive list, then GMGN's smart-money tag.
  const recent = explosiveWalletsIn.filter((w) => w.ts == null || now - w.ts <= 1800);
  if (recent.length) {
    parts.smart += Math.min(20, recent.length * 10);
    reasons.push(`${plural(recent.length, 'explosive wallet')} from your list bought in the last 30 minutes.`);
  }
  const smart = num(t.smart_degen_count) ?? 0;
  if (smart >= 3) parts.smart += 10;
  else if (smart >= 1) parts.smart += 5;
  if (smart >= 1) reasons.push(`${plural(smart, 'smart-money wallet')} holding (GMGN tag).`);
  if ((rates?.smartAdded ?? 0) > 0) {
    parts.smart += 5;
    reasons.push(`${plural(rates.smartAdded, 'more smart-money wallet')} joined in the last minute or so.`);
  }
  parts.smart = Math.min(30, parts.smart);

  // 3. Graduation pull: near the end of the launch curve, or freshly graduated.
  const progress = num(t.progress);
  const completed = num(t.complete_timestamp);
  if (progress != null && progress < 1) {
    if (progress >= 0.8) {
      parts.curve += 10;
      reasons.push(`${pct(progress, 0)} of the way to graduating off the launch curve.`);
    }
    if ((rates?.progressPerMin ?? 0) >= 0.02) {
      parts.curve += 5;
      reasons.push(`Climbing ${roundNice(rates.progressPerMin * 100)} points a minute toward graduation.`);
    }
  } else if (completed && now - completed <= 1800) {
    parts.curve += 10;
    reasons.push(`Graduated ${Math.max(1, Math.round((now - completed) / 60))} minutes ago.`);
  }

  // 4. Health: GMGN's fake-activity and concentration readings.
  const pen = (cond, pts, text) => {
    if (!cond) return;
    parts.health -= pts;
    warnings.push(text);
  };
  const r = (k) => num(t[k]);
  pen(r('bundler_trader_amount_rate') > 0.3, 8, `Bundled wallets bought ${pct(r('bundler_trader_amount_rate'), 0)} of the volume (staged launch).`);
  pen(r('rat_trader_amount_rate') > 0.3, 6, `Insider "rat" traders made ${pct(r('rat_trader_amount_rate'), 0)} of the volume.`);
  pen(r('entrapment_ratio') > 0.3, 6, `Trap-trading score ${pct(r('entrapment_ratio'), 0)}: buys may be bait.`);
  pen(r('suspected_insider_hold_rate') > 0.2, 6, `Suspected insiders hold ${pct(r('suspected_insider_hold_rate'), 0)}.`);
  pen(r('top_10_holder_rate') > 0.5, 5, `Top 10 holders own ${pct(r('top_10_holder_rate'), 0)}.`);
  pen(r('dev_team_hold_rate') > 0.05, 3, `The creator's team still holds ${pct(r('dev_team_hold_rate'), 0)}.`);
  pen(r('bot_degen_rate') > 0.5, 4, `Bots are ${pct(r('bot_degen_rate'), 0)} of the traders.`);
  parts.health = Math.max(0, parts.health);
  if (parts.health === 20) reasons.push('No fake-activity warnings from GMGN.');

  const mcap = num(t.market_cap ?? t.usd_market_cap);
  if (mcap != null && mcap >= 5_000_000) warnings.push(`Already worth ${usd(mcap)}: a 10x from here needs ${usd(mcap * 10)}.`);

  const score = Math.round(parts.ignition + parts.smart + parts.curve + parts.health);
  let stage = 'Building';
  if (!rates) stage = 'Watching';
  else if (((rates.sellsPerMin ?? 0) > (rates.buysPerMin ?? 0) * 1.5 && (rates.sellsPerMin ?? 0) >= 3) || ((rates.acceleration ?? 1) < 0.6 && (rates.buysPerMin ?? 0) < 10)) stage = 'Fading';
  else if ((rates.acceleration ?? 0) >= 1.5 && (rates.buysPerMin ?? 0) >= 10 && (rates.buysPerMin ?? 0) / Math.max(1, (rates.buysPerMin ?? 0) + (rates.sellsPerMin ?? 0)) >= 0.55) stage = 'Ignition';
  return {
    disqualified: null,
    score,
    parts,
    stage,
    reasons,
    warnings,
    marketCapUsd: mcap,
    tenXMarketCapUsd: mcap != null ? mcap * 10 : null,
  };
}
