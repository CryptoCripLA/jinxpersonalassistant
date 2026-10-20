// Copy desk: follows wallets you chose and turns their trades into YOUR orders through
// GMGN's swap API. GMGN's API has no copy-task endpoint (checked against gmgn-cli 1.6.7's
// full route list), so this is the wallet-following engine.
//
// Safety rules, enforced here in code (never by an AI):
//   * Modes: OFF (records what it would copy, no new buys), CONFIRM (each buy waits for
//     your tap and expires if you don't), AUTO (unattended buys only when the operator also
//     sets GMGN_ALLOW_AUTOMATED_TRADES=1, the same switch GMGN's own CLI requires).
//   * Limits: max dollars per trade, per day, and open copies; money check before buying.
//   * Every order gets a GMGN quote first and is sent with that quote's minimum output.
//   * One wallet trade -> at most one order (unique on wallet tx + side).
//   * The intent is saved before sending. If GMGN never answers, the order is marked
//     "unknown" and is NOT re-sent. Fills count only after GMGN reports them confirmed.
//   * 3 failed orders in a row switch the desk OFF.
//   * Sells of copies the desk opened follow the wallet in every mode, including OFF:
//     getting out is never blocked.
import { kvGet, kvSet } from '../store/db.js';
import { usd, usdToLamports, lamportsToUsd } from '../money/usd.js';
import { usdShort } from '../analysis/settings.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
const ACTIVE_SPEND = ['sending', 'submitted', 'confirmed', 'unknown'];

export const DEFAULT_CONFIG = {
  mode: 'off',
  limits: { perTradeUsd: 25, maxDailyUsd: 100, maxOpen: 3 },
  confirmTimeoutSec: 45,
  maxLagSec: 60,
  pollSec: 3,
  failures: 0,
  pausedReason: null,
};

export class CopyDesk {
  constructor({ g, db, now = Date.now, rate, myWallet, balanceUsd, env = process.env, log = () => {} }) {
    Object.assign(this, { g, db, now, rateFn: rate, myWalletFn: myWallet, balanceFn: balanceUsd, env, log });
    this.busy = false;
  }

  config() {
    const saved = kvGet(this.db, 'copy.config', {});
    return { ...DEFAULT_CONFIG, ...saved, limits: { ...DEFAULT_CONFIG.limits, ...(saved.limits ?? {}) } };
  }

  setConfig(patch) {
    const c = this.config();
    const next = { ...c, ...patch, limits: { ...c.limits, ...(patch.limits ?? {}) } };
    if (patch.mode && patch.mode !== 'off' && c.mode === 'off') {
      next.failures = 0;
      next.pausedReason = null;
    }
    kvSet(this.db, 'copy.config', next);
    return next;
  }

  watch(wallet, settings) {
    this.db.prepare(`INSERT INTO copy_watch (wallet, settings, enabled, created_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(wallet) DO UPDATE SET settings = excluded.settings, enabled = 1`).run(wallet, JSON.stringify(settings), this.now());
  }

  unwatch(wallet) {
    this.db.prepare('UPDATE copy_watch SET enabled = 0 WHERE wallet = ?').run(wallet);
  }

  watches() {
    return this.db.prepare('SELECT * FROM copy_watch WHERE enabled = 1').all().map((w) => ({ ...w, settings: JSON.parse(w.settings), seen_tx: JSON.parse(w.seen_tx) }));
  }

  intents(limit = 200) {
    return this.db.prepare('SELECT * FROM copy_intents ORDER BY created_at DESC LIMIT ?').all(limit).map((i) => ({ ...i, detail: JSON.parse(i.detail) }));
  }

  positions() {
    return this.db.prepare("SELECT * FROM copy_positions WHERE status = 'open' ORDER BY opened_at DESC").all();
  }

  intent(id) {
    const i = this.db.prepare('SELECT * FROM copy_intents WHERE id = ?').get(id);
    return i ? { ...i, detail: JSON.parse(i.detail) } : null;
  }

  setState(id, state, detailPatch = {}, extra = {}) {
    const cur = this.intent(id);
    const detail = { ...cur.detail, ...detailPatch };
    this.db.prepare('UPDATE copy_intents SET state = ?, detail = ?, updated_at = ?, order_id = COALESCE(?, order_id), tx_hash = COALESCE(?, tx_hash) WHERE id = ?')
      .run(state, JSON.stringify(detail), this.now(), extra.orderId ?? null, extra.txHash ?? null, id);
  }

