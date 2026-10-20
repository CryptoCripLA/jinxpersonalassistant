// The app's brain-free glue: every screen and every assistant answer goes through here.
import { kvGet, kvSet } from './store/db.js';
import { feeModel } from './money/fees.js';
import { rateLine } from './money/usd.js';
import { loadProfiles, deepProfile, runDiscovery } from './discovery/discover.js';
import { preferenceFit, DEFAULT_PREFS } from './analysis/profile.js';
import { rankWallets } from './analysis/rank.js';
import { suggestWallets } from './analysis/suggest.js';
import { simulateProfile, measuredPoolFeePct } from './analysis/simprofile.js';
import { recommendSettings } from './analysis/settings.js';
import { rankOpportunities, CATEGORY_LABELS } from './analysis/opportunities.js';
import { buildJinxWalletFile, writeJinxWalletFile } from './jinx/export.js';
import { CopyDesk } from './copy/desk.js';
import { answer as builtInAnswer } from './assistant/router.js';

export const DEFAULT_USER = {
  capitalUsd: null, // null = use your live GMGN balance
  sizeUsd: 25,
  delaySec: 5,
  impactPct: 0.5,
  networkSolPerTx: 0.002, // GMGN suggests 0.002-0.005 SOL when speed is not critical
  prefs: DEFAULT_PREFS,
};

const SUGGESTION_TTL_MS = 30 * 60 * 1000;

export class Service {
  constructor({ g, db, exportDir, env = process.env, log = console.log }) {
    Object.assign(this, { g, db, exportDir, env, log });
    this.discovery = { running: false, phase: 'idle', done: 0, total: 0, last: kvGet(db, 'discovery.last', null) };
    this.desk = new CopyDesk({
      g, db, env, log,
      rate: () => this.rate(),
      myWallet: async () => (await this.account()).address,
      balanceUsd: async () => (await this.account()).totalUsd,
    });
  }

  user() {
    const u = kvGet(this.db, 'user', {});
    return { ...DEFAULT_USER, ...u, prefs: { ...DEFAULT_PREFS, ...(u.prefs ?? {}) } };
  }

  setUser(patch) {
    const next = { ...this.user(), ...patch };
    kvSet(this.db, 'user', next);
    kvSet(this.db, 'suggestions', null);
    return next;
  }

  async rate() {
    return this.g.solUsd();
  }

  async account() {
    const [info, rate] = await Promise.all([this.g.userInfo(), this.rate()]);
    const sol = (info?.wallets ?? []).find((w) => w.chain === 'sol');
    const bal = (sym) => Number(sol?.balances?.find((b) => b.symbol === sym)?.balance ?? 0);
    const solAmt = bal('SOL');
    const usdc = bal('USDC');
    return {
      address: sol?.address ?? null,
      solUsd: rate ? solAmt * rate.usdPerSol : null,
      usdcUsd: usdc,
      totalUsd: rate ? solAmt * rate.usdPerSol + usdc : null,
      rate,
      rateLine: rateLine(rate),
    };
  }

  async capital() {
    const u = this.user();
    if (u.capitalUsd) return u.capitalUsd;
    const a = await this.account().catch(() => null);
    return a?.totalUsd ?? 100;
  }

  profiles() {
    return loadProfiles(this.db);
  }

  async fees() {
    const rate = await this.rate();
    const pool = measuredPoolFeePct(this.profiles());
    const m = feeModel({ rate, networkSolPerTx: this.user().networkSolPerTx, fallbackPoolFeePct: pool?.pct ?? null });
    m.poolFeeSource = pool ? `median venue fee GMGN recorded on ${pool.samples} real graduated-coin buys` : 'unavailable';
    return m;
  }

  async status() {
    const acct = await this.account().catch((e) => ({ error: e.message }));
    return {
      account: acct,
      plan: this.g.planName,
      oneSecondCandles: this.g.oneSecondRefused ? 'refused by GMGN for this key (using 30-second candles)' : 'not yet checked or allowed',
      profiles: this.profiles().length,
      discovery: this.discovery,
      user: this.user(),
      copy: this.desk.config(),
      gmgn: this.g.stats,
    };
  }

