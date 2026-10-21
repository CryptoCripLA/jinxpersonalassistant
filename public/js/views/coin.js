// Coin page: GMGN-style header, chart, five tabs (why it is moving, early buyers, live trades,
// holders, safety) and the trade column (Buy/Sell with a confirmed quote, $25 scenario, momentum).
import { add, h, clear, api, icon, logo, usd, usdShort, usdSigned, priceUsd, pct, pctSigned, mult, short, age, isNum, signClass, label, toast, explainAttrs } from '../core.js';
import { CoinChart } from '../chart.js';
import { checkList } from '../cards.js';

let state = null;
let usdPerSol = null;

export const setRate = (r) => {
  usdPerSol = r?.usdPerSol ?? usdPerSol;
};

export function closeCoin() {
  if (!state) return;
  clearInterval(state.timer);
  clearInterval(state.quoteTimer);
  state.chart?.destroy();
  api('/api/focus', { coins: [] }).catch(() => {});
  state = null;
}

const kpi = (k, v, key, cls = '', big = false) => h('div', { class: `kpi${big ? ' big' : ''}`, ...explainAttrs(key, v) }, h('span', { class: `v ${cls}` }, v), h('span', { class: 'k' }, k));

export async function openCoin(root, address, hooks) {
  closeCoin();
  state = { address, hooks, tab: 'why', res: '1m', mode: 'mcap', side: 'buy', amount: hooks.sizeUsd ?? 25, pct: 50, slippage: 30, trades: [], quote: null, tip: 'normal', useExit: true, prefs: null };
  api('/api/prefs').then((p) => {
    if (!state) return;
    state.prefs = p;
    state.useExit = p.useExitPlan;
    if (state.sideEl) renderSide();
  }).catch(() => {});
  add(clear(root), h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('p', { class: 'faint' }, 'Reading live data from GMGN and pump.fun…')));
  let d;
  try {
    d = await api(`/api/coin/${address}`);
  } catch (e) {
    add(clear(root), h('div', { class: 'page' }, h('p', {}, `Could not load this coin: ${e.message}`), h('button', { class: 'btn', type: 'button', onclick: () => hooks.back() }, 'Back to Pulse')));
    return;
  }
  if (!state || state.address !== address) return;
  state.d = d;
  hooks.setContext({ view: 'coin', coin: { address, symbol: d.symbol } });
  render(root);
  loadChart();
  api('/api/focus', { coins: [address] }).catch(() => {});
  state.timer = setInterval(refresh, 10_000);
}

async function refresh() {
  if (!state) return;
  try {
    const d = await api(`/api/coin/${state.address}`);
    if (!state) return;
    state.d = d;
    renderHead();
    renderSide();
    if (state.tab !== 'trades') renderTab();
  } catch { /* keep the last good view */ }
}

async function loadChart() {
  if (!state) return;
  try {
    const k = await api(`/api/coin/${state.address}/candles?res=${state.res}`);
    if (!state) return;
    const markers = (state.d.early?.buyers ?? []).filter((b) => b.explosive).map((b) => ({ t: b.firstBuyTs, text: b.explosiveName || 'EXP' }));
    state.chart.set({ candles: k.candles, supply: state.d.totalSupply, markers });
    state.chartSrc.textContent = `${k.source} · ${state.res} candles`;
  } catch (e) {
    state.chartSrc.textContent = `Chart unavailable: ${e.message}`;
  }
}

function render(root) {
  state.headEl = h('div', { class: 'coin-head' });
  state.chartEl = h('div', { class: 'chart', ...explainAttrs('coin.chart') });
  state.chartSrc = h('span', { class: 'faint', style: { fontSize: '12px' } });
  const seg = (items, cur, onPick, key) => h('div', { class: 'seg', role: 'group', ...explainAttrs(key) }, items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === cur), onclick: (ev) => { for (const b of ev.target.parentElement.children) b.setAttribute('aria-pressed', String(b === ev.target)); onPick(v); } }, l)));
  state.tabsEl = h('div', { class: 'subtabs', role: 'tablist' });
  state.paneEl = h('div', { class: 'pane' });
  state.sideEl = h('div', { class: 'side' });
  add(clear(root), h('div', { class: 'coin' },
    state.headEl,
    h('div', { class: 'coin-left' },
      h('div', { class: 'chart-bar' },
        seg([['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1h']], state.res, (v) => { state.res = v; loadChart(); }, 'chart.interval'),
        seg([['mcap', 'Market cap'], ['price', 'Price']], state.mode, (v) => { state.mode = v; state.chart.setMode(v); }, 'chart.mode'),
        h('span', { class: 'sep' }), state.chartSrc),
      state.chartEl,
      state.tabsEl,
      state.paneEl),
    state.sideEl));
  try {
    state.chart = new CoinChart(state.chartEl);
  } catch (e) {
    // a broken chart must never take the trade panel and the data down with it
    state.chart = { set() {}, setMode() {}, destroy() {} };
    add(state.chartEl, h('div', { class: 'note' }, `Chart unavailable: ${e.message}`));
  }
  renderHead();
  renderTabs();
  renderTab();
  renderSide();
}

