// K TRADES desk front end. Plain DOM, no framework. Every string from GMGN is inserted as
// text (never as HTML), because coin and wallet names are written by strangers.
const TOKEN = document.querySelector('meta[name="jpa-token"]').content;
const $ = (id) => document.getElementById(id);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-jpa-token': TOKEN }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const clear = (el) => { el.replaceChildren(); return el; };

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
function usd(x) {
  if (!isNum(x)) return 'unavailable';
  const s = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a > 0 && a < 0.01) return `${s}$${a.toLocaleString('en-US', { maximumSignificantDigits: 2 })}`;
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const usdSigned = (x) => (isNum(x) && x > 0 ? `+${usd(x)}` : usd(x));
const usdShort = (x) => (!isNum(x) ? 'unavailable' : x >= 1e6 ? `$${+(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${Math.round(x / 1e3)}K` : usd(x));
const pct = (r) => (isNum(r) ? `${Math.round(r * 100)}%` : 'unavailable');
const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const signClass = (x) => (isNum(x) ? (x >= 0 ? 'up' : 'down') : '');
function duration(sec) {
  if (!isNum(sec)) return 'unknown';
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  if (sec < 172800) return `${Math.round((sec / 3600) * 10) / 10} hours`;
  return `${Math.round((sec / 86400) * 10) / 10} days`;
}
const STYLE_NAMES = { graduated: 'Graduated coins', early: 'Early momentum', snipe: 'Sniping' };

let state = { user: null, openWallet: null, watched: new Set() };

// ---------- status
async function loadStatus() {
  try {
    const s = await api('/api/status');
    state.user = s.user;
    $('balance').textContent = usd(s.account?.totalUsd);
    $('sizeUsd').value = s.user.sizeUsd;
    $('delaySec').value = String(s.user.delaySec);
    const when = s.account?.rate?.at ? new Date(s.account.rate.at).toISOString().slice(11, 16) : null;
    $('rateFoot').textContent = when ? `Dollar values use GMGN's live prices, updated ${when} UTC.` : "Dollar values use GMGN's live prices.";
    const d = s.discovery;
    $('discoverStatus').textContent = d.running
      ? `Looking for wallets: ${d.phase} ${d.total ? `${d.done} of ${d.total}` : ''}`
      : `${s.profiles} wallets analyzed so far.${d.last?.at ? ` Last search found ${d.last.candidates} candidates on ${new Date(d.last.at).toLocaleString()}.` : ''}`;
    $('discoverBtn').disabled = d.running;
    if (d.running) setTimeout(loadStatus, 4000);
  } catch (e) {
    $('balance').textContent = 'offline';
    $('rateFoot').textContent = e.message;
  }
}

// ---------- ask
const EXAMPLES = [
  'Find the best trader who buys graduated coins.',
  'Who makes the most money while trading only twice a day?',
  'What would I have made copying this wallet with $25?',
  'Which new coin has the strongest opportunity right now?',
  'What settings should I use for this wallet?',
  'Why did you choose this trader instead of the other one?',
  'What is slippage?',
];

function renderChips() {
  const box = clear($('chips'));
  for (const q of EXAMPLES) box.append(h('button', { type: 'button', onclick: () => { $('askInput').value = q; ask(q); } }, q));
}

function actionButton(a) {
  if (a.kind === 'wallet' || a.kind === 'simulate' || a.kind === 'settings') {
    return h('button', { class: 'btn small', type: 'button', onclick: () => openWallet(a.wallet, a.kind) }, a.label);
  }
  if (a.kind === 'coin' && BASE58.test(a.address ?? '')) {
    return h('a', { class: 'btn small', href: `https://gmgn.ai/sol/token/${a.address}`, target: '_blank', rel: 'noopener noreferrer' }, `${a.label} on GMGN`);
  }
  return null;
}

