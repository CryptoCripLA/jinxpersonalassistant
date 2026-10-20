// The app's brain-free glue: every screen and every assistant answer goes through here.
import { kvGet, kvSet } from './store/db.js';
import { feeModel } from './money/fees.js';
import { rateLine } from './money/usd.js';
import { loadProfiles, deepProfile, runDiscovery, prefilter } from './discovery/discover.js';
import { runExplosiveAnalysis, loadExplosive, analyzeWallet, saveExplosive } from './intel/wallets.js';
import { runStudy, pickStudyTokens, loadExamples, reachedFromBase } from './intel/study.js';
import { studySummary } from './analysis/history.js';
import { scenario, SCENARIO_MULTIPLES } from './analysis/scenario.js';
import { coinDetail } from './intel/coin.js';
import { Pulse } from './intel/pulse.js';
import { PumpFun } from './pumpfun/client.js';
import { PumpPortalStream } from './pumpfun/stream.js';
import { Trader } from './trade/manual.js';
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
    this.pf = new PumpFun({ log });
    this.stream = new PumpPortalStream({ log });
    this.pulse = new Pulse({ g, log, explosiveBuys: (mint) => this.stream.walletBuys(mint, Math.floor(Date.now() / 1000)) });
    this.trader = new Trader({ g, db, log, rate: () => this.rate(), myWallet: async () => (await this.account()).address });
    this.coinCache = new Map();
    this.boardCache = null;
    this.jobs = { running: null, last: kvGet(db, 'jobs.last', null), progress: null };
    this.grok = null;
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
    const ai = this.grok ?? this.claude;
    if (ai) {
      const r = await ai.ask(q, ctx).catch((e) => ({ text: `The AI assistant is unavailable right now (${e.message}). Built-in questions still work.`, by: 'error' }));
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

  // ---- terminal data
  explosiveBoard() {
    if (!this.boardCache || Date.now() - this.boardCache.at > 60_000) this.boardCache = { at: Date.now(), rows: loadExplosive(this.db, { maxCoinsPerDay: this.user().prefs.maxCoinsPerDay }) };
    return this.boardCache.rows;
  }

  explosiveMap() {
    return new Map(this.explosiveBoard().filter((r) => r.isExplosive).map((r) => [r.wallet, r]));
  }

  walletExplosive(wallet) {
    const r = this.db.prepare('SELECT data FROM explosive_profiles WHERE wallet = ?').get(wallet);
    return r ? JSON.parse(r.data) : null;
  }

  async measureWallet(wallet) {
    const p = await this.profile(wallet);
    const u = this.user();
    const row = await analyzeWallet(this.g, p, { sizeUsd: u.sizeUsd, delaySec: u.delaySec, impactPct: u.impactPct, fees: await this.fees(), log: this.log });
    saveExplosive(this.db, row);
    this.boardCache = null;
    return row;
  }

  pulseColumns() {
    return this.pulse.columns();
  }

  async coin(address, { fresh = false } = {}) {
    const hit = this.coinCache.get(address);
    if (!fresh && hit && Date.now() - hit.at < 8_000) return hit.value;
    const value = coinDetail({
      g: this.g, pf: this.pf, token: address, explosive: this.explosiveMap(), fees: await this.fees(), sizeUsd: this.user().sizeUsd,
      tapeRates: this.pulse.tape.rates(address, Math.floor(Date.now() / 1000)), listItem: this.pulse.raw(address), log: this.log,
    });
    this.coinCache.set(address, { at: Date.now(), value });
    if (this.coinCache.size > 200) this.coinCache.delete(this.coinCache.keys().next().value);
    try {
      return await value;
    } catch (e) {
      this.coinCache.delete(address);
      throw e;
    }
  }

  async scenarioFor(c, sizeUsd, multiple = null) {
    const multiples = multiple != null && !SCENARIO_MULTIPLES.includes(multiple) ? [...SCENARIO_MULTIPLES, multiple].sort((a, b) => a - b) : SCENARIO_MULTIPLES;
    return scenario({ sizeUsd: sizeUsd ?? this.user().sizeUsd, marketCapUsd: c.marketCapUsd, fees: await this.fees(), venue: c.graduatedTs || (c.progress ?? 0) >= 1 ? 'pool' : 'curve', multiples });
  }

  async candles(address, res = '1m') {
    const now = Math.floor(Date.now() / 1000);
    const span = { '1m': 6 * 3600, '5m': 24 * 3600, '15m': 3 * 86400, '1h': 14 * 86400 }[res] ?? 6 * 3600;
    if (res === '1m' && /pump$/.test(address)) {
      const c = await this.coin(address).catch(() => null);
      const k = await this.pf.candles(address, (c?.creationTs ?? now - span) * 1000, '1m');
      if (k.length) return { resolution: '1m', resSec: 60, candles: k, source: 'pump.fun' };
    }
    const k = await this.g.klineRange(address, res, now - span, now);
    return { ...k, source: 'GMGN' };
  }

  examples() {
    return loadExamples(this.db);
  }

  studyStats() {
    const ex = this.examples();
    return { examples: ex.length, reachedFromBase: (mcap, m) => reachedFromBase(ex, mcap, m) };
  }

  historySummary() {
    const ex = this.examples();
    return {
      examples: ex.length,
      launches: ex.filter((e) => e.kind === 'launch').length,
      breakouts: ex.filter((e) => e.kind === 'breakout').length,
      lastRun: kvGet(this.db, 'study.last', null),
      signals: studySummary(ex),
      top: ex.slice(0, 8).map((e) => ({ symbol: e.symbol, kind: e.kind, multiple: e.move.multiple, baseMarketCapUsd: e.baseMcapUsd, peakMarketCapUsd: e.peakMcapUsd, minutesToPeak: Math.round(e.move.durationSec / 60), followableMultiple: e.followable?.multiple ?? null, followableFromMarketCapUsd: e.followable?.baseMcapUsd ?? null, firstUsefulSignal: e.firstUsefulSignal?.label ?? null, earlyWallets: e.earlyWallets.length })),
    };
  }

  async portfolio() {
    const acct = await this.account();
    if (!acct.address) return { account: acct, holdings: [], orders: this.trader.orders(30) };
    const h = await this.g.walletHoldings(acct.address, { limit: 50 }).catch((e) => ({ error: e.message }));
    const num = (v) => (v == null || v === '' ? null : Number(v));
    const holdings = (h.list ?? []).map((x) => ({
      token: x.token?.token_address, symbol: x.token?.symbol ?? '', logo: x.token?.logo ?? '',
      valueUsd: num(x.usd_value), costUsd: num(x.accu_cost), boughtUsd: num(x.history_bought_cost), soldUsd: num(x.history_sold_income),
      realizedUsd: num(x.realized_profit), unrealizedUsd: num(x.unrealized_profit), totalUsd: num(x.total_profit), totalPct: num(x.total_profit_pnl),
      buys: x.history_total_buys, sells: x.history_total_sells, since: x.start_holding_at, lastActive: x.last_active_timestamp,
      open: num(x.balance) > 0 && num(x.usd_value) > 0.01,
    }));
    const sum = (k) => holdings.reduce((a, x) => a + (x[k] ?? 0), 0);
    return {
      label: 'LIVE', account: acct, holdings, error: h.error ?? null,
      totals: { valueUsd: sum('valueUsd'), realizedUsd: sum('realizedUsd'), unrealizedUsd: sum('unrealizedUsd') },
      orders: this.trader.orders(30), copies: this.desk.positions(),
    };
  }

  // Research jobs run inside the server so every GMGN call shares one rate limiter.
  startJob(kind) {
    if (this.jobs.running) return this.jobs;
    const onProgress = (p) => (this.jobs.progress = p);
    const run = {
      study: () => this.runStudy({ onProgress }),
      wallets: () => this.runWalletMeasure({ onProgress }),
      discover: () => this.discoverEarlyWallets({ onProgress }),
      // the full loop: find past runners, harvest their early wallets, measure everyone
      all: async () => ({ study: await this.runStudy({ onProgress }), discover: await this.discoverEarlyWallets({ onProgress }), wallets: await this.runWalletMeasure({ onProgress }) }),
    }[kind];
    if (!run) throw Object.assign(new Error('job must be study, wallets, discover or all'), { status: 400 });
    this.jobs = { ...this.jobs, running: kind, progress: { phase: 'starting', done: 0, total: 0 } };
    run()
      .then((r) => { this.jobs.last = { kind, result: r, at: Date.now() }; })
      .catch((e) => { this.jobs.last = { kind, error: e.message, at: Date.now() }; })
      .finally(() => {
        this.jobs.running = null;
        this.boardCache = null;
        kvSet(this.db, 'jobs.last', this.jobs.last);
      });
    return this.jobs;
  }

  // ---- explosive intelligence jobs
  explosiveSet() {
    return new Set(loadExplosive(this.db).filter((r) => r.isExplosive).map((r) => r.wallet));
  }

  async runStudy({ limit = 60, onProgress = () => {} } = {}) {
    const tokens = await pickStudyTokens(this.g, this.db, { limit });
    return runStudy(this.g, this.db, { tokens, explosive: this.explosiveSet(), onProgress, log: this.log });
  }

  async runWalletMeasure({ wallets = null, skipFreshMs = 6 * 3600_000, onProgress = () => {} } = {}) {
    const u = this.user();
    return runExplosiveAnalysis(this.g, this.db, { wallets, skipFreshMs: wallets ? 0 : skipFreshMs, sizeUsd: u.sizeUsd, delaySec: u.delaySec, impactPct: u.impactPct, fees: await this.fees(), onProgress, log: this.log });
  }

  // Wallets the history study caught getting in before a breakout: prefilter, profile, measure.
  async discoverEarlyWallets({ maxDeep = 40, onProgress = () => {} } = {}) {
    const have = new Set(this.profiles().map((p) => p.wallet));
    const cands = this.db.prepare("SELECT wallet, sources FROM candidates WHERE sources LIKE '%early on %'").all()
      .map((r) => ({ wallet: r.wallet, ...JSON.parse(r.sources) }))
      .filter((c) => !have.has(c.wallet))
      .sort((a, b) => b.sources.length - a.sources.length);
    onProgress({ phase: 'prefilter', done: 0, total: cands.length });
    const profits = await this.g.walletProfits(cands.map((c) => c.wallet), '30d');
    const { keep } = prefilter(profits, { days: 30, maxBuysPerDay: 40 });
    const bySrc = new Map(cands.map((c) => [c.wallet, c]));
    const deep = keep.sort((a, b) => (bySrc.get(b.wallet)?.sources.length ?? 0) - (bySrc.get(a.wallet)?.sources.length ?? 0)).slice(0, maxDeep);
    const save = this.db.prepare(`INSERT INTO wallet_profiles (wallet, profile, built_at, source) VALUES (?, ?, ?, 'early-study')
      ON CONFLICT(wallet) DO UPDATE SET profile = excluded.profile, built_at = excluded.built_at`);
    let done = 0;
    for (const k of deep) {
      onProgress({ phase: 'reading early wallets', done, total: deep.length });
      try {
        const p = await deepProfile(this.g, k.wallet, { log: this.log });
        p.discovery = { sources: bySrc.get(k.wallet)?.sources ?? [], tags: bySrc.get(k.wallet)?.tags ?? [], realizedUsd30d: k.realizedUsd30d, buys30d: k.buys30d };
        save.run(k.wallet, JSON.stringify(p), Date.now());
      } catch (e) {
        this.log(`could not profile ${k.wallet}: ${e.message}`);
        if (e.code === 'RATE') break;
      }
      done += 1;
    }
    const measured = await this.runWalletMeasure({ wallets: deep.map((k) => k.wallet), onProgress });
    return { candidates: cands.length, kept: keep.length, profiled: done, measured };
  }

  async exportJinx() {
    const s = kvGet(this.db, 'suggestions', null);
    const doc = buildJinxWalletFile({ picks: s?.picks ?? [], boards: await this.boards() });
    const path = writeJinxWalletFile(this.exportDir, doc);
    return { path, count: doc.wallets.length, doc };
  }
}
