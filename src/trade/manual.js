// Your own Buy and Sell buttons, through GMGN's swap API from your GMGN wallet.
//   1. quote: GMGN prices the trade; you see dollars in, coins out, and the worst fill you accept.
//   2. confirm: sends exactly that quote's minimum output, only within 30 seconds of quoting.
//      The order is written down BEFORE it is sent; one quote can become one order, never two.
//   3. reconcile: asks GMGN for each submitted order's status. A fill counts only once GMGN
//      reports it confirmed. If GMGN never answers a send, the order is marked "unknown" and is
//      never sent again (it may have gone through).
// Nothing here runs unless you press a button; the assistant has no access to this module.
import { randomUUID } from 'node:crypto';
import { usdToLamports, lamportsToUsd } from '../money/usd.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTE_TTL_MS = 30_000;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export class Trader {
  constructor({ g, db, rate, myWallet, now = Date.now, log = () => {}, priorityFeeSol = 0.001, tipFeeSol = 0.001 }) {
    Object.assign(this, { g, db, rateFn: rate, myWalletFn: myWallet, now, log, priorityFeeSol, tipFeeSol });
    this.quotes = new Map();
  }

  async quote({ side, token, usd, pct, slippage = 30 }) {
    if (side !== 'buy' && side !== 'sell') throw Object.assign(new Error('side must be buy or sell'), { status: 400 });
    const [me, rate, info] = await Promise.all([this.myWalletFn(), this.rateFn(), this.g.tokenInfo(token)]);
    if (!me) throw new Error('Your GMGN wallet address is unavailable, so nothing can be quoted.');
    if (!rate) throw new Error('The SOL price is unavailable, so dollars cannot be converted. Try again in a moment.');
    const decimals = num(info?.decimals) ?? 6;
    const priceUsd = num(info?.price?.price);
    let params;
    if (side === 'buy') {
      if (!(usd > 0)) throw Object.assign(new Error('Enter how many dollars to spend.'), { status: 400 });
      const lamports = usdToLamports(usd, rate);
      params = { from_address: me, input_token: SOL_MINT, output_token: token, input_amount: lamports.toString() };
    } else {
      if (!(pct > 0 && pct <= 100)) throw Object.assign(new Error('Choose what share of your coins to sell.'), { status: 400 });
      const bal = await this.g.walletTokenBalance(me, token);
      const held = num(bal?.balance);
      if (!(held > 0)) throw new Error('You do not hold this coin in your GMGN wallet.');
      const raw = BigInt(Math.floor(held * 10 ** decimals));
      const amount = pct >= 100 ? raw : (raw * BigInt(Math.round(pct * 100))) / 10_000n;
      params = { from_address: me, input_token: token, output_token: SOL_MINT, input_amount: amount.toString() };
    }
    const q = await this.g.quote({ ...params, slippage });
    const id = randomUUID();
    const created = this.now();
    const tokens = (raw) => (num(raw) != null ? num(raw) / 10 ** decimals : null);
    const view = side === 'buy'
      ? {
          payUsd: usd,
          receiveTokens: tokens(q.output_amount),
          minReceiveTokens: tokens(q.min_output_amount),
          receiveUsd: priceUsd != null ? tokens(q.output_amount) * priceUsd : null,
          minReceiveUsd: priceUsd != null ? tokens(q.min_output_amount) * priceUsd : null,
        }
      : {
          sellPct: pct,
          sellTokens: tokens(params.input_amount),
          receiveUsd: lamportsToUsd(BigInt(q.output_amount ?? 0), rate),
          minReceiveUsd: lamportsToUsd(BigInt(q.min_output_amount ?? 0), rate),
        };
    this.quotes.set(id, { id, side, token, symbol: info?.symbol ?? '', params, slippage, quote: q, created, decimals, view, usd: usd ?? null, pct: pct ?? null });
    for (const [k, v] of this.quotes) if (created - v.created > 10 * 60_000) this.quotes.delete(k);
    return { quoteId: id, side, token, symbol: info?.symbol ?? '', slippagePct: slippage, expiresAt: created + QUOTE_TTL_MS, ...view, label: 'LIVE quote from GMGN' };
  }

  order(id) {
    const r = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    return r ? { ...r, detail: JSON.parse(r.detail) } : null;
  }

  orders(limit = 50) {
    return this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit).map((r) => ({ ...r, detail: JSON.parse(r.detail) }));
  }

  setState(id, state, patch = {}, extra = {}) {
    const cur = this.order(id);
    this.db.prepare('UPDATE orders SET state = ?, detail = ?, updated_at = ?, order_id = COALESCE(?, order_id), tx_hash = COALESCE(?, tx_hash) WHERE id = ?')
      .run(state, JSON.stringify({ ...cur.detail, ...patch }), this.now(), extra.orderId ?? null, extra.txHash ?? null, id);
  }

  async confirm(quoteId) {
    if (this.order(quoteId)) throw Object.assign(new Error('This quote was already used. Get a new price to trade again.'), { status: 409 });
    const q = this.quotes.get(quoteId);
    if (!q) throw Object.assign(new Error('That quote was not found. Get a new price.'), { status: 404 });
    if (this.now() - q.created > QUOTE_TTL_MS) throw Object.assign(new Error('That price expired (older than 30 seconds). Get a new price; meme coins move fast.'), { status: 409 });
    const now = this.now();
    // written down before sending: a crash after this line can never cause a second send
    this.db.prepare('INSERT INTO orders (id, side, token, symbol, state, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(quoteId, q.side, q.token, q.symbol, 'sending', JSON.stringify({ ...q.view, slippagePct: q.slippage, decimals: q.decimals, quotedAt: q.created }), now, now);
    this.quotes.delete(quoteId);
    const body = {
      ...q.params,
      slippage: q.slippage,
      min_output_amount: String(q.quote.min_output_amount),
      is_anti_mev: true,
      priority_fee: String(this.priorityFeeSol),
      tip_fee: String(this.tipFeeSol),
    };
    try {
      const res = await this.g.swap(body);
      this.setState(quoteId, 'submitted', {}, { orderId: res.order_id, txHash: res.hash });
    } catch (e) {
      if (e.answered) this.setState(quoteId, 'failed', { reason: `GMGN refused the order: ${e.message}` });
      else this.setState(quoteId, 'unknown', { reason: `Not sure GMGN received this order (${e.message}). It will NOT be sent again. Check your GMGN wallet.` });
    }
    return this.order(quoteId);
  }

  async reconcile() {
    const rate = await this.rateFn();
    for (const o of this.orders(100).filter((x) => x.state === 'submitted' && x.order_id)) {
      let r;
      try {
        r = await this.g.queryOrder(o.order_id);
      } catch (e) {
        this.log(`order check failed: ${e.message}`);
        continue;
      }
      if (r.status === 'confirmed' || r.status === 'successful') {
        const rep = r.report ?? {};
        const gas = num(rep.gas_usd) ?? 0;
        const dec = o.detail.decimals ?? 6;
        const patch = o.side === 'buy'
          ? { paidUsd: (lamportsToUsd(BigInt(rep.input_amount ?? 0), rate) ?? 0) + gas, gotTokens: num(rep.output_amount) != null ? num(rep.output_amount) / 10 ** dec : null, gasUsd: gas, filledAt: this.now() }
          : { soldTokens: num(rep.input_amount) != null ? num(rep.input_amount) / 10 ** dec : null, gotUsd: lamportsToUsd(BigInt(rep.output_amount ?? 0), rate), gasUsd: gas, filledAt: this.now() };
        this.setState(o.id, 'confirmed', patch, { txHash: r.hash });
      } else if (r.status === 'failed' || r.status === 'expired') {
        this.setState(o.id, 'failed', { reason: `GMGN reported the order ${r.status}${r.error_status ? `: ${r.error_status}` : ''}.` });
      } else if (this.now() - o.updated_at > 180_000) {
        this.setState(o.id, 'unknown', { reason: 'GMGN has not confirmed this order after 3 minutes. Check your GMGN wallet; it will NOT be sent again.' });
      }
    }
  }
}