function renderHead() {
  const d = state.d;
  const links = [
    d.links.twitter ? h('a', { href: d.links.twitter, target: '_blank', rel: 'noopener noreferrer' }, 'X') : null,
    d.links.website ? h('a', { href: d.links.website, target: '_blank', rel: 'noopener noreferrer' }, 'Site') : null,
    d.links.telegram ? h('a', { href: d.links.telegram, target: '_blank', rel: 'noopener noreferrer' }, 'Telegram') : null,
    h('a', { href: `https://gmgn.ai/sol/token/${d.address}`, target: '_blank', rel: 'noopener noreferrer' }, 'GMGN'),
    d.isPump ? h('a', { href: `https://pump.fun/coin/${d.address}`, target: '_blank', rel: 'noopener noreferrer' }, 'pump.fun') : null,
  ];
  add(clear(state.headEl), 
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => state.hooks.back(), 'aria-label': 'Back to Pulse' }, icon('back')),
    logo(d.logo, d.symbol),
    h('div', { class: 'coin-id' },
      h('h1', {}, d.symbol, h('span', {}, d.name)),
      h('div', { class: 'sub' },
        h('button', { class: 'addr', type: 'button', title: 'Copy address', onclick: async () => { await navigator.clipboard.writeText(d.address); toast('Address copied'); } }, short(d.address), ' ', icon('copy')),
        h('span', {}, d.launchpad || 'unknown launchpad'),
        h('span', explainAttrs('row.age', age(d.ageSec)), `${age(d.ageSec)} old`),
        d.graduatedTs ? h('span', { class: 'chip' }, 'graduated') : isNum(d.progress) ? h('span', { class: 'chip', ...explainAttrs('row.progress', pct(d.progress)) }, `curve ${pct(d.progress)}`) : null,
        ...links.filter(Boolean))),
    h('div', { class: 'kpis' },
      kpi('market cap', usdShort(d.marketCapUsd), 'row.mcap', '', true),
      kpi('price', priceUsd(d.priceUsd), 'coin.chart'),
      kpi('5 min', pctSigned(d.changes.m5), 'coin.changes', signClass(d.changes.m5)),
      kpi('1 hour', pctSigned(d.changes.h1), 'coin.changes', signClass(d.changes.h1)),
      kpi('liquidity', usdShort(d.liquidityUsd), 'coin.liquidity'),
      kpi('holders', isNum(d.holderCount) ? d.holderCount.toLocaleString('en-US') : 'n/a', 'coin.holders'),
      kpi('of all-time high', pct(d.multipleFromAth), 'coin.ath'),
      kpi('momentum', `${d.momentum.score}`, 'coin.momentum', d.momentum.score >= 70 ? 'up' : '')));
}

const TABS = [['why', 'Why it is moving', 'coin.momentum'], ['early', 'Early buyers', 'tab.early'], ['trades', 'Live trades', 'tab.trades'], ['holders', 'Holders', 'tab.holders'], ['safety', 'Safety', 'coin.safety']];
function renderTabs() {
  add(clear(state.tabsEl), ...TABS.map(([k, l, key]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === k), 'data-explain': key, onclick: () => selectTab(k) }, l)));
}

export function selectTab(k) {
  if (!state || !TABS.some(([t]) => t === k)) return;
  state.tab = k;
  renderTabs();
  renderTab();
}

function walletCell(b) {
  return h('button', { class: 'wl', type: 'button', onclick: () => state.hooks.openWallet(b.wallet) }, b.explosiveName || short(b.wallet), b.explosive ? h('span', { class: 'chip exp', style: { marginLeft: '6px' } }, icon('bolt'), 'EXP') : null);
}