  createIntent(w, r, side, state, detail) {
    const id = `${r.tx_hash}:${side}`;
    const res = this.db.prepare(`INSERT OR IGNORE INTO copy_intents (id, wallet, target_tx, side, token, symbol, state, detail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, w.wallet, r.tx_hash, side, r.token?.address, r.token?.symbol ?? '', state, JSON.stringify(detail), this.now(), this.now());
    return res.changes ? id : null;
  }

  spentTodayUsd() {
    const dayStart = Math.floor(this.now() / 86_400_000) * 86_400_000;
    return this.db.prepare(`SELECT detail FROM copy_intents WHERE side = 'buy' AND created_at >= ? AND state IN (${ACTIVE_SPEND.map(() => '?').join(',')})`)
      .all(dayStart, ...ACTIVE_SPEND).reduce((a, r) => a + (JSON.parse(r.detail).sizeUsd ?? 0), 0);
  }

  openFor(wallet, token) {
    return this.db.prepare("SELECT * FROM copy_positions WHERE wallet = ? AND token = ? AND status = 'open'").get(wallet, token);
  }

  // ---------- main loop
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.expireApprovals();
      for (const w of this.watches()) {
        let d;
        try {
          d = await this.g.walletActivity(w.wallet, { limit: 20, fresh: true });
        } catch (e) {
          this.log(`copy desk: could not read ${w.wallet}: ${e.message}`);
          continue;
        }
        const rows = (d?.activities ?? []).filter((r) => r.event_type === 'buy' || r.event_type === 'sell').sort((a, b) => a.timestamp - b.timestamp);
        const seen = new Set(w.seen_tx);
        let last = w.last_seen_ts;
        if (last === 0) {
          // first look: remember history, copy nothing old
          for (const r of rows) seen.add(r.tx_hash);
          last = Math.max(Math.floor(this.now() / 1000), ...rows.map((r) => r.timestamp));
        } else {
          for (const r of rows) {
            if (seen.has(r.tx_hash) || r.timestamp < last - 120) continue;
            seen.add(r.tx_hash);
            last = Math.max(last, r.timestamp);
            if (r.event_type === 'buy') await this.onBuy(w, r);
            else await this.onSell(w, r);
          }
        }
        this.db.prepare('UPDATE copy_watch SET last_seen_ts = ?, seen_tx = ? WHERE wallet = ?').run(last, JSON.stringify([...seen].slice(-300)), w.wallet);
      }
    } finally {
      this.busy = false;
    }
  }

  expireApprovals() {
    for (const i of this.intents(500).filter((x) => x.state === 'awaiting_approval')) {
      if (i.detail.expiresAt && this.now() > i.detail.expiresAt) this.setState(i.id, 'expired', { reason: 'You did not approve in time, so it was not copied (late copies buy at worse prices).' });
    }
  }

  buySkipReason(w, r) {
    const s = w.settings;
    const cfg = this.config();
    const spent = Number(r.cost_usd);
    const mcap = Number(r.price_usd) * Number(r.token?.total_supply);
    const lag = this.now() / 1000 - r.timestamp;
    if (lag > cfg.maxLagSec) return `Seen ${Math.round(lag)} seconds after the wallet bought, too late to copy safely.`;
    if (s.minCopyUsd && spent < s.minCopyUsd) return `The wallet only spent ${usd(spent)} (your minimum is ${usd(s.minCopyUsd)}).`;
    if (s.maxCopyUsd && spent > s.maxCopyUsd) return `The wallet spent ${usd(spent)}, over your maximum of ${usd(s.maxCopyUsd)}.`;
    if (Number.isFinite(mcap) && s.minMcapUsd && mcap < s.minMcapUsd) return `Coin market cap ${usdShort(mcap)} is below your range (${usdShort(s.minMcapUsd)} and up).`;
    if (Number.isFinite(mcap) && s.maxMcapUsd && mcap > s.maxMcapUsd) return `Coin market cap ${usdShort(mcap)} is above your range (up to ${usdShort(s.maxMcapUsd)}).`;
    if (s.platforms?.length && r.launchpad_platform && !s.platforms.includes(r.launchpad_platform)) return `Launched on ${r.launchpad_platform}, which is not in your platform list.`;
    if (this.openFor(w.wallet, r.token?.address)) return 'You already hold this coin from this wallet (position increase times is 0).';
    return null;
  }

  async limitReason(sizeUsd) {
    const cfg = this.config();
    if (sizeUsd > cfg.limits.perTradeUsd) return `${usd(sizeUsd)} is over your per-trade limit of ${usd(cfg.limits.perTradeUsd)}.`;
    if (this.positions().length >= cfg.limits.maxOpen) return `You already have ${cfg.limits.maxOpen} copies open (your limit).`;
    const spent = this.spentTodayUsd();
    if (spent + sizeUsd > cfg.limits.maxDailyUsd) return `Copying would pass your daily limit (${usd(spent)} spent of ${usd(cfg.limits.maxDailyUsd)}).`;
    const bal = await this.balanceFn();
    if (bal != null && bal < sizeUsd + 1) return `Not enough money: ${usd(bal)} available, need ${usd(sizeUsd)} plus fees.`;
    return null;
  }

  async onBuy(w, r) {
    const cfg = this.config();
    const sizeUsd = Math.min(w.settings.sizeUsd, cfg.limits.perTradeUsd);
    const base = { sizeUsd, walletSpentUsd: Number(r.cost_usd), walletPriceUsd: Number(r.price_usd), seenAt: this.now(), walletTs: r.timestamp };
    const skip = this.buySkipReason(w, r);
    if (skip) return this.createIntent(w, r, 'buy', 'skipped', { ...base, reason: skip });
    if (cfg.mode === 'off') return this.createIntent(w, r, 'buy', 'observed', { ...base, reason: 'Copy desk is OFF. This is what it would have copied.' });
    const lim = await this.limitReason(sizeUsd);
    if (lim) return this.createIntent(w, r, 'buy', 'skipped', { ...base, reason: lim });
    const expiresAt = this.now() + cfg.confirmTimeoutSec * 1000;
    if (cfg.mode === 'auto' && this.env.GMGN_ALLOW_AUTOMATED_TRADES === '1') {
      const id = this.createIntent(w, r, 'buy', 'approved', { ...base, reason: 'AUTO mode' });
      if (id) await this.execute(id);
      return id;
    }
    const reason = cfg.mode === 'auto'
      ? 'AUTO is on, but the operator switch GMGN_ALLOW_AUTOMATED_TRADES=1 is not set, so this waits for your tap.'
      : 'Waiting for your tap.';
    return this.createIntent(w, r, 'buy', 'awaiting_approval', { ...base, reason, expiresAt });
  }

  async onSell(w, r) {
    if (w.settings.followSells === false) return null;
    const pos = this.openFor(w.wallet, r.token?.address);
    if (!pos) return null;
    let fraction = null;
    let how = '';
    try {
      const bal = await this.g.walletTokenBalance(w.wallet, r.token.address);
      const after = Number(bal?.balance);
      const sold = Number(r.token_amount);
      if (Number.isFinite(after) && sold > 0) {
        fraction = sold / (sold + after);
        how = `The wallet sold ${Math.round(fraction * 100)}% of its coins.`;
      }
    } catch (e) {
      this.log(`copy desk: balance read failed: ${e.message}`);
    }
    if (fraction == null) {
      fraction = 1;
      how = "Could not read the wallet's remaining coins, so the whole copy is sold (getting out is never blocked).";
    }
    const raw = BigInt(pos.tokens_raw);
    const sellRaw = fraction >= 0.98 ? raw : (raw * BigInt(Math.round(fraction * 1e6))) / 1_000_000n;
    if (sellRaw <= 0n) return null;
    const id = this.createIntent(w, r, 'sell', 'approved', { fraction, sellRaw: sellRaw.toString(), reason: how, positionOpenedAt: pos.opened_at });
    if (id) await this.execute(id);
    return id;
  }

  async approve(id) {
    const i = this.intent(id);
    if (!i || i.state !== 'awaiting_approval') return i?.state ?? 'missing';
    if (i.detail.expiresAt && this.now() > i.detail.expiresAt) {
      this.setState(id, 'expired', { reason: 'Approval came too late.' });
      return 'expired';
    }
    const lim = await this.limitReason(i.detail.sizeUsd);
    if (lim) {
      this.setState(id, 'skipped', { reason: lim });
      return 'skipped';
    }
    this.setState(id, 'approved', { approvedAt: this.now() });
    await this.execute(id);
    return this.intent(id).state;
  }

  reject(id) {
    const i = this.intent(id);
    if (i?.state === 'awaiting_approval') this.setState(id, 'rejected', { reason: 'You said no.' });
  }

  async execute(id) {
    const i = this.intent(id);
    if (!i || i.state !== 'approved') return;
    const w = this.watches().find((x) => x.wallet === i.wallet);
    const s = w?.settings ?? {};
    const me = await this.myWalletFn();
    const rate = await this.rateFn();
    let params;
    if (i.side === 'buy') {
      const lamports = usdToLamports(i.detail.sizeUsd, rate);
      if (lamports == null || !me) {
        this.setState(id, 'failed', { reason: 'SOL price or your wallet address is unavailable, so nothing was sent.' });
        return;
      }
      params = { from_address: me, input_token: SOL_MINT, output_token: i.token, input_amount: lamports.toString() };
    } else {
      params = { from_address: me, input_token: i.token, output_token: SOL_MINT, input_amount: i.detail.sellRaw };
    }
    const slippage = s.slippage ?? 30;
    this.setState(id, 'sending', { sendStartedAt: this.now() });
    let quote;
    try {
      quote = await this.g.quote({ ...params, slippage });
    } catch (e) {
      this.setState(id, 'failed', { reason: `GMGN could not price this trade, so nothing was sent: ${e.message}` });
      return;
    }
    const body = {
      ...params,
      slippage,
      min_output_amount: String(quote.min_output_amount),
      is_anti_mev: s.antiMev !== false,
      priority_fee: String(s.priorityFeeSol ?? 0.001),
      tip_fee: String(s.tipFeeSol ?? 0.001),
    };
    // GMGN's own take-profit / stop-loss orders ride on the buy when the settings sheet chose them
    // (price_scale = gain % for profit_stop, drop % for loss_stop, per GMGN's swap docs).
    if (i.side === 'buy' && s.takeProfitPct > 0 && s.stopLossPct > 0) {
      body.condition_orders = [
        { order_type: 'profit_stop', side: 'sell', price_scale: String(s.takeProfitPct), sell_ratio: '100' },
        { order_type: 'loss_stop', side: 'sell', price_scale: String(s.stopLossPct), sell_ratio: '100' },
      ];
    }
    try {
      const res = await this.g.swap(body);
      this.setState(id, 'submitted', { quoteOut: quote.output_amount, minOut: quote.min_output_amount }, { orderId: res.order_id, txHash: res.hash });
    } catch (e) {
      if (e.answered) {
        this.setState(id, 'failed', { reason: `GMGN refused the order: ${e.message}` });
        this.recordFailure();
      } else {
        this.setState(id, 'unknown', { reason: `Not sure GMGN received this order (${e.message}). It will NOT be sent again. Please check GMGN.` });
      }
    }
  }

  recordFailure() {
    const c = this.config();
    const failures = (c.failures ?? 0) + 1;
    if (failures >= 3) this.setConfig({ mode: 'off', failures, pausedReason: '3 orders failed in a row, so the copy desk switched itself OFF.' });
    else this.setConfig({ failures });
  }

  async reconcile() {
    const rate = await this.rateFn();
    for (const i of this.intents(500).filter((x) => x.state === 'submitted' && x.order_id)) {
      let o;
      try {
        o = await this.g.queryOrder(i.order_id);
      } catch (e) {
        this.log(`copy desk: order check failed: ${e.message}`);
        continue;
      }
      if (o.status === 'confirmed' || o.status === 'successful') {
        this.onFilled(i, o, rate);
        this.setState(i.id, 'confirmed', { filledAt: this.now(), gasUsd: Number(o.report?.gas_usd ?? 0) }, { txHash: o.hash });
        this.setConfig({ failures: 0 });
      } else if (o.status === 'failed' || o.status === 'expired') {
        this.setState(i.id, 'failed', { reason: `GMGN reported the order ${o.status}${o.error_status ? `: ${o.error_status}` : ''}.` });
        this.recordFailure();
      } else if (this.now() - i.updated_at > 180_000) {
        this.setState(i.id, 'unknown', { reason: 'GMGN has not confirmed this order after 3 minutes. Please check GMGN; it will not be re-sent.' });
      }
    }
  }

  onFilled(i, o, rate) {
    const rep = o.report ?? {};
    const gas = Number(rep.gas_usd ?? 0);
    if (i.side === 'buy') {
      const cost = (lamportsToUsd(BigInt(rep.input_amount ?? 0), rate) ?? i.detail.sizeUsd) + gas;
      this.db.prepare(`INSERT OR IGNORE INTO copy_positions (token, wallet, symbol, tokens_raw, cost_usd, opened_at, status, fees_usd)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(i.token, i.wallet, i.symbol, String(rep.output_amount ?? '0'), cost, this.now(), gas);
      return;
    }
    const pos = this.openFor(i.wallet, i.token);
    if (!pos) return;
    const sold = BigInt(rep.input_amount ?? i.detail.sellRaw);
    const held = BigInt(pos.tokens_raw);
    const left = held > sold ? held - sold : 0n;
    const proceeds = lamportsToUsd(BigInt(rep.output_amount ?? 0), rate) ?? 0;
    const costShare = pos.cost_usd * (Number(sold) / Number(held));
    this.db.prepare(`UPDATE copy_positions SET tokens_raw = ?, cost_usd = ?, realized_usd = realized_usd + ?, fees_usd = fees_usd + ?, status = ?
      WHERE token = ? AND wallet = ? AND opened_at = ?`)
      .run(left.toString(), pos.cost_usd - costShare, proceeds - costShare - gas, gas, left === 0n ? 'closed' : 'open', pos.token, pos.wallet, pos.opened_at);
  }
}