  async boards() {
    const u = this.user();
    return rankWallets(this.profiles(), { sizeUsd: u.sizeUsd, fees: await this.fees(), prefs: u.prefs });
  }

  async suggestions({ refresh = false } = {}) {
    const cached = kvGet(this.db, 'suggestions', null);
    if (!refresh && cached && Date.now() - cached.builtAt < SUGGESTION_TTL_MS) return cached;
    const u = this.user();
    const fees = await this.fees();
    const capitalUsd = await this.capital();
    const s = await suggestWallets({
      profiles: this.profiles(),
      nowSec: Math.floor(Date.now() / 1000),
      sizeUsd: u.sizeUsd,
      capitalUsd,
      fees,
      prefs: u.prefs,
      simulate: (p) => simulateProfile(this.g, p, { sizeUsd: u.sizeUsd, capitalUsd, delaySec: u.delaySec, impactPct: u.impactPct, fees }),
    });
    const out = { ...s, builtAt: Date.now(), rateLine: rateLine(fees.rate), delaySec: u.delaySec };
    kvSet(this.db, 'suggestions', out);
    return out;
  }

  async profile(wallet, { live = false } = {}) {
    let p = live ? null : this.profiles().find((x) => x.wallet === wallet);
    if (!p) {
      p = await deepProfile(this.g, wallet, { log: this.log });
      this.db.prepare(`INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, 'lookup')
        ON CONFLICT(wallet) DO UPDATE SET profile = excluded.profile, built_at = excluded.built_at`).run(wallet, JSON.stringify(p), Date.now());
    }
    return p;
  }

  async walletDetail(wallet) {
    const p = await this.profile(wallet);
    const u = this.user();
    const rate = await this.rate();
    const fees = await this.fees();
    const capitalUsd = await this.capital();
    const { positions, ...rest } = p;
    return {
      profile: rest,
      recent: positions.slice(-15).reverse().map((x) => ({ symbol: x.symbol, stage: x.entryStage, openTs: x.openTs, holdSec: x.holdSec, buyUsd: x.buyUsd, realizedUsd: x.realizedUsd, status: x.status })),
      fit: preferenceFit(p, u.prefs),
      settings: recommendSettings(p, { capitalUsd, rate, fees, sizeUsd: u.sizeUsd }),
    };
  }

  async simulate(wallet, opts = {}) {
    const p = await this.profile(wallet);
    const u = this.user();
    const fees = await this.fees();
    if (opts.networkSolPerTx != null) fees.networkSolPerTx = opts.networkSolPerTx;
    const r = await simulateProfile(this.g, p, {
      sizeUsd: opts.sizeUsd ?? u.sizeUsd,
      capitalUsd: opts.capitalUsd ?? (await this.capital()),
      delaySec: opts.delaySec ?? u.delaySec,
      impactPct: opts.impactPct ?? u.impactPct,
      days: opts.days ?? 14,
      fees,
    });
    r.rateLine = rateLine(fees.rate);
    r.poolFeeSource = fees.poolFeeSource;
    return r;
  }