function renderTab() {
  const d = state.d;
  const p = clear(state.paneEl);
  if (state.tab === 'why') {
    const m = d.momentum;
    add(p, 
      h('p', { class: 'summary-line' }, `Stage `, h('b', { class: `stage ${m.stage}` }, m.stage), `. Momentum ${m.score}/100 from live flow (${d.rates?.source ?? 'GMGN running totals'}).`),
      d.checks ? h('div', { style: { margin: '6px 0 12px' } }, h('p', { class: d.checks.pass ? 'up' : 'down', style: { fontSize: '13px', fontWeight: 600, marginBottom: '4px' } }, d.checks.pass ? `Passes the hard filters (${d.checks.passed} of ${d.checks.checks.length} checks green).` : 'Fails a hard filter: I would not buy this.'), checkList(d.checks)) : null,
      h('ul', { class: 'reasons' }, m.reasons.map((r) => h('li', {}, r)), m.warnings.map((w) => h('li', { class: 'risk' }, w))),
      h('p', { class: 'summary-line', style: { marginTop: '14px' } }, d.early?.summary?.text ?? ''),
      h('div', { class: 'stats' },
        statBox('buys last minute', d.flow.buys1m, 'row.buys'),
        statBox('sells last minute', d.flow.sells1m, 'row.buys'),
        statBox('volume 5 min', usdShort(d.flow.volume5mUsd), 'chart.volume'),
        statBox('volume 1 hour', usdShort(d.flow.volume1hUsd), 'chart.volume'),
        statBox('smart wallets', d.walletTags.smart, 'row.smart'),
        statBox('KOL wallets', d.walletTags.kol, 'row.smart'),
        statBox('snipers', d.walletTags.snipers, 'coin.safety')),
      h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        ['Why is this coin pumping?', 'Could this coin realistically reach 10x from here?', "What's X saying about this coin?"].map((q) => h('button', { class: 'btn small', type: 'button', onclick: () => state.hooks.ask(q) }, q))));
  } else if (state.tab === 'early') {
    const e = d.early;
    add(p, h('p', { class: 'summary-line' }, e.summary?.text ?? '', ' ', h('span', { class: 'faint' }, `Source: ${e.source}${e.note ? `. ${e.note}` : ''}`), ' ', label('LIVE')));
    if (!e.buyers.length) {
      add(p, h('p', { class: 'empty' }, 'No buyer list is available for this coin right now.'));
      return;
    }
    add(p, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Wallet'), h('th', { class: 'n' }, 'After launch'), h('th', { class: 'n', ...explainAttrs('early.entry') }, 'Entry market cap'), h('th', { class: 'n' }, 'Spent'), h('th', { class: 'n', ...explainAttrs('early.multiple') }, 'Multiple now'), h('th', { class: 'n' }, 'Sold at'), h('th', { class: 'n', ...explainAttrs('early.held') }, 'Holding'), h('th', { class: 'n' }, 'Profit'))),
      h('tbody', {}, e.buyers.slice(0, 40).map((b) => h('tr', {},
        h('td', { class: 'faint' }, b.rank),
        h('td', {}, walletCell(b)),
        h('td', { class: 'n faint' }, isNum(b.secondsAfterLaunch) ? age(b.secondsAfterLaunch) : ''),
        h('td', { class: 'n' }, usdShort(b.entryMcapUsd)),
        h('td', { class: 'n' }, usdShort(b.boughtUsd)),
        h('td', { class: `n ${b.multipleNow >= 1 ? 'up' : 'down'}` }, mult(b.multipleNow)),
        h('td', { class: 'n' }, b.capturedMultiple ? mult(b.capturedMultiple) : ''),
        h('td', { class: 'n' }, b.stillHolding ? pct(b.heldShare ?? 1) : h('span', { class: 'faint' }, 'sold out')),
        h('td', { class: `n ${signClass(b.profitUsd)}` }, usdSigned(b.profitUsd)))))));
  } else if (state.tab === 'trades') {
    add(p, h('p', { class: 'summary-line' }, d.isPump ? 'Every buy and sell as it happens (pump.fun stream). Gold rows are wallets from your explosive list.' : 'The live trade stream covers pump.fun coins; this coin trades elsewhere.', ' ', label('LIVE')));
    state.tradeBody = h('tbody', {});
    add(p, h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Side'), h('th', {}, 'Wallet'), h('th', { class: 'n' }, 'Amount'), h('th', { class: 'n' }, 'Market cap'))), state.tradeBody));
    drawTrades();
  } else if (state.tab === 'holders') {
    add(p, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Wallet'), h('th', { class: 'n' }, 'Share'), h('th', { class: 'n' }, 'Value'), h('th', {}, 'Tags'))),
      h('tbody', {}, d.holders.map((x) => h('tr', {},
        h('td', {}, x.isPool ? h('span', { class: 'faint' }, `${short(x.wallet)} (pool or exchange)`) : walletCell({ wallet: x.wallet, explosive: x.explosive })),
        h('td', { class: 'n' }, pct(x.share, 1)),
        h('td', { class: 'n' }, usdShort(x.valueUsd)),
        h('td', { class: 'faint' }, x.tags.join(', ')))))));
  } else if (state.tab === 'safety') {
    const s = d.safety;
    const row = (k, v, bad) => [h('span', { class: 'k' }, k), h('span', { class: bad ? 'down' : '' }, v)];
    if (d.checks) add(p, h('div', { style: { marginBottom: '14px' } }, checkList(d.checks)));
    add(p, h('div', { class: 'safety', style: { maxWidth: '560px' }, ...explainAttrs('coin.safety') },
      row('Rug-pull risk', pct(s.rugRatio), s.rugRatio > 0.3),
      row('Creator sold', s.devSold ? 'yes' : 'no', false),
      row("Creator's team holds", pct(s.devTeamHold, 1), s.devTeamHold > 0.05),
      row('Top 10 holders own', pct(s.top10), s.top10 > 0.5),
      row('Bundled-wallet volume', pct(s.bundlerShare), s.bundlerShare > 0.3),
      row('Insider ("rat") volume', pct(s.ratShare), s.ratShare > 0.3),
      row('Trap-trading score', pct(s.trapShare), s.trapShare > 0.3),
      row('Bots among traders', pct(s.botRate), s.botRate > 0.5),
      row('Snipers still hold', pct(s.sniperHold, 1), s.sniperHold > 0.2),
      row('Fresh wallets', pct(s.freshWallets), s.freshWallets > 0.5),
      row('Honeypot (cannot sell)', s.honeypot == null ? 'n/a' : s.honeypot ? 'YES' : 'no', Boolean(s.honeypot)),
      row('Wash trading', s.washTrading == null ? 'n/a' : s.washTrading ? 'YES' : 'no', Boolean(s.washTrading))));
  }
}