async function ask(q) {
  const box = $('answer');
  box.hidden = false;
  clear(box).append(h('p', { class: 'a-text' }, 'Looking that up…'));
  try {
    const a = await api('/api/ask', { question: q, wallet: state.openWallet ?? undefined });
    clear(box).append(
      h('p', { class: 'a-text' }, a.text),
      a.evidence?.length ? h('ul', {}, a.evidence.map((e) => h('li', {}, e))) : null,
      a.actions?.length ? h('div', { class: 'a-actions' }, a.actions.map(actionButton)) : null,
      h('p', { class: 'a-by' }, a.by === 'claude' ? 'Answered by Claude using your app data.' : 'Answered from your app data.'),
    );
  } catch (e) {
    clear(box).append(h('p', { class: 'a-text' }, `Could not answer: ${e.message}`));
  }
}

// ---------- suggestions
async function loadSuggestions(refresh = false) {
  const ol = clear($('ladder'));
  ol.append(h('li', { class: 'loading' }, 'Running the copy simulator on live GMGN prices…'));
  try {
    const s = await api(`/api/suggestions${refresh ? '?refresh=1' : ''}`);
    $('sugLede').textContent = `Ranked by what you would have kept at ${usd(s.sizeUsd)} a trade over the last 14 days, after every fee, copying ${s.delaySec} seconds late. Starting money: ${usd(s.capitalUsd)}.`;
    clear(ol);
    if (!s.picks.length) ol.append(h('li', { class: 'empty' }, s.note || 'No wallet would have made you money after fees right now.'));
    for (const p of s.picks) {
      ol.append(h('li', {},
        h('div', {}, h('span', { class: `week ${p.perWeekUsd < 0 ? 'down' : ''}` }, usdSigned(p.perWeekUsd)), h('span', { class: 'per' }, 'a week for you')),
        h('div', { class: 'detail' },
          h('div', { class: 'who' }, p.name || short(p.wallet)),
          h('div', { class: 'tags' },
            h('span', { class: 'tag' }, p.style),
            h('span', { class: `tag ${p.match === 'match' ? 'match' : 'close'}` }, p.match === 'match' ? 'matches your style' : 'close to your style'),
            isNum(p.roughNetUsd) && p.roughNetUsd < 0 ? h('span', { class: 'tag warn' }, 'can lose with bad fills') : null),
          h('p', { class: 'why' }, p.headline),
          p.differences?.length ? h('p', { class: 'why' }, `Different from your style: ${p.differences.join('; ')}.`) : null),
        h('div', { class: 'acts' },
          h('button', { class: 'btn small', type: 'button', onclick: () => openWallet(p.wallet) }, 'Open'),
          h('button', { class: 'btn small gold', type: 'button', onclick: () => openWallet(p.wallet, 'settings') }, 'Copy')),
      ));
    }
    $('sugNote').hidden = !s.note || !s.picks.length;
    $('sugNote').textContent = s.note;
  } catch (e) {
    clear(ol).append(h('li', { class: 'empty' }, `Could not build suggestions: ${e.message}`));
  }
}

$('assumeForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await api('/api/user', { sizeUsd: Number($('sizeUsd').value), delaySec: Number($('delaySec').value) });
  loadSuggestions(true);
  loadBoards();
});

