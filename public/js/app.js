// K TRADES terminal shell: hash routes, the live event stream, the top bar and the hooks the
// views share. Views: #/pulse, #/coin/<mint>, #/wallets, #/wallet/<address>, #/history,
// #/portfolio, #/desk.
import { $, api, ADDR, usd, toast } from './core.js';
import { initAssistant, setContext, setSize, ask } from './assistant.js';
import { mountPulse, updatePulse, flashCoin } from './views/pulse.js';
import { openCoin, closeCoin, onTrade, selectTab, setRate } from './views/coin.js';
import { openWallets, openWallet } from './views/wallets.js';
import { openHistory } from './views/history.js';
import { openPortfolio, openDesk } from './views/portfolio.js';

const VIEWS = ['pulse', 'coin', 'wallets', 'wallet', 'history', 'portfolio', 'desk'];
let sizeUsd = 25;

const hooks = {
  setContext,
  ask,
  get sizeUsd() {
    return sizeUsd;
  },
  back: () => (history.length > 1 ? history.back() : go('#/pulse')),
  openCoin: (a) => go(`#/coin/${a}`),
  openWallet: (w) => go(`#/wallet/${w}`),
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
  const [, view = 'pulse', arg] = location.hash.match(/^#\/(\w+)(?:\/([1-9A-HJ-NP-Za-km-z]{32,44}))?/) ?? [];
  if (view !== 'coin') closeCoin();
  const safe = VIEWS.includes(view) ? view : 'pulse';
  show(safe);
  const el = $(`view-${safe}`);
  const fail = (e) => toast(e.message);
  if (safe === 'pulse') setContext({ view: 'pulse', coin: null });
  else if (safe === 'coin' && arg) openCoin(el, arg, hooks).catch(fail);
  else if (safe === 'wallets') openWallets(el, hooks).catch(fail);
  else if (safe === 'wallet' && arg) openWallet(el, arg, hooks).catch(fail);
  else if (safe === 'history') openHistory(el, hooks).catch(fail);
  else if (safe === 'portfolio') openPortfolio(el, hooks).catch(fail);
  else if (safe === 'desk') openDesk(el, hooks).catch(fail);
}

function onAction(a) {
  if (a.kind === 'wallet' || a.kind === 'simulate' || a.kind === 'settings') hooks.openWallet(a.wallet);
  else if (a.kind === 'coin') hooks.openCoin(a.address);
  else if (a.kind === 'view') go(`#/${a.view}`);
  else if (a.kind === 'tab') selectTab(a.tab);
}

// ---- live status
async function loadStatus() {
  try {
    const s = await api('/api/status');
    $('balance').textContent = usd(s.account?.totalUsd);
    sizeUsd = s.user?.sizeUsd ?? 25;
    setSize(sizeUsd);
    setRate(s.account?.rate);
    const ok = s.live?.pulse && !s.live?.pulseError;
    $('liveDot').className = `dot ${ok ? 'on' : s.live?.pulseError ? 'warn' : ''}`;
    $('liveText').textContent = s.live?.pulseError ? 'GMGN paused' : s.live?.stream?.open ? 'live · stream on' : ok ? 'live' : 'connecting';
  } catch (e) {
    $('balance').textContent = 'offline';
    $('liveDot').className = 'dot warn';
    $('liveText').textContent = 'server offline';
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('pulse', (m) => {
    const cols = JSON.parse(m.data);
    updatePulse(cols);
    $('liveDot').className = `dot ${cols.error ? 'warn' : 'on'}`;
    $('liveText').textContent = cols.error ? 'GMGN paused' : `live · ${new Date((cols.updatedAt ?? Date.now() / 1000) * 1000).toLocaleTimeString()}`;
  });
  es.addEventListener('pp', (m) => {
    const e = JSON.parse(m.data);
    if (e.kind === 'trade') {
      onTrade(e);
      if (e.followed && e.side === 'buy') flashCoin(e.mint);
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
  // A mint usually ends in "pump" on pump.fun; otherwise ask GMGN whether it is a coin.
  if (/pump$/.test(v)) return hooks.openCoin(v);
  try {
    await api(`/api/coin/${v}`);
    hooks.openCoin(v);
  } catch {
    hooks.openWallet(v);
  }
});

initAssistant({ onActionFn: onAction });
mountPulse($('view-pulse'), { open: hooks.openCoin, visible: (list) => setContext({ visible: list }) });
window.addEventListener('hashchange', route);
route();
loadStatus();
setInterval(loadStatus, 30_000);
connect();
