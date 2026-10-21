// pump.fun's own public API (unofficial, no key). Verified live from jinx-nyc 2026-10-20:
//   swap-api.pump.fun/v2/coins/{mint}/trades?limit=100&cursor=  every trade, newest first,
//                                                              paged by pagination.nextCursor
//   swap-api.pump.fun/v2/coins/{mint}/candles?interval=1m&limit=1000&currency=USD&createdTs=
//                                                              latest 1,000 USD candles
//   frontend-api-v3.pump.fun/coins-v2/{mint}                   coin details (curve, creator, socials)
// Cloudflare blocks bursts (429 after ~19 requests in under a second), so calls are spaced out
// and a 429 pauses pump.fun for a minute instead of retrying. Routes can change without notice;
// every caller falls back to GMGN when this returns nothing.

const SWAP = 'https://swap-api.pump.fun';
const FRONT = 'https://frontend-api-v3.pump.fun';
const HEADERS = { accept: 'application/json', origin: 'https://pump.fun' };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizeTrade(r) {
  if (r?.type !== 'buy' && r?.type !== 'sell') return null;
  const ts = Date.parse(r.timestamp);
  if (!Number.isFinite(ts) || !r.userAddress) return null;
  return {
    tx: r.tx,
    ts: Math.floor(ts / 1000),
    wallet: r.userAddress,
    side: r.type,
    priceUsd: num(r.priceUsd),
    usd: num(r.amountUsd),
    tokens: num(r.baseAmount),
    program: r.program ?? '',
    order: r.slotIndexId ?? '',
  };
}

export class PumpFun {
  constructor({ fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, minGapMs = 250, log = () => {} } = {}) {
    Object.assign(this, { fetchFn: fetch, sleep, now, minGapMs, log });
    this.lastAt = -Infinity;
    this.pausedUntil = 0;
    this.cache = new Map();
    this.stats = { calls: 0, limited: 0, errors: 0 };
  }

  async get(url) {
    if (this.now() < this.pausedUntil) return { status: 429, body: null };
    const wait = this.lastAt + this.minGapMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastAt = this.now();
    this.stats.calls += 1;
    try {
      const res = await this.fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
      if (res.status === 429) {
        this.stats.limited += 1;
        this.pausedUntil = this.now() + 60_000;
      }
      return { status: res.status, body: res.status === 200 ? await res.json() : null };
    } catch (e) {
      this.stats.errors += 1;
      this.log(`pump.fun ${url}: ${e.message}`);
      return { status: 0, body: null };
    }
  }

  cached(key, ttlMs, fn) {
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < ttlMs) return hit.value;
    const value = fn().then((v) => {
      if (this.cache.size > 500) this.cache.clear();
      return v;
    });
    this.cache.set(key, { at: this.now(), value });
    return value;
  }

  // Every trade from the newest back to the first (or until maxPages), returned oldest first.
  trades(mint, { maxPages = 20 } = {}) {
    return this.cached(`tr:${mint}:${maxPages}`, 20_000, () => this.fetchTrades(mint, maxPages));
  }

  async fetchTrades(mint, maxPages) {
    const out = [];
    let cursor = '0';
    let pages = 0;
    let note = '';
    while (cursor && pages < maxPages) {
      const r = await this.get(`${SWAP}/v2/coins/${mint}/trades?limit=100&cursor=${encodeURIComponent(cursor)}`);
      if (r.status === 429) {
        note = 'pump.fun rate limit hit, so this history is partial.';
        break;
      }
      if (r.status !== 200 || !Array.isArray(r.body?.trades)) {
        note = `pump.fun did not return trades (HTTP ${r.status}).`;
        break;
      }
      pages += 1;
      for (const t of r.body.trades) {
        const n = normalizeTrade(t);
        if (n) out.push(n);
      }
      cursor = r.body.trades.length ? r.body.pagination?.nextCursor : null;
    }
    const complete = !cursor && !note;
    if (!complete && !note) note = `Only the latest ${pages * 100} trades were read.`;
    out.sort((a, b) => a.ts - b.ts || (a.order < b.order ? -1 : 1));
    return { trades: out, complete, pages, note };
  }

  candles(mint, createdTsMs, interval = '1m') {
    return this.cached(`k:${mint}:${interval}`, 30_000, async () => {
      const r = await this.get(`${SWAP}/v2/coins/${mint}/candles?interval=${interval}&limit=1000&currency=USD&createdTs=${Math.floor(createdTsMs)}`);
      if (r.status !== 200 || !Array.isArray(r.body)) return [];
      return r.body.map((c) => ({ t: Math.floor(c.timestamp / 1000), open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volumeUsd: num(c.volume) }));
    });
  }

  coin(mint) {
    return this.cached(`c:${mint}`, 60_000, async () => {
      const r = await this.get(`${FRONT}/coins-v2/${mint}`);
      return r.status === 200 ? r.body : null;
    });
  }
}