// ---------- coins
const COIN_TABS = [['graduated', 'Just graduated'], ['near', 'About to graduate'], ['new', 'Brand-new'], ['smart', 'Smart money buying'], ['trending', 'Trending']];
let coinTab = 'graduated';
function renderCoinTabs() {
  const box = clear($('coinTabs'));
  for (const [k, label] of COIN_TABS) box.append(h('button', { role: 'tab', 'aria-selected': String(k === coinTab), onclick: () => { coinTab = k; renderCoinTabs(); loadCoins(); } }, label));
}
async function loadCoins() {
  const ul = clear($('coinList'));
  ul.append(h('li', { class: 'empty-line' }, 'Checking coins against GMGN’s safety checklist…'));
  try {
    const o = await api(`/api/coins?category=${coinTab}`);
    clear(ul);
    if (!o.items.length) ul.append(h('li', { class: 'empty-line' }, 'Nothing here passes GMGN’s safety checks right now. Try another tab.'));
    for (const c of o.items.slice(0, 10)) {
      ul.append(h('li', {},
        h('div', { class: 'coin-row' }, h('span', { class: 'coin-sym' }, c.symbol || 'unnamed'), h('span', { class: 'score', title: 'Score out of 100 on GMGN’s checklist' }, String(c.score))),
        h('div', { class: 'coin-meta' }, h('span', {}, `Worth ${usdShort(c.marketCapUsd)}`), h('span', {}, `Pool ${usdShort(c.liquidityUsd)}`), h('span', {}, `${c.age} old`), c.yourWalletsIn.length ? h('span', { class: 'up' }, `${c.yourWalletsIn.length} of your wallets bought it`) : null),
        h('p', { class: 'coin-when' }, `${c.stage.name}: ${c.stage.when}`),
        h('details', {}, h('summary', {}, 'Why this score'), h('ul', {}, [...c.reasons, c.breakevenText].filter(Boolean).map((r) => h('li', {}, r))),
          BASE58.test(c.address ?? '') ? h('p', {}, h('a', { href: `https://gmgn.ai/sol/token/${c.address}`, target: '_blank', rel: 'noopener noreferrer', class: 'btn small' }, 'Open on GMGN')) : null),
      ));
    }
  } catch (e) {
    clear(ul).append(h('li', { class: 'empty-line' }, `Could not load coins: ${e.message}`));
  }
}

// ---------- copy desk
const STATE_WORDS = {
  observed: 'Would have copied (desk was off)', skipped: 'Skipped', awaiting_approval: 'Waiting for you', approved: 'Sending',
  sending: 'Sending', submitted: 'Sent, waiting for GMGN', confirmed: 'Done', failed: 'Failed', unknown: 'Unclear, check GMGN', expired: 'Too late', rejected: 'You said no',
};
const MODE_HELP = {
  off: 'Off: nothing is bought. The desk only notes what it would have copied. Copies you already hold still sell when the wallet sells.',
  confirm: 'Ask me first: when a wallet you copy buys, you get a tap-to-approve here. It expires after 45 seconds, because late copies buy at worse prices.',
  auto: 'Automatic: copies buy by themselves inside your limits.',
};
let deskTimer = null;
async function loadDesk() {
  try {
    const d = await api('/api/copy');
    state.watched = new Set(d.watches.map((w) => w.wallet));
    const mode = d.config.mode;
    $('deskPill').dataset.mode = mode;
    $('deskPill').textContent = mode === 'off' ? 'Copy desk: off' : mode === 'confirm' ? 'Copy desk: asks you' : 'Copy desk: automatic';
    for (const b of $('modeGroup').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
    let help = MODE_HELP[mode];
    if (mode === 'auto' && !d.autoSwitch) help += ' The operator switch is not set on the server, so for now it still asks you.';
    if (d.config.pausedReason) help = `${d.config.pausedReason} ${help}`;
    $('modeHelp').textContent = help;
    const f = $('limitsForm');
    for (const k of ['perTradeUsd', 'maxDailyUsd', 'maxOpen']) if (document.activeElement !== f[k]) f[k].value = d.config.limits[k];

    const now = Date.now();
    const waiting = d.intents.filter((i) => i.state === 'awaiting_approval');
    const ap = clear($('approvals'));
    if (!waiting.length) ap.append(h('li', { class: 'empty-line' }, 'Nothing to approve.'));
    for (const i of waiting) {
      const left = Math.max(0, Math.round((i.detail.expiresAt - now) / 1000));
      ap.append(h('li', {},
        h('span', {}, `Buy ${usd(i.detail.sizeUsd)} of ${i.symbol || 'a coin'} (wallet ${short(i.wallet)} spent ${usd(i.detail.walletSpentUsd)})`),
        h('span', { class: 'count' }, `${left}s`),
        h('span', {},
          h('button', { class: 'btn small gold', type: 'button', onclick: () => api('/api/copy/approve', { id: i.id }).then(loadDesk).catch((e) => alert(e.message)) }, 'Approve'), ' ',
          h('button', { class: 'btn small quiet', type: 'button', onclick: () => api('/api/copy/reject', { id: i.id }).then(loadDesk) }, 'Skip'))));
    }
    const wl = clear($('watching'));
    if (!d.watches.length) wl.append(h('li', { class: 'empty-line' }, 'No wallets yet. Press Copy on a suggestion to add one.'));
    for (const w of d.watches) {
      wl.append(h('li', {},
        h('button', { class: 'wallet-link btn small quiet', type: 'button', onclick: () => openWallet(w.wallet) }, short(w.wallet)),
        h('span', {}, `${usd(w.settings.sizeUsd)} a copy`),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => api('/api/copy/unwatch', { wallet: w.wallet }).then(loadDesk) }, 'Stop')));
    }
    const pl = clear($('positions'));
    if (!d.positions.length) pl.append(h('li', { class: 'empty-line' }, 'No open copies.'));
    for (const p of d.positions) pl.append(h('li', {}, h('span', {}, p.symbol || short(p.token)), h('span', {}, `cost ${usd(p.cost_usd)}`), h('span', { class: signClass(p.realized_usd) }, `sold so far ${usdSigned(p.realized_usd)}`)));
    const al = clear($('activity'));
    for (const i of d.intents.slice(0, 25)) al.append(h('li', {}, `${new Date(i.created_at).toLocaleTimeString()} ${i.side === 'buy' ? 'Buy' : 'Sell'} ${i.symbol || ''}: ${STATE_WORDS[i.state] ?? i.state}. ${i.detail.reason ?? ''}`));
    if (!d.intents.length) al.append(h('li', {}, 'Nothing yet.'));
    clearTimeout(deskTimer);
    deskTimer = setTimeout(loadDesk, waiting.length ? 1000 : 4000);
  } catch (e) {
    $('modeHelp').textContent = `Copy desk unavailable: ${e.message}`;
  }
}

