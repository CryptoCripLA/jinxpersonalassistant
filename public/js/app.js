// TRADES shell: hash routes, the live event stream, the top bar, and the hooks the views share.
// Views: #/today (home), #/wallets, #/wallet/<address>, #/pulse (live coins), #/coin/<mint>,
// #/history, #/portfolio, #/desk. The analyst briefs every screen as you arrive.
import { $, api, ADDR, usd, short, toast } from './core.js';
import { initAssistant, setContext, getContext, setSize, ask, autoBrief, alert, showApprovals } from './assistant.js';
import { mountPulse, updatePulse, flashCoin } from './views/pulse.js';
import { openCoin, closeCoin, onTrade, selectTab, setRate } from './views/coin.js';
import { openWallets, openWallet } from './views/wallets.js';
import { openHistory } from './views/history.js';
import { openPortfolio, openDesk } from './views/portfolio.js';
import { openToday } from './views/today.js';

const VIEWS = ['today', 'pulse', 'coin', 'wallets', 'wallet', 'history', 'portfolio', 'desk'];
let sizeUsd = 25;
const traderNames = new Map();

const hooks = {
  setContext: (patch) => {
    setContext(patch);
    if (patch.view) setTimeout(() => autoBrief({ ...getContext(), element: undefined }), 400);
  },
  ask,
  get sizeUsd() {
    return sizeUsd;
  },
  back: () => (history.length > 1 ? history.back() : go('#/today')),
  openCoin: (a) => go(`#/coin/${a}`),
  openWallet: (w) => go(`#/wallet/${w}`),
  explainWallet: (w) => autoBrief({ view: 'wallet', wallet: w }),
  explainCoin: (a, symbol) => autoBrief({ view: 'coin', coin: { address: a, symbol } }),
  onToday: (t) => {
    for (const p of t.traders?.picks ?? []) traderNames.set(p.wallet, p.name || short(p.wallet));
  },
  onCopied: () => pollApprovals(),
};

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function show(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  const nav = name === 'coin' ? 'pulse' : name === 'wallet' ? 'wallets' : name;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function route() {
  const [, view = 'today', arg] = location.hash.match(/^#\/(\w+)(?:\/([1-9A-HJ-NP-Za-km-z]{32,44}))?/) ?? [];
  if (view !== 'coin') closeCoin();
  const safe = VIEWS.includes(view) ? view : 'today';
  show(safe);
  const el = $(`view-${safe}`);
  const fail = (e) => toast(e.message);
  if (safe === 'today') openToday(el, hooks).catch(fail);
  else if (safe === 'pulse') hooks.setContext({ view: 'pulse', coin: null });
  else if (safe === 'coin' && arg) openCoin(el, arg, hooks).catch(fail);
  else if (safe === 'wallets') openWallets(el, hooks).catch(fail);
  else if (safe === 'wallet' && arg) openWallet(el, arg, hooks).catch(fail);
  else if (safe === 'history') openHistory(el, hooks).catch(fail);
  else if (safe === 'portfolio') openPortfolio(el, hooks).catch(fail);
  else if (safe === 'desk') openDesk(el, hooks).catch(fail);
}

function onAction(a) {
  if (a.kind === 'wallet' || a.kind === 'simulate' || a.kind === 'settings') hooks.openWallet(a.wallet);
  else if (a.kind === 'copy') {
    sessionStorage.setItem('openCopy', a.wallet);
    hooks.openWallet(a.wallet);
  } else if (a.kind === 'coin') hooks.openCoin(a.address);
  else if (a.kind === 'view') go(`#/${a.view}`);
  else if (a.kind === 'tab') selectTab(a.tab);
}

// ---- live status
async function loadStatus() {
  try {
    const a = await api('/api/account');
    $('balance').textContent = usd(a.cashUsd);
    $('balanceNote').textContent = a.stale ? `as of ${new Date(a.asOf).toLocaleTimeString()}` : 'GMGN wallet';
    $('balance').title = a.stale ? `GMGN did not answer just now (${a.staleReason}). Showing your last known balance.` : '';
    const s = await api('/api/status');
    sizeUsd = s.user?.sizeUsd ?? 25;
    setSize(sizeUsd);
    setRate(s.account?.rate ?? a.rate);
    const ok = s.live?.pulse && !s.live?.pulseError;
    $('liveDot').className = `dot ${ok ? 'on' : s.live?.pulseError ? 'warn' : ''}`;
    $('liveText').textContent = s.live?.pulseError ? 'GMGN pausing us' : s.live?.stream?.open ? 'live' : ok ? 'live' : 'connecting';
  } catch {
    $('balance').textContent = 'offline';
    $('liveDot').className = 'dot warn';
    $('liveText').textContent = 'server offline';
  }
}

// ---- copies waiting for your tap
let approvalsTimer = null;
async function pollApprovals() {
  clearTimeout(approvalsTimer);
  try {
    const d = await api('/api/copy');
    const waiting = d.intents.filter((i) => i.state === 'awaiting_approval' && i.detail.expiresAt > Date.now());
    showApprovals(waiting, {
      approve: (id) => api('/api/copy/approve', { id }).then((r) => { toast(`Copy ${r.state}`); pollApprovals(); }).catch((e) => toast(e.message)),
      skip: (id) => api('/api/copy/reject', { id }).then(pollApprovals),
    });
    approvalsTimer = setTimeout(pollApprovals, d.watches.length ? (waiting.length ? 1000 : 4000) : 30_000);
  } catch {
    approvalsTimer = setTimeout(pollApprovals, 10_000);
  }
}

// ---- live events
const alerted = new Map();
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('pulse', (m) => {
    const cols = JSON.parse(m.data);
    updatePulse(cols);
    $('liveDot').className = `dot ${cols.error ? 'warn' : 'on'}`;
    $('liveText').textContent = cols.error ? 'GMGN pausing us' : `live · ${new Date((cols.updatedAt ?? Date.now() / 1000) * 1000).toLocaleTimeString()}`;
  });
  es.addEventListener('pp', (m) => {
    const e = JSON.parse(m.data);
    if (e.kind !== 'trade') return;
    onTrade(e);
    if (e.followed && e.side === 'buy') {
      flashCoin(e.mint);
      // one heads-up per coin per minute, only for traders I recommended or you copy
      const name = traderNames.get(e.wallet);
      if (name && Date.now() - (alerted.get(e.mint) ?? 0) > 60_000) {
        alerted.set(e.mint, Date.now());
        alert(`Heads up: ${name}, one of your recommended traders, just bought ${short(e.mint)}.`, [{ kind: 'coin', address: e.mint, label: 'Open the coin' }]);
      }
    }
  });
  es.addEventListener('orders', () => location.hash.startsWith('#/portfolio') && route());
  es.onerror = () => {
    $('liveDot').className = 'dot warn';
    $('liveText').textContent = 'reconnecting';
  };
}

$('searchForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const v = $('searchInput').value.trim();
  if (!ADDR.test(v)) return toast('Paste a full coin or wallet address.');
  $('searchInput').value = '';
  // pump.fun mints end in "pump"; otherwise ask GMGN whether it is a coin
  if (/pump$/.test(v)) return hooks.openCoin(v);
  try {
    await api(`/api/coin/${v}`);
    hooks.openCoin(v);
  } catch {
    hooks.openWallet(v);
  }
});

// the browser's time zone, so "today" and daily results use your day, not the server's
api('/api/prefs', { tzOffsetMin: -new Date().getTimezoneOffset() }).catch(() => {});

initAssistant({ onActionFn: onAction });
mountPulse($('view-pulse'), { open: hooks.openCoin, visible: (list) => setContext({ visible: list }) });
window.addEventListener('hashchange', route);
route();
loadStatus();
setInterval(loadStatus, 30_000);
connect();
pollApprovals();
