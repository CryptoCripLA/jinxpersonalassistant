// PumpPortal's free live data stream for pump.fun (wss://pumpportal.fun/api/data), verified
// from jinx-nyc 2026-10-20. One connection carries: every new coin, every graduation
// (migration), every trade by the wallets we follow (your explosive list) and every trade on
// the coins you have open. The server connects only while the terminal is open, because
// PumpPortal asks for one connection per user and JINX's engine uses it from the same host.

const URL = 'wss://pumpportal.fun/api/data';
const KEEP = { new: 300, migration: 150, trade: 600 };

export function normalizeEvent(m) {
  if (!m || !m.mint || !m.signature) return null;
  const base = { mint: m.mint, sig: m.signature, wallet: m.traderPublicKey ?? null, marketCapSol: Number(m.marketCapSol) || null, solAmount: Number(m.solAmount) || 0 };
  if (m.txType === 'create') return { ...base, kind: 'new', symbol: m.symbol ?? '', name: m.name ?? '', uri: m.uri ?? '' };
  if (m.txType === 'migrate') return { ...base, kind: 'migration', pool: m.pool ?? '' };
  if (m.txType === 'buy' || m.txType === 'sell') return { ...base, kind: 'trade', side: m.txType, tokenAmount: Number(m.tokenAmount) || 0, pool: m.pool ?? '' };
  return null;
}

export class PumpPortalStream {
  constructor({ WebSocketImpl = globalThis.WebSocket, url = URL, now = Date.now, log = () => {}, setTimer = (fn, ms) => setTimeout(fn, ms) } = {}) {
    Object.assign(this, { WS: WebSocketImpl, url, now, log, setTimer });
    this.wanted = false;
    this.ws = null;
    this.open = false;
    this.backoff = 5000;
    this.wallets = new Set();
    this.tokens = new Set();
    this.listeners = new Set();
    this.recent = { new: [], migration: [], trade: [] };
    this.stats = { connects: 0, messages: 0, lastMessageAt: null };
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(o) {
    if (this.open) this.ws.send(JSON.stringify(o));
  }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.connect();
  }

  stop() {
    this.wanted = false;
    this.open = false;
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
  }

  connect() {
    if (!this.wanted) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    this.stats.connects += 1;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.open = true;
      this.backoff = 5000;
      this.send({ method: 'subscribeNewToken' });
      this.send({ method: 'subscribeMigration' });
      if (this.wallets.size) this.send({ method: 'subscribeAccountTrade', keys: [...this.wallets] });
      if (this.tokens.size) this.send({ method: 'subscribeTokenTrade', keys: [...this.tokens] });
    };
    ws.onmessage = (msg) => {
      let e = null;
      try {
        e = normalizeEvent(JSON.parse(String(msg.data)));
      } catch { /* not JSON */ }
      if (!e) return;
      e.at = this.now();
      this.stats.messages += 1;
      this.stats.lastMessageAt = e.at;
      const list = this.recent[e.kind];
      list.push(e);
      if (list.length > KEEP[e.kind]) list.splice(0, list.length - KEEP[e.kind]);
      for (const fn of this.listeners) fn(e);
    };
    ws.onerror = (err) => this.log(`PumpPortal stream error: ${err?.message ?? err}`);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.open = false;
      this.ws = null;
      if (!this.wanted) return;
      const wait = this.backoff;
      this.backoff = Math.min(60_000, this.backoff * 2);
      this.setTimer(() => this.connect(), wait);
    };
  }

  setKeys(set, next, sub, unsub) {
    const want = new Set(next);
    const add = [...want].filter((k) => !set.has(k));
    const drop = [...set].filter((k) => !want.has(k));
    for (const k of drop) set.delete(k);
    for (const k of add) set.add(k);
    if (drop.length) this.send({ method: unsub, keys: drop });
    if (add.length) this.send({ method: sub, keys: add });
  }

  watchWallets(list) {
    this.setKeys(this.wallets, list, 'subscribeAccountTrade', 'unsubscribeAccountTrade');
  }

  watchTokens(list) {
    this.setKeys(this.tokens, list, 'subscribeTokenTrade', 'unsubscribeTokenTrade');
  }

  // Buys on one coin by followed wallets within the last `windowSec` (now in seconds).
  walletBuys(mint, nowSec, windowSec = 1800) {
    return this.recent.trade
      .filter((t) => t.mint === mint && t.side === 'buy' && this.wallets.has(t.wallet) && nowSec - t.at / 1000 <= windowSec)
      .map((t) => ({ wallet: t.wallet, ts: Math.floor(t.at / 1000), solAmount: t.solAmount }));
  }
}
