// One door to GMGN: the official OpenApiClient (gmgn-cli 1.6.7, MIT) behind a
// plan-aware leaky bucket, a SQLite cache, and plain-English errors.
import { LeakyBucket, PLANS } from './limiter.js';
import { ROUTE_WEIGHTS } from './weights.js';

const CHAIN = 'sol';
const S = 1000;
const MIN = 60 * S;
const RES_SEC = { '30s': 30, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

export class GmgnError extends Error {
  // answered=true means GMGN's server replied with an error, so the request was
  // definitely not carried out. answered=false means we cannot know (network failure).
  constructor(message, { code, route, resetAt, answered = false } = {}) {
    super(message);
    this.name = 'GmgnError';
    this.code = code;
    this.route = route;
    this.resetAt = resetAt;
    this.answered = answered;
  }
}

export class Gmgn {
  constructor({ api, db, plan = 'pro', sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
    this.api = api;
    this.db = db;
    this.planName = plan;
    this.bucket = new LeakyBucket(PLANS[plan] ?? PLANS.free, now);
    this.sleep = sleep;
    this.now = now;
    this.oneSecondRefused = false;
    this.blockedRoutes = new Set();
    this.stats = { calls: 0, cacheHits: 0, errors: 0 };
  }

  cacheGet(key) {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT value, fetched_at, ttl_ms FROM cache WHERE key = ?').get(key);
    if (!row || this.now() - row.fetched_at > row.ttl_ms) return undefined;
    this.stats.cacheHits += 1;
    return JSON.parse(row.value);
  }

  cacheSet(key, value, ttl) {
    if (!this.db || ttl <= 0) return;
    this.db
      .prepare('INSERT INTO cache (key, value, fetched_at, ttl_ms) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, ttl_ms = excluded.ttl_ms')
      .run(key, JSON.stringify(value), this.now(), ttl);
  }

  async call(route, fn, { cacheKey, ttl = 0 } = {}) {
    if (cacheKey) {
      const hit = this.cacheGet(cacheKey);
      if (hit !== undefined) return hit;
    }
    const weight = ROUTE_WEIGHTS[route] ?? 1;
    if (this.blockedRoutes.has(route) || this.bucket.delayFor(weight).impossible) {
      throw new GmgnError(`This GMGN request (${route}) needs a bigger GMGN API plan than the one on your key.`, { code: 'PLAN', route, answered: true });
    }
    const wait = this.bucket.take(weight);
    if (wait > 0) await this.sleep(wait);
    this.stats.calls += 1;
    try {
      const data = await fn();
      if (cacheKey) this.cacheSet(cacheKey, data, ttl);
      return data;
    } catch (e) {
      this.stats.errors += 1;
      throw this.translate(e, route);
    }
  }

  translate(e, route) {
    if (e?.name !== 'OpenApiError') return new GmgnError(`GMGN request ${route} failed: ${e?.message ?? e}`, { route });
    if (e.status === 429 || /RATE_LIMIT/.test(e.apiError ?? '')) {
      const resetAt = (e.resetAtUnix ?? Math.floor(this.now() / 1000) + 300) * 1000;
      this.bucket.banUntil(resetAt);
      return new GmgnError(`GMGN paused requests until ${new Date(resetAt).toISOString().slice(11, 19)} UTC (rate limit). Waiting instead of retrying.`, { code: 'RATE', route, resetAt, answered: true });
    }
    if (e.apiError === 'PLAN_UPGRADE_REQUIRED' || e.apiError === 'PRO_PLAN_REQUIRED') {
      this.blockedRoutes.add(route);
      return new GmgnError(`GMGN says your API plan does not include ${route}: ${e.apiMessage ?? e.message}`, { code: 'PLAN', route, answered: true });
    }
    return new GmgnError(`GMGN ${route} error: ${e.apiMessage ?? e.message}`, { code: e.apiError ?? 'API', route, answered: true });
  }

  // ---- account & prices
  userInfo() {
    return this.call('userInfo', () => this.api.getUserInfo(), { cacheKey: 'userInfo', ttl: 30 * S });
  }

  async solUsd() {
    const g = await this.call('gasPrice', () => this.api.getGasPrice(CHAIN), { cacheKey: 'gas:sol', ttl: 30 * S });
    const p = Number(g?.native_token_usd_price);
    return Number.isFinite(p) && p > 0 ? { usdPerSol: p, source: 'GMGN gas-price', at: this.now() } : null;
  }

  // ---- tokens
  tokenInfo(addr) {
    return this.call('tokenInfo', () => this.api.getTokenInfo(CHAIN, addr), { cacheKey: `ti:${addr}`, ttl: 10 * MIN });
  }

  tokenSecurity(addr) {
    return this.call('tokenSecurity', () => this.api.getTokenSecurity(CHAIN, addr), { cacheKey: `ts:${addr}`, ttl: 10 * MIN });
  }

  tokenTraders(addr, { orderBy = 'profit', tag, limit = 100 } = {}) {
    const extra = { order_by: orderBy, direction: 'desc', limit };
    if (tag) extra.tag = tag;
    return this.call('tokenTraders', () => this.api.getTokenTopTraders(CHAIN, addr, extra), { cacheKey: `tt:${addr}:${orderBy}:${tag ?? ''}:${limit}`, ttl: 5 * MIN });
  }

  // Candles in seconds. Tries Pro 1s candles; once refused, uses 30s for the session.
  // The live API takes from/to in MILLISECONDS (verified 2026-10-20: second values return
  // no candles even though the docs say seconds) and returns candle time in ms.
  async candles(addr, from, to) {
    const fromMs = Math.floor(from) * 1000;
    const toMs = Math.ceil(to) * 1000;
    const historical = to < this.now() / 1000 - 600;
    const ttl = historical ? 30 * 24 * 60 * MIN : 30 * S;
    const norm = (data, resolution) => ({
      resolution,
      candles: (data?.list ?? []).map((c) => ({
        t: c.time >= 1e11 ? Math.floor(c.time / 1000) : c.time,
        open: Number(c.open), close: Number(c.close), high: Number(c.high), low: Number(c.low),
        volumeUsd: Number(c.volume),
      })),
    });
    if (!this.oneSecondRefused) {
      try {
        const d = await this.call('kline1s', () => this.api.getTokenKline(CHAIN, addr, '1s', fromMs, toMs), { cacheKey: `k1:${addr}:${from}:${to}`, ttl });
        return norm(d, '1s');
      } catch (e) {
        if (e.code !== 'PLAN') throw e;
        this.oneSecondRefused = true;
      }
    }
    const d = await this.call('kline', () => this.api.getTokenKline(CHAIN, addr, '30s', fromMs, toMs), { cacheKey: `k30:${addr}:${from}:${to}`, ttl });
    return norm(d, '30s');
  }

  // Any resolution over any range. GMGN answers at most 100 candles per request (the newest
  // 100 inside the window, verified 2026-10-20), so the range is read in 100-candle windows.
  async klineRange(addr, resolution, fromSec, toSec) {
    const resSec = RES_SEC[resolution];
    if (!resSec) throw new GmgnError(`unknown candle size ${resolution}`, { route: 'kline' });
    const span = resSec * 100;
    const byT = new Map();
    for (let a = Math.floor(fromSec); a < toSec; a += span) {
      const b = Math.min(toSec, a + span);
      const historical = b < this.now() / 1000 - 600;
      const d = await this.call('kline', () => this.api.getTokenKline(CHAIN, addr, resolution, a * 1000, b * 1000), {
        cacheKey: `kr:${addr}:${resolution}:${a}:${b}`,
        ttl: historical ? 30 * 24 * 60 * MIN : 20 * S,
      });
      for (const c of d?.list ?? []) {
        const t = c.time >= 1e11 ? Math.floor(c.time / 1000) : c.time;
        if (t < fromSec - resSec || t > toSec) continue;
        byT.set(t, { t, open: Number(c.open), close: Number(c.close), high: Number(c.high), low: Number(c.low), volumeUsd: Number(c.volume) });
      }
    }
    return { resolution, resSec, candles: [...byT.values()].sort((x, y) => x.t - y.t) };
  }

  tokenPool(addr) {
    return this.call('tokenPool', () => this.api.getTokenPoolInfo(CHAIN, addr), { cacheKey: `tp:${addr}`, ttl: 30 * S });
  }

  tokenHolders(addr, { limit = 50 } = {}) {
    return this.call('tokenHolders', () => this.api.getTokenTopHolders(CHAIN, addr, { limit }), { cacheKey: `th:${addr}:${limit}`, ttl: 30 * S });
  }

  tokenInfoLive(addr) {
    return this.call('tokenInfo', () => this.api.getTokenInfo(CHAIN, addr), { cacheKey: `til:${addr}`, ttl: 8 * S });
  }

  walletHoldings(wallet, { limit = 50 } = {}) {
    return this.call('walletHoldings', () => this.api.getWalletHoldings(CHAIN, wallet, { limit }), { cacheKey: `wh:${wallet}:${limit}`, ttl: 15 * S });
  }

  // ---- wallets
  walletActivity(wallet, { cursor, limit = 50, fresh = false } = {}) {
    const extra = { limit };
    if (cursor) extra.cursor = cursor;
    const cache = fresh ? {} : { cacheKey: `wa:${wallet}:${cursor ?? ''}:${limit}`, ttl: 2 * MIN };
    return this.call('walletActivity', () => this.api.getWalletActivity(CHAIN, wallet, extra), cache);
  }

  walletTokenBalance(wallet, token) {
    return this.call('walletTokenBalance', () => this.api.getWalletTokenBalance(CHAIN, wallet, token));
  }

  async walletActivityPages(wallet, pages = 4) {
    const rows = [];
    let cursor;
    for (let i = 0; i < pages; i++) {
      const d = await this.walletActivity(wallet, { cursor });
      rows.push(...(d?.activities ?? []));
      cursor = d?.next;
      if (!cursor || !(d?.activities ?? []).length) break;
    }
    return rows;
  }

  walletStats(wallet, period = '30d') {
    return this.call('walletStats', () => this.api.getWalletStats(CHAIN, [wallet], period), { cacheKey: `ws:${wallet}:${period}`, ttl: 10 * MIN });
  }

  async walletProfits(wallets, period = '30d') {
    const out = [];
    for (let i = 0; i < wallets.length; i += 100) {
      const chunk = wallets.slice(i, i + 100);
      const d = await this.call('walletProfits', () => this.api.getWalletProfits(CHAIN, chunk, period), { cacheKey: `wp:${period}:${chunk.join(',')}`, ttl: 10 * MIN });
      out.push(...(d?.list ?? []));
    }
    return out;
  }

  createdTokens(wallet) {
    return this.call('createdTokens', () => this.api.getCreatedTokens(CHAIN, wallet, {}), { cacheKey: `ct:${wallet}`, ttl: 30 * MIN });
  }

  // ---- feeds
  smartMoney(limit = 200) {
    return this.call('smartMoney', () => this.api.getSmartMoney(CHAIN, limit), { cacheKey: `sm:${limit}`, ttl: 30 * S });
  }

  kol(limit = 200) {
    return this.call('kol', () => this.api.getKol(CHAIN, limit), { cacheKey: `kol:${limit}`, ttl: 30 * S });
  }

  followWallet(extra = {}) {
    return this.call('followWallet', () => this.api.getFollowWallet(CHAIN, extra));
  }

  trenches(types, filters = {}, limit = 80, { ttlMs = 30 * S } = {}) {
    const key = `tr:${types.join(',')}:${JSON.stringify(filters)}:${limit}`;
    return this.call('trenches', () => this.api.getTrenches(CHAIN, types, undefined, limit, Object.keys(filters).length ? filters : undefined), { cacheKey: key, ttl: ttlMs });
  }

  // GMGN sometimes wraps the list as { code, data: { rank } } (seen live for 1m and 5m).
  async trending(interval = '1h', extra = {}) {
    const ttl = interval === '1m' || interval === '5m' ? 15 * S : 60 * S;
    const d = await this.call('trending', () => this.api.getTrendingSwaps(CHAIN, interval, extra), { cacheKey: `rk:${interval}:${JSON.stringify(extra)}`, ttl });
    return { rank: d?.rank ?? d?.data?.rank ?? [] };
  }

  signals(groups) {
    return this.call('signal', () => this.api.getTokenSignalV2(CHAIN, groups), { cacheKey: `sig:${JSON.stringify(groups)}`, ttl: 30 * S });
  }

  calloutGlobal(extra = {}) {
    return this.call('calloutGlobal', () => this.api.getCalloutGlobal([CHAIN], extra), { cacheKey: `cg:${JSON.stringify(extra)}`, ttl: 60 * S });
  }

  // ---- trading (never cached)
  quote({ from_address, input_token, output_token, input_amount, slippage }) {
    return this.call('quote', () => this.api.quoteOrder(CHAIN, from_address, input_token, output_token, input_amount, slippage));
  }

  swap(params) {
    return this.call('swap', () => this.api.swap({ chain: CHAIN, ...params }));
  }

  queryOrder(orderId) {
    return this.call('queryOrder', () => this.api.queryOrder(orderId, CHAIN));
  }
}

// Builds the real client from GMGN's own credential file (~/.config/gmgn/.env),
// the same file gmgn-cli writes. Nothing secret is stored in this repository.
export async function realApi() {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFileSync, existsSync } = await import('node:fs');
  const envPath = join(homedir(), '.config', 'gmgn', '.env');
  let apiKey = process.env.GMGN_API_KEY;
  let privateKey = process.env.GMGN_PRIVATE_KEY;
  if (existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8');
    apiKey ??= /^GMGN_API_KEY=(.*)$/m.exec(text)?.[1]?.trim();
    privateKey ??= /^GMGN_PRIVATE_KEY=(.*)$/m.exec(text)?.[1]?.trim();
  }
  if (!apiKey) return null;
  const { OpenApiClient } = await import('gmgn-cli/dist/client/OpenApiClient.js');
  return new OpenApiClient({ apiKey, privateKeyPem: privateKey ? privateKey.replace(/\\n/g, '\n') : undefined, host: 'https://openapi.gmgn.ai' });
}
