// History study: real coins that ran 7x+ within a day of launch. For each one we keep the
// move (base, breakout, peak), every signal we could have seen with its timing, what a $25
// follower would have made, and the wallets that were in before the breakout. Those wallets
// feed wallet discovery: this is how the app finds wallets that repeatedly get in early.
import { findExplosiveMove, signalTimeline } from '../analysis/history.js';
import { earlyBuyersFromTopTraders } from '../analysis/earlybuyers.js';
import { loadProfiles } from '../discovery/discover.js';
import { roundNice } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function studyToken(g, token, { explosive = new Set(), delaySec = 30, nowSec = Math.floor(Date.now() / 1000), minMultiple = 7 } = {}) {
  const info = await g.tokenInfo(token);
  const created = num(info?.creation_timestamp);
  if (created == null) return null;
  const supply = num(info.total_supply) ?? 1e9;
  const k = await g.klineRange(token, '5m', created, Math.min(nowSec, created + 24 * 3600));
  const move = findExplosiveMove(k.candles, k.resSec, { minMultiple });
  if (!move) return null;
  const lists = await Promise.all([
    g.tokenTraders(token, { orderBy: 'profit', limit: 100 }).catch(() => null),
    g.tokenTraders(token, { orderBy: 'profit', tag: 'smart_degen', limit: 100 }).catch(() => null),
  ]);
  const merged = new Map();
  for (const l of lists) for (const t of l?.list ?? []) if (!merged.has(t.address)) merged.set(t.address, t);
  const buyers = earlyBuyersFromTopTraders([...merged.values()], { totalSupply: supply, creationTs: created });
  const graduatedTs = num(info.migrated_timestamp) || null;
  const timeline = signalTimeline({ move, candles: k.candles, resSec: k.resSec, buyers, explosive, graduatedTs, delaySec });
  const earlyWallets = buyers
    .filter((b) => b.firstBuyTs < move.breakoutTs)
    .map((b) => ({
      wallet: b.wallet, name: b.name, firstBuyTs: b.firstBuyTs, entryMcapUsd: b.entryMcapUsd, capturedMultiple: b.capturedMultiple,
      profitUsd: b.profitUsd, tags: b.tags, stillHolding: b.stillHolding, secondsBeforeBreakout: move.breakoutTs - b.firstBuyTs,
    }));
  return {
    token,
    symbol: info.symbol ?? '',
    name: info.name ?? '',
    logo: info.logo ?? '',
    launchpad: info.launchpad_platform || info.launchpad || '',
    creationTs: created,
    graduatedTs,
    totalSupply: supply,
    move,
    baseMcapUsd: move.basePrice * supply,
    peakMcapUsd: move.peakPrice * supply,
    signals: timeline.signals,
    firstUsefulSignal: timeline.firstUsefulSignal,
    earlyWallets,
    tradersRead: merged.size,
    candles: k.candles,
    resSec: k.resSec,
    studiedAt: nowSec,
  };
}

function addCandidate(db, wallet, source, tags = []) {
  const now = Date.now();
  const row = db.prepare('SELECT sources FROM candidates WHERE wallet = ?').get(wallet);
  const cur = row ? JSON.parse(row.sources) : { sources: [], tags: [] };
  if (!cur.sources.includes(source)) cur.sources.push(source);
  cur.tags = [...new Set([...(cur.tags ?? []), ...tags])];
  db.prepare(`INSERT INTO candidates (wallet, sources, first_seen, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet) DO UPDATE SET sources = excluded.sources, last_seen = excluded.last_seen`).run(wallet, JSON.stringify(cur), now, now);
}

export async function runStudy(g, db, { tokens, explosive = new Set(), nowSec = Math.floor(Date.now() / 1000), onProgress = () => {}, log = () => {} } = {}) {
  let studied = 0;
  let examples = 0;
  const save = db.prepare(`INSERT INTO explosive_examples (token, data, built_at) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET data = excluded.data, built_at = excluded.built_at`);
  for (const t of tokens) {
    onProgress({ phase: 'studying coins', done: studied, total: tokens.length, examples });
    try {
      const ex = await studyToken(g, t, { explosive, nowSec });
      studied += 1;
      if (!ex) continue;
      examples += 1;
      save.run(t, JSON.stringify(ex), Date.now());
      for (const w of ex.earlyWallets) {
        if ((w.capturedMultiple ?? 0) >= 3 || (w.profitUsd ?? 0) > 0) {
          addCandidate(db, w.wallet, `early on ${ex.symbol}: bought before ${ex.symbol} ran ${roundNice(ex.move.multiple)}x`, w.tags ?? []);
        }
      }
    } catch (e) {
      studied += 1;
      log(`study of ${t} failed: ${e.message}`);
      if (e.code === 'RATE') break;
    }
  }
  onProgress({ phase: 'done', done: studied, total: tokens.length, examples });
  return { studied, examples };
}

// Coins worth studying: ones our wallets traded recently that went up a lot for somebody,
// plus GMGN's graduated and trending lists. Already-studied coins are skipped.
export async function pickStudyTokens(g, db, { limit = 40, days = 7, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const done = new Set(db.prepare('SELECT token FROM explosive_examples').all().map((r) => r.token));
  const score = new Map();
  for (const p of loadProfiles(db)) {
    for (const x of p.positions ?? []) {
      if (x.openTs < nowSec - days * 86400 || done.has(x.token)) continue;
      const s = Math.max(x.returnRatio ?? 0, 0) + 0.1;
      score.set(x.token, (score.get(x.token) ?? 0) + s);
    }
  }
  const picked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, Math.floor(limit * 0.6));
  const extra = [];
  try {
    const tr = await g.trenches(['completed'], {});
    extra.push(...(tr.completed ?? []).map((t) => t.address));
  } catch { /* optional source */ }
  try {
    const rk = await g.trending('1h', { order_by: 'change', limit: 50 });
    extra.push(...rk.rank.filter((t) => Number(t.price_change_percent1h) > 300).map((t) => t.address));
  } catch { /* optional source */ }
  for (const t of extra) if (!done.has(t) && !picked.includes(t) && picked.length < limit) picked.push(t);
  return picked;
}

export function loadExamples(db) {
  return db.prepare('SELECT data FROM explosive_examples').all()
    .map((r) => JSON.parse(r.data))
    .sort((a, b) => b.move.multiple - a.move.multiple);
}