$('modeGroup').addEventListener('click', async (ev) => {
  const mode = ev.target.dataset?.mode;
  if (!mode) return;
  const body = { mode };
  if (mode === 'auto') {
    const t = prompt('Automatic copying buys with real money without asking you each time, inside your limits.\nType AUTO to switch it on.');
    if (t !== 'AUTO') return;
    body.confirmText = 'AUTO';
  }
  try {
    await api('/api/copy/mode', body);
  } catch (e) {
    alert(e.message);
  }
  loadDesk();
});
$('limitsForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  await api('/api/copy/limits', { perTradeUsd: Number(f.perTradeUsd.value), maxDailyUsd: Number(f.maxDailyUsd.value), maxOpen: Number(f.maxOpen.value) });
  loadDesk();
});
$('deskPill').addEventListener('click', () => $('desk').scrollIntoView({ behavior: 'smooth', block: 'start' }));

// ---------- boards
let boardTab = 'graduated';
let boardsCache = null;
function renderBoardTabs() {
  const box = clear($('boardTabs'));
  for (const k of ['graduated', 'early', 'snipe']) box.append(h('button', { role: 'tab', 'aria-selected': String(k === boardTab), onclick: () => { boardTab = k; renderBoardTabs(); renderBoard(); } }, STYLE_NAMES[k]));
}
function renderBoard() {
  const box = clear($('boardTable'));
  const rows = boardsCache?.[boardTab] ?? [];
  if (!rows.length) return box.append(h('p', { class: 'lede' }, 'No wallet has enough trades of this style yet. Press "Look for new wallets".'));
  box.append(h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Wallet'), h('th', {}, 'Your style?'), h('th', { class: 'r' }, 'Trades'), h('th', { class: 'r' }, 'Won'), h('th', { class: 'r' }, 'Wallet made'), h('th', { class: 'r' }, 'You keep a week*'))),
    h('tbody', {}, rows.slice(0, 25).map((r) => h('tr', {},
      h('td', {}, h('button', { class: 'wallet-link', type: 'button', onclick: () => openWallet(r.wallet) }, r.identity?.twitter ? `@${r.identity.twitter}` : short(r.wallet))),
      h('td', {}, r.fits ? 'yes' : 'no'),
      h('td', { class: 'r num' }, String(r.trades)),
      h('td', { class: 'r num' }, String(r.wins)),
      h('td', { class: `r num ${signClass(r.realizedUsd)}` }, usd(r.realizedUsd)),
      h('td', { class: `r num ${signClass(r.keepPerWeekUsd)}` }, usdSigned(r.keepPerWeekUsd)))))));
  box.append(h('p', { class: 'lede', style: 'margin-top:10px' }, '*Quick estimate from the wallet’s own prices and your fees, before copy delay. Open a wallet for the full simulation.'));
}
async function loadBoards() {
  try {
    boardsCache = await api('/api/boards');
  } catch (e) {
    boardsCache = null;
  }
  renderBoard();
}
$('discoverBtn').addEventListener('click', async () => {
  await api('/api/discover', { maxDeep: 80 });
  loadStatus();
});
$('exportBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/export/jinx', {});
    $('exportMsg').textContent = `Saved ${r.count} wallets to ${r.path}. JINX only reads it if you point it there.`;
  } catch (e) {
    $('exportMsg').textContent = e.message;
  }
});