function statBox(k, v, key) {
  return h('div', { class: 'stat', ...explainAttrs(key, v) }, h('div', { class: 'v' }, v ?? 'n/a'), h('div', { class: 'k' }, k));
}

// ---- live trades from the PumpPortal stream
export function onTrade(e) {
  if (!state || e.mint !== state.address || e.kind !== 'trade') return;
  state.trades.unshift(e);
  state.trades.length = Math.min(state.trades.length, 80);
  if (state.tab === 'trades') drawTrades();
}

function drawTrades() {
  if (!state?.tradeBody) return;
  const body = clear(state.tradeBody);
  if (!state.trades.length) {
    add(body, h('tr', {}, h('td', { colspan: '5', class: 'faint' }, 'Waiting for the next trade…')));
    return;
  }
  for (const t of state.trades) {
    const amt = usdPerSol ? t.solAmount * usdPerSol : null;
    const mc = usdPerSol && t.marketCapSol ? t.marketCapSol * usdPerSol : null;
    add(body, h('tr', { style: t.followed ? { background: 'var(--gold-wash)' } : null },
      h('td', { class: 'faint' }, new Date(t.at).toLocaleTimeString()),
      h('td', { class: t.side === 'buy' ? 'up' : 'down' }, t.side === 'buy' ? 'Buy' : 'Sell'),
      h('td', {}, walletCell({ wallet: t.wallet, explosive: t.followed })),
      h('td', { class: 'n' }, usd(amt)),
      h('td', { class: 'n' }, usdShort(mc))));
  }
}

// ---- trade column
function renderSide() {
  const d = state.d;
  const side = clear(state.sideEl);
  add(side, tradeBlock(), scenarioBlock(d), momentumBlock(d));
  if (d.explosiveIn.length) {
    add(side, h('div', { class: 'block' }, h('h3', { ...explainAttrs('row.explosive', d.explosiveIn.length) }, 'Your explosive wallets in this coin'),
      h('ul', { class: 'list' }, d.explosiveIn.map((w) => h('li', {}, walletCell({ wallet: w.wallet, explosive: true, explosiveName: w.name }), h('span', { class: 'faint' }, `in at ${usdShort(w.entryMcapUsd)}`), h('span', {}, w.stillHolding ? 'holding' : 'sold'))))));
  }
}

