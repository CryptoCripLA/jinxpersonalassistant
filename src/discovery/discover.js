// Automated wallet discovery.
//   1. Gather candidates: GMGN smart-money and KOL trade feeds, plus the most profitable
//      traders on recently graduated coins and on the 1-hour trending list.
//   2. Prefilter in bulk with portfolio profits (100 wallets per request): keep wallets
//      that made money over 30 days without bot-like buy counts.
//   3. Deep-read survivors: GMGN 30-day stats + up to 300 trades -> round trips -> profile.
import { normalizeActivity, buildPositions, tokenMetaFromInfo } from '../analysis/trades.js';
import { computeProfile } from '../analysis/profile.js';
import { cleanLabel, roundNice } from '../text/plain.js';

const INSIDER_TAGS = new Set(['creator', 'dev_team', 'bundler', 'rat_trader', 'entrapment']);
const BOT_TAGS = new Set(['dex_bot', 'sandwich_bot', 'mev_bot']);
export const MAX_BUYS_PER_DAY = 20; // generous: 1-3 coins a day plus adds still fits well under this
export const MIN_BUYS_30D = 10;
export const SELECTIVE_BUYS_PER_DAY = 6; // deep-read these first: they can match a 1-3 coins a day style

export function tradersToCandidates(list, { symbol, why }) {
  const out = [];
  for (const t of list ?? []) {
    if (Number(t.addr_type) !== 0) continue;
    if (!(Number(t.realized_profit) > 0)) continue;
    if ((t.maker_token_tags ?? []).some((x) => INSIDER_TAGS.has(x))) continue;
    if ((t.tags ?? []).some((x) => BOT_TAGS.has(x))) continue;
    out.push({ wallet: t.address, source: `top earner on ${cleanLabel(symbol, 16)} (${why})`, tags: t.tags ?? [] });
  }
  return out;
}

export function feedToCandidates(feed, label) {
  const seen = new Map();
  for (const r of feed?.list ?? []) {
    if (!r.maker || seen.has(r.maker)) continue;
    seen.set(r.maker, { wallet: r.maker, source: label, tags: r.maker_info?.tags ?? [] });
  }
  return [...seen.values()];
}

export function prefilter(rows, { days = 30, maxBuysPerDay = MAX_BUYS_PER_DAY } = {}) {
  const keep = [];
  const dropped = {};
  for (const r of rows) {
    const w = r.wallet_address;
    const buys = Number(r.buy ?? 0);
    const profit = Number(r.realized_profit ?? 0);
    if (buys === 0) dropped[w] = 'no trades in the last 30 days';
    else if (buys < MIN_BUYS_30D) dropped[w] = `only ${buys} buys in 30 days — too few to judge`;
    else if (buys / days > maxBuysPerDay) dropped[w] = `about ${roundNice(buys / days)} buys a day — too busy to copy on a small account`;
    else if (profit <= 0) dropped[w] = 'lost money over the last 30 days';
    else keep.push({ wallet: w, realizedUsd30d: profit, buys30d: buys, sells30d: Number(r.sell ?? 0) });
  }
  // Selective traders first, then profit per buy (total profit favours busy bots).
  const selective = (k) => (k.buys30d / days <= SELECTIVE_BUYS_PER_DAY ? 1 : 0);
  keep.sort((a, b) => selective(b) - selective(a) || b.realizedUsd30d / b.buys30d - a.realizedUsd30d / a.buys30d);
  return { keep, dropped };
}