// ---------- wallet drawer
function closeDrawer() {
  $('drawer').hidden = true;
  state.openWallet = null;
}
$('drawerClose').addEventListener('click', closeDrawer);
$('drawer').addEventListener('click', (ev) => { if (ev.target === $('drawer')) closeDrawer(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

function fact(v, k, cls = '') {
  return h('div', { class: 'fact' }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'k' }, k));
}

function equityChart(sim) {
  const pts = sim.typical.equity;
  const rough = sim.rough.equity;
  if (!pts?.length) return null;
  const all = [...pts, ...rough].map((p) => p.equity).concat(sim.assumptions.startCapitalUsd);
  const t0 = Math.min(...pts.map((p) => p.t));
  const t1 = Math.max(...pts.map((p) => p.t), t0 + 1);
  const lo = Math.min(...all);
  const hi = Math.max(...all, lo + 1);
  const W = 680, H = 170, P = 26;
  const x = (t) => P + ((t - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const path = (ps) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Your cash over time while copying' });
  svg.append(el('line', { class: 'grid', x1: P, x2: W - P, y1: H - P, y2: H - P }));
  const s = sim.assumptions.startCapitalUsd;
  svg.append(el('line', { class: 'start', x1: P, x2: W - P, y1: y(s), y2: y(s) }));
  const lab = el('text', { x: P, y: y(s) - 6 }); lab.textContent = `start ${usd(s)}`; svg.append(lab);
  if (rough.length) svg.append(el('path', { class: 'rough', d: path(rough) }));
  svg.append(el('path', { class: 'line', d: path(pts) }));
  return svg;
}

async function runSim(wallet, box) {
  const form = box.querySelector('form');
  const out = box.querySelector('.sim-out');
  clear(out).append(h('p', { class: 'lede' }, 'Replaying this wallet’s real trades with your money…'));
  try {
    const sim = await api('/api/simulate', { wallet, sizeUsd: Number(form.size.value), delaySec: Number(form.delay.value), days: Number(form.days.value) });
    const t = sim.typical;
    clear(out).append(
      h('div', { class: 'sim-result' },
        h('div', { class: 'sim-card yours' }, h('div', { class: 'k' }, 'You would have ended at'), h('div', { class: `big ${signClass(t.netUsd)}` }, usdSigned(t.netUsd)),
          h('div', { class: 'k' }, `With bad luck on every fill: ${usdSigned(sim.rough.netUsd)}. Fees you would have paid: ${usd(t.feesUsd)}.`)),
        h('div', { class: 'sim-card' }, h('div', { class: 'k' }, 'The wallet itself made'), h('div', { class: `big ${signClass(sim.wallet.realizedUsd)}` }, usdSigned(sim.wallet.realizedUsd)),
          h('div', { class: 'k' }, 'on the same trades, with its own money and speed. That is not your result.'))),
      h('p', { class: 'lede', style: 'margin-top:10px' }, `${t.taken} copies: ${t.wins} won, ${t.losses} lost${t.openPositions ? `, ${t.openPositions} still open (valued at the last price seen)` : ''}${t.skippedNoCash ? `, ${t.skippedNoCash} skipped because your money was tied up` : ''}${sim.unavailable ? `, ${sim.unavailable} without price data` : ''}.`),
      equityChart(sim),
      h('table', { class: 'trades' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Coin'), h('th', {}, 'When'), h('th', { class: 'r' }, 'Wallet'), h('th', { class: 'r' }, 'You'), h('th', {}, ''))),
        h('tbody', {}, sim.rows.slice().reverse().slice(0, 40).map((r) => h('tr', {},
          h('td', {}, r.symbol || '?'),
          h('td', {}, new Date(r.openTs * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
          h('td', { class: `r num ${signClass(r.walletReturn)}` }, isNum(r.walletReturn) ? `${r.walletReturn >= 0 ? '+' : ''}${Math.round(r.walletReturn * 100)}%` : 'open'),
          h('td', { class: `r num ${signClass(r.myNetUsd)}` }, isNum(r.myNetUsd) ? usdSigned(r.myNetUsd) : '—'),
          h('td', { class: 'lede' }, r.note))))),
    );
  } catch (e) {
    clear(out).append(h('p', { class: 'lede' }, `Simulation failed: ${e.message}`));
  }
}

async function openWallet(wallet, focus) {
  if (!BASE58.test(wallet)) return;
  state.openWallet = wallet;
  const body = clear($('drawerBody'));
  $('drawer').hidden = false;
  body.append(h('p', { class: 'lede' }, 'Reading this wallet’s trades from GMGN…'));
  let d;
  try {
    d = await api(`/api/wallet/${wallet}`);
  } catch (e) {
    clear(body).append(h('p', {}, `Could not read this wallet: ${e.message}`));
    return;
  }
  const p = d.profile;
  const ident = p.gmgn30?.identity;
  const mix = Object.entries(p.stageMix ?? {}).filter(([k, v]) => v > 0 && k !== 'unknown').sort((a, b) => b[1] - a[1]).map(([k, v]) => `${STYLE_NAMES[k] ?? k} ${pct(v)}`).join(', ');
  const simBox = h('section', { class: 'd-section' },
    h('h3', { id: 'drawerSim' }, 'What you would have made'),
    h('form', { class: 'sim-controls', onsubmit: (ev) => { ev.preventDefault(); runSim(wallet, simBox); } },
      h('label', {}, 'Per trade ', h('span', { class: 'field-usd' }, h('span', {}, '$'), h('input', { name: 'size', type: 'number', min: '1', value: String(state.user?.sizeUsd ?? 25) }))),
      h('label', {}, 'Copy delay ', h('select', { name: 'delay' }, [2, 5, 10, 30].map((s) => h('option', { value: String(s), selected: s === (state.user?.delaySec ?? 5) }, `${s} seconds`)))),
      h('label', {}, 'Period ', h('select', { name: 'days' }, [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']].map(([v, l]) => h('option', { value: String(v), selected: v === 14 }, l)))),
      h('button', { class: 'btn', type: 'submit' }, 'Run')),
    h('div', { class: 'sim-out' }));
  const s = d.settings;
  const watched = state.watched.has(wallet);
  const settingsBox = h('section', { class: 'd-section' },
    h('h3', { id: 'drawerSettings' }, 'Copy settings for this wallet'),
    h('p', { class: 'lede' }, `Sized for your ${usd(s.capitalUsd)}. Names match GMGN’s copy-trade screen. GMGN’s boxes ask for amounts in its own unit; “Copy for GMGN” puts the right number on your clipboard.`),
    s.warnings.length ? h('div', { class: 'warn-box' }, s.warnings.map((w) => h('p', {}, w))) : null,
    h('ul', { class: 'settings' }, s.items.map((i) => h('li', {},
      h('div', { class: 'set-head' }, h('div', {}, h('div', { class: 'set-name' }, i.setting), h('div', { class: 'set-value' }, i.value)),
        isNum(i.gmgnInput) ? h('button', { class: 'btn small quiet', type: 'button', onclick: async (ev) => { await navigator.clipboard.writeText(String(i.gmgnInput)); ev.target.textContent = 'Copied'; } }, 'Copy for GMGN') : null),
      h('p', { class: 'set-simple' }, i.simple),
      h('p', { class: 'set-why' }, `Why: ${i.why}`)))),
    h('div', { class: 'd-actions' },
      watched
        ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { await api('/api/copy/unwatch', { wallet }); await loadDesk(); openWallet(wallet, 'settings'); } }, 'Stop copying this wallet')
        : h('button', { class: 'btn gold', type: 'button', onclick: async (ev) => { await api('/api/copy/watch', { wallet }); ev.target.textContent = 'Added to your copy desk'; ev.target.disabled = true; loadDesk(); } }, 'Copy this wallet on my desk'),
      h('a', { class: 'btn quiet', href: `https://gmgn.ai/sol/address/${wallet}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open on GMGN')),
    h('p', { class: 'lede', style: 'margin-top:8px' }, 'Adding it does not buy anything by itself. The copy desk mode decides: Off notes trades, Ask me first waits for your tap.'));
  clear(body).append(
    h('h2', { class: 'd-title', id: 'drawerTitle' }, ident?.twitter ? `@${ident.twitter}` : ident?.name || short(wallet)),
    h('p', { class: 'd-sub' }, wallet),
    h('div', { class: 'facts' },
      fact(isNum(p.coinsPerActiveDay) ? `${Math.round(p.coinsPerActiveDay * 10) / 10}` : '?', 'coins a day when it trades'),
      fact(duration(p.medianHoldSec), 'usual time before selling'),
      fact(`${p.wins} of ${p.closedCount}`, 'finished trades won'),
      fact(usd(p.realizedUsd), 'wallet made in this history', signClass(p.realizedUsd)),
      fact(usd(p.feesUsd), 'fees it paid'),
      fact(`${Math.round(p.spanDays ?? 0)} days`, 'of history read')),
    h('p', { class: 'lede', style: 'margin-top:12px' }, mix ? `Style: ${mix}.` : ''),
    h('section', { class: 'd-section' }, h('h3', {}, d.fit.fits ? 'Matches your style' : 'Differs from your style'),
      h('ul', {}, [...d.fit.good, ...d.fit.reasons].map((r) => h('li', {}, r)))),
    simBox,
    settingsBox,
  );
  runSim(wallet, simBox);
  if (focus === 'settings') $('drawerSettings').scrollIntoView({ block: 'start' });
  if (focus === 'simulate') $('drawerSim').scrollIntoView({ block: 'start' });
}

// ---------- boot
renderChips();
renderCoinTabs();
renderBoardTabs();
$('askForm').addEventListener('submit', (ev) => { ev.preventDefault(); const q = $('askInput').value.trim(); if (q) ask(q); });
await loadStatus();
loadSuggestions();
loadCoins();
loadDesk();
loadBoards();