function tradeBlock() {
  const box = h('div', { class: 'block' });
  const status = h('p', { class: 'status-line' });
  const quoteBox = h('div');
  const isBuy = state.side === 'buy';
  const presets = isBuy ? [10, 25, 50, 100] : [25, 50, 75, 100];
  const amountInput = h('input', { type: 'number', min: '1', step: '1', value: String(state.amount), inputmode: 'decimal', 'aria-label': 'Dollars to spend' });
  amountInput.addEventListener('input', () => { state.amount = Number(amountInput.value); markPresets(); });
  const presetBtns = presets.map((v) => h('button', { type: 'button', 'aria-pressed': String(isBuy ? state.amount === v : state.pct === v), onclick: () => { if (isBuy) { state.amount = v; amountInput.value = String(v); } else state.pct = v; markPresets(); } }, isBuy ? `$${v}` : `${v}%`));
  function markPresets() {
    presetBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(isBuy ? state.amount === presets[i] : state.pct === presets[i])));
  }
  const slip = h('select', { 'aria-label': 'Slippage' }, [10, 20, 30, 40, 50].map((v) => h('option', { value: String(v), selected: v === state.slippage }, `${v}%`)));
  slip.addEventListener('change', () => (state.slippage = Number(slip.value)));
  const getPrice = h('button', { class: `btn ${isBuy ? 'buy' : 'sell'}`, type: 'button', style: { width: '100%' }, ...explainAttrs(isBuy ? 'trade.buy' : 'trade.sell') }, isBuy ? 'Get buy price' : 'Get sell price');
  getPrice.addEventListener('click', async () => {
    getPrice.disabled = true;
    status.className = 'status-line';
    status.textContent = 'Asking GMGN for a live price…';
    try {
      const q = await api('/api/trade/quote', { side: state.side, token: state.address, usd: isBuy ? state.amount : undefined, pct: isBuy ? undefined : state.pct, slippage: state.slippage, tip: state.tip, exitPlan: isBuy && state.useExit ? undefined : false });
      state.quote = q;
      status.textContent = '';
      showQuote(quoteBox, status);
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.message;
    } finally {
      getPrice.disabled = false;
    }
  });
  add(box, 
    h('div', { class: 'trade-tabs', role: 'group', 'aria-label': 'Buy or sell' },
      h('button', { class: 'b', type: 'button', 'aria-pressed': String(isBuy), onclick: () => { state.side = 'buy'; state.quote = null; renderSide(); } }, 'Buy'),
      h('button', { class: 's', type: 'button', 'aria-pressed': String(!isBuy), onclick: () => { state.side = 'sell'; state.quote = null; renderSide(); } }, 'Sell')),
    h('div', { class: 'presets', ...explainAttrs(isBuy ? 'trade.amount' : 'trade.sell') }, presetBtns),
    isBuy ? h('label', { class: 'field' }, 'Dollars', amountInput) : null,
    h('label', { class: 'field', ...explainAttrs('trade.slippage', `${state.slippage}%`) }, 'Slippage', slip),
    h('div', { class: 'field', ...explainAttrs('trade.tip') }, 'Speed',
      h('div', { class: 'seg', role: 'group' }, [['normal', 'Normal'], ['fast', 'Fast']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(state.tip === v), onclick: (ev) => { state.tip = v; for (const b of ev.target.parentElement.children) b.setAttribute('aria-pressed', String(b === ev.target)); } }, l)))),
    isBuy && state.prefs ? h('label', { class: 'exit-plan', ...explainAttrs('trade.exit') },
      h('input', { type: 'checkbox', checked: state.useExit, onchange: (ev) => (state.useExit = ev.target.checked) }),
      h('span', {}, h('b', {}, 'Exit plan: '), state.prefs.exitText, h('a', { href: '#/today', class: 'faint' }, ' Edit'))) : null,
    getPrice, quoteBox, status,
    h('p', { class: 'faint', style: { fontSize: '11.5px', marginTop: '8px' } }, 'From your GMGN wallet, anti-MEV on. Nothing is spent until you press Confirm on a live price.'));
  return box;
}