  async opportunities(category = 'graduated') {
    const u = this.user();
    const fees = await this.fees();
    const now = Math.floor(Date.now() / 1000);
    let items = [];
    if (category === 'new') items = (await this.g.trenches(['new_creation'], { max_rug_ratio: 0.3 })).new_creation ?? [];
    else if (category === 'near') {
      const d = await this.g.trenches(['near_completion'], { max_rug_ratio: 0.3 });
      items = d.near_completion ?? d.pump ?? [];
    } else if (category === 'graduated') items = (await this.g.trenches(['completed'], { max_rug_ratio: 0.3 })).completed ?? [];
    else if (category === 'trending') items = (await this.g.trending('1h', { order_by: 'volume', limit: 50 })).rank ?? [];
    else if (category === 'smart') {
      const sig = await this.g.signals([{ signal_type: [12] }, { signal_type: [20] }]);
      const addrs = [...new Set((Array.isArray(sig) ? sig : []).map((x) => x.token_address))].slice(0, 15);
      for (const a of addrs) {
        const info = await this.g.tokenInfo(a).catch(() => null);
        if (info) items.push({ ...info, ...info.stat, ...(info.wallet_tags_stat ?? {}), smart_degen_count: info.wallet_tags_stat?.smart_wallets, renowned_count: info.wallet_tags_stat?.renowned_wallets, creator_token_status: info.dev?.creator_token_status === 'sell' ? 'creator_close' : 'creator_hold', created_timestamp: info.creation_timestamp, usd_market_cap: Number(info.price?.price) * Number(info.total_supply) });
      }
    }
    // personal signal: which of your suggested or best-fit wallets bought these coins
    const mine = new Set([...(kvGet(this.db, 'suggestions', null)?.picks ?? []).map((p) => p.wallet), ...this.desk.watches().map((w) => w.wallet)]);
    const walletsByToken = new Map();
    for (const p of this.profiles()) {
      if (!mine.has(p.wallet)) continue;
      for (const x of p.positions.filter((x) => x.openTs > now - 86400)) {
        walletsByToken.set(x.token, [...(walletsByToken.get(x.token) ?? []), p.wallet]);
      }
    }
    const ranked = rankOpportunities(items, { now, sizeUsd: u.sizeUsd, fees, walletsByToken });
    return { category, label: CATEGORY_LABELS[category], items: ranked.slice(0, 15), rateLine: rateLine(fees.rate) };
  }

  startDiscovery(maxDeep = 80) {
    if (this.discovery.running) return this.discovery;
    this.discovery = { running: true, phase: 'starting', done: 0, total: 0, last: this.discovery.last };
    runDiscovery(this.g, this.db, { maxDeep, log: this.log, onProgress: (p) => Object.assign(this.discovery, p) })
      .then((r) => {
        this.discovery = { running: false, phase: 'done', done: r.profiled, total: r.profiled, last: { ...r, at: Date.now() } };
        kvSet(this.db, 'discovery.last', this.discovery.last);
        kvSet(this.db, 'suggestions', null);
      })
      .catch((e) => {
        this.discovery = { ...this.discovery, running: false, phase: `failed: ${e.message}` };
      });
    return this.discovery;
  }

  async ask(question, ctx = {}) {
    const q = String(question ?? '').slice(0, 600);
    const built = await builtInAnswer(q, ctx, this).catch((e) => ({ text: `I hit a problem getting that data: ${e.message}`, evidence: [], actions: [], by: 'built-in' }));
    if (built) return built;
    if (this.claude) {
      const r = await this.claude.ask(q, ctx);
      return { ...r, evidence: [], actions: [] };
    }
    return {
      text: 'I can answer these right now: the best trader for graduated coins, early momentum or sniping; who makes the most while trading only a few coins a day; what you would have made copying a wallet with a dollar amount; which coin looks strongest right now; what settings to use; why I picked one wallet over another; and what a trading word means. Free-form questions need the Claude assistant switched on.',
      evidence: [], actions: [], by: 'built-in',
    };
  }

  copyState() {
    return { config: this.desk.config(), watches: this.desk.watches().map(({ seen_tx, ...w }) => w), intents: this.desk.intents(60), positions: this.desk.positions(), autoSwitch: this.env.GMGN_ALLOW_AUTOMATED_TRADES === '1' };
  }

  async copyWallet(wallet) {
    const d = await this.walletDetail(wallet);
    this.desk.watch(wallet, d.settings.desk);
    return { wallet, settings: d.settings.desk, items: d.settings.items };
  }

  async exportJinx() {
    const s = kvGet(this.db, 'suggestions', null);
    const doc = buildJinxWalletFile({ picks: s?.picks ?? [], boards: await this.boards() });
    const path = writeJinxWalletFile(this.exportDir, doc);
    return { path, count: doc.wallets.length, doc };
  }
}