export async function gatherCandidates(g, { graduatedTokens = 25, trendingTokens = 10, log = () => {} } = {}) {
  const all = [];
  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (e) {
      log(`skipped ${label}: ${e.message}`);
      return null;
    }
  };
  const sm = await safe('smart money feed', () => g.smartMoney(200));
  all.push(...feedToCandidates(sm, 'GMGN smart money feed'));
  const kol = await safe('KOL feed', () => g.kol(200));
  all.push(...feedToCandidates(kol, 'GMGN KOL feed'));

  const tr = await safe('graduated coins', () => g.trenches(['completed'], { max_rug_ratio: 0.3, max_bundler_rate: 0.3, max_insider_ratio: 0.3 }));
  const grads = (tr?.completed ?? []).sort((a, b) => Number(b.volume_24h ?? 0) - Number(a.volume_24h ?? 0)).slice(0, graduatedTokens);
  for (const t of grads) {
    const d = await safe(`traders of ${t.symbol}`, () => g.tokenTraders(t.address, { orderBy: 'profit', limit: 100 }));
    all.push(...tradersToCandidates(d?.list, { symbol: t.symbol, why: 'graduated coin' }));
    const sm = await safe(`smart traders of ${t.symbol}`, () => g.tokenTraders(t.address, { orderBy: 'profit', tag: 'smart_degen', limit: 100 }));
    all.push(...tradersToCandidates(sm?.list, { symbol: t.symbol, why: 'smart money on a graduated coin' }));
  }
  const rk = await safe('trending', () => g.trending('1h', { order_by: 'volume', limit: 50 }));
  const hot = (rk?.rank ?? []).slice(0, trendingTokens);
  for (const t of hot) {
    const d = await safe(`traders of ${t.symbol}`, () => g.tokenTraders(t.address, { orderBy: 'profit', limit: 100 }));
    all.push(...tradersToCandidates(d?.list, { symbol: t.symbol, why: 'trending coin' }));
  }
  const merged = new Map();
  for (const c of all) {
    const m = merged.get(c.wallet) ?? { wallet: c.wallet, sources: [], tags: new Set() };
    if (!m.sources.includes(c.source)) m.sources.push(c.source);
    for (const t of c.tags) m.tags.add(t);
    merged.set(c.wallet, m);
  }
  return [...merged.values()].map((m) => ({ ...m, tags: [...m.tags] }));
}

export async function deepProfile(g, wallet, { pages = 6, log = () => {} } = {}) {
  const [stats30, rows] = await Promise.all([g.walletStats(wallet, '30d').catch(() => null), g.walletActivityPages(wallet, pages)]);
  const { positions, orphanSells } = buildPositions(rows.map(normalizeActivity).filter(Boolean));
  const metas = new Map();
  for (const tok of new Set(positions.map((p) => p.token))) {
    try {
      metas.set(tok, tokenMetaFromInfo(await g.tokenInfo(tok)));
    } catch (e) {
      log(`token info missing for ${tok}: ${e.message}`);
      metas.set(tok, null);
    }
  }
  return computeProfile({ wallet, positions, orphanSells, metaByToken: (t) => metas.get(t), stats30 });
}

// Full pipeline with progress reporting. Profiles are stored for the UI and the simulator.
export async function runDiscovery(g, db, { maxDeep = 40, log = () => {}, onProgress = () => {} } = {}) {
  const started = Date.now();
  onProgress({ phase: 'gathering', done: 0, total: 0 });
  const candidates = await gatherCandidates(g, { log });
  const now = Date.now();
  const up = db.prepare(`INSERT INTO candidates (wallet, sources, first_seen, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET sources = excluded.sources, last_seen = excluded.last_seen`);
  for (const c of candidates) up.run(c.wallet, JSON.stringify({ sources: c.sources, tags: c.tags }), now, now);
  onProgress({ phase: 'prefilter', done: 0, total: candidates.length });
  const profits = await g.walletProfits(candidates.map((c) => c.wallet), '30d');
  const { keep, dropped } = prefilter(profits, { days: 30 });
  const setPre = db.prepare('UPDATE candidates SET prefilter = ?, status = ? WHERE wallet = ?');
  for (const [w, why] of Object.entries(dropped)) setPre.run(why, 'dropped', w);
  const deep = keep.slice(0, maxDeep);
  const saveProfile = db.prepare(`INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET profile = excluded.profile, built_at = excluded.built_at, source = excluded.source`);
  const bySource = new Map(candidates.map((c) => [c.wallet, c]));
  let done = 0;
  for (const k of deep) {
    onProgress({ phase: 'reading wallets', done, total: deep.length });
    try {
      const p = await deepProfile(g, k.wallet, { log });
      p.discovery = { sources: bySource.get(k.wallet)?.sources ?? [], tags: bySource.get(k.wallet)?.tags ?? [], realizedUsd30d: k.realizedUsd30d, buys30d: k.buys30d };
      saveProfile.run(k.wallet, JSON.stringify(p), Date.now(), 'discovery');
      setPre.run('kept', 'profiled', k.wallet);
    } catch (e) {
      log(`could not profile ${k.wallet}: ${e.message}`);
      if (e.code === 'RATE') break;
    }
    done += 1;
  }
  onProgress({ phase: 'done', done, total: deep.length });
  return { candidates: candidates.length, kept: keep.length, profiled: done, dropped: Object.keys(dropped).length, ms: Date.now() - started };
}

export function loadProfiles(db) {
  return db.prepare('SELECT profile, built_at FROM wallet_profiles').all().map((r) => ({ ...JSON.parse(r.profile), builtAt: r.built_at }));
}