function showQuote(box, status) {
  clearInterval(state.quoteTimer);
  const q = state.quote;
  const timer = h('span', { class: 'timer' });
  const confirm = h('button', { class: `btn ${q.side === 'buy' ? 'buy' : 'sell'}`, type: 'button', style: { width: '100%' } }, q.side === 'buy' ? `Confirm buy for $${q.payUsd}` : `Confirm sell of ${q.sellPct}%`);
  const lines = q.side === 'buy'
    ? [['You pay', usd(q.payUsd)], ['You get about', `${Math.round(q.receiveTokens).toLocaleString('en-US')} coins (${usd(q.receiveUsd)})`], ['Worst fill you accept', `${Math.round(q.minReceiveTokens).toLocaleString('en-US')} coins`]]
    : [['You sell', `${q.sellPct}% (${Math.round(q.sellTokens).toLocaleString('en-US')} coins)`], ['You get about', usd(q.receiveUsd)], ['Worst fill you accept', usd(q.minReceiveUsd)]];
  lines.push(['Network fee and tip', `about ${usd(q.tipUsd)} (${q.tip === 'fast' ? 'fast' : 'normal'})`]);
  if (q.exitText) lines.push(['Exit orders placed with it', q.exitText]);
  add(clear(box), h('div', { class: 'quote', ...explainAttrs('trade.quote') }, lines.map(([k, v]) => h('div', { class: 'ln' }, h('span', {}, k), h('span', {}, v))), h('div', { class: 'ln' }, label('LIVE'), timer), confirm));
  const tick = () => {
    const left = Math.round((q.expiresAt - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(state.quoteTimer);
      timer.textContent = 'Price expired. Get a new one.';
      confirm.disabled = true;
      return;
    }
    timer.textContent = `Price valid for ${left}s`;
  };
  tick();
  state.quoteTimer = setInterval(tick, 500);
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    clearInterval(state.quoteTimer);
    try {
      const o = await api('/api/trade/confirm', { quoteId: q.quoteId });
      status.className = o.state === 'failed' || o.state === 'unknown' ? 'status-line err' : 'status-line';
      status.textContent = o.state === 'submitted' ? 'Sent to GMGN. Waiting for the chain to confirm; see Portfolio for the result.' : o.detail?.reason ?? `Order ${o.state}.`;
      toast(o.state === 'submitted' ? 'Order sent to GMGN' : `Order ${o.state}`);
      clear(box);
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.message;
    }
  });
}

function scenarioBlock(d) {
  const s = d.scenario;
  const keys = [0, 0.5, 2, 3, 5, 7, 10, 19];
  return h('div', { class: 'block', ...explainAttrs('coin.scenario') },
    h('h3', {}, `$${s.sizeUsd} at ${usdShort(d.marketCapUsd)}`, label('SIMULATED')),
    h('table', { class: 'scen' }, h('tbody', {}, s.rows.filter((r) => keys.includes(r.multiple)).map((r) => h('tr', { class: [7, 10, 19].includes(r.multiple) ? 'key' : '' },
      h('td', {}, r.multiple === 0 ? 'Goes to zero' : `${r.multiple}x`),
      h('td', { class: 'faint' }, r.multiple ? usdShort(r.targetMarketCapUsd) : ''),
      h('td', { class: 'n' }, usd(r.proceedsUsd)),
      h('td', { class: `n ${signClass(r.netUsd)}` }, usdSigned(r.netUsd)))))),
    h('p', { class: 'faint', style: { fontSize: '11.5px', marginTop: '6px' } }, isNum(s.breakevenMultiple) ? `Fees in and out: it must rise ${pct(s.breakevenMultiple - 1)} before you make a cent.` : 'Some fees could not be priced.'));
}

function momentumBlock(d) {
  const m = d.momentum;
  return h('div', { class: 'block' },
    h('h3', { ...explainAttrs('coin.momentum', m.score) }, 'Momentum', h('span', { class: `stage ${m.stage}`, style: { marginLeft: 'auto' }, ...explainAttrs('coin.stage', m.stage) }, m.stage)),
    h('div', { class: 'meter' }, h('i', { style: { width: `${m.score}%` } })),
    m.parts ? h('div', { class: 'safety' },
      h('span', { class: 'k' }, 'Buying speed'), h('span', {}, `${m.parts.ignition}/35`),
      h('span', { class: 'k' }, 'Smart and explosive wallets'), h('span', {}, `${m.parts.smart}/30`),
      h('span', { class: 'k' }, 'Graduation pull'), h('span', {}, `${m.parts.curve}/15`),
      h('span', { class: 'k' }, 'Health'), h('span', {}, `${m.parts.health}/20`)) : null,
    d.momentum.disqualified ? h('p', { class: 'down' }, d.momentum.disqualified) : null);
}

export const coinState = () => state;
