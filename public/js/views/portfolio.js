// Portfolio (LIVE from GMGN) and the copy desk (ported from the first version, same controls).
import { h, clear, api, usd, usdSigned, pct, short, isNum, signClass, label, toast, explainAttrs } from '../core.js';

const ORDER_WORDS = { sending: 'sending', submitted: 'sent, waiting for the chain', confirmed: 'filled', failed: 'failed', unknown: 'unknown (check GMGN, not re-sent)' };

export async function openPortfolio(root, hooks) {
  hooks.setContext({ view: 'portfolio', coin: null });
  clear(root).append(h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  let p;
  try {
    p = await api('/api/portfolio');
  } catch (e) {
    clear(root).append(h('div', { class: 'page' }, h('p', {}, `Portfolio unavailable: ${e.message}`)));
    return;
  }
  const open = p.holdings.filter((x) => x.open);
  const closed = p.holdings.filter((x) => !x.open);
  const holdTable = (list) => h('table', { class: 'grid' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Coin'), h('th', { class: 'n' }, 'Value now'), h('th', { class: 'n' }, 'Cost left'), h('th', { class: 'n' }, 'Bought'), h('th', { class: 'n' }, 'Sold'), h('th', { class: 'n', ...explainAttrs('portfolio.realized') }, 'Realized'), h('th', { class: 'n', ...explainAttrs('portfolio.unrealized') }, 'Unrealized'), h('th', { class: 'n' }, 'Total'), h('th', { class: 'n' }, 'Trades'))),
    h('tbody', {}, list.map((x) => h('tr', { class: 'click', onclick: () => x.token && hooks.openCoin(x.token) },
      h('td', {}, h('button', { class: 'wl', type: 'button' }, x.symbol || short(x.token))),
      h('td', { class: 'n' }, usd(x.valueUsd)),
      h('td', { class: 'n' }, usd(x.costUsd)),
      h('td', { class: 'n faint' }, usd(x.boughtUsd)),
      h('td', { class: 'n faint' }, usd(x.soldUsd)),
      h('td', { class: `n ${signClass(x.realizedUsd)}` }, usdSigned(x.realizedUsd)),
      h('td', { class: `n ${signClass(x.unrealizedUsd)}` }, usdSigned(x.unrealizedUsd)),
      h('td', { class: `n ${signClass(x.totalUsd)}` }, `${usdSigned(x.totalUsd)} `, h('span', { class: 'faint' }, isNum(x.totalPct) ? `(${pct(x.totalPct)})` : '')),
      h('td', { class: 'n faint' }, `${x.buys ?? 0} / ${x.sells ?? 0}`)))));
  clear(root).append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', explainAttrs('nav.portfolio'), 'Portfolio ', label('LIVE')), h('p', {}, `Your GMGN wallet ${p.account?.address ? short(p.account.address) : ''}. ${p.account?.rateLine ?? ''}`))),
    h('div', { class: 'totals' },
      stat(usd(p.account?.totalUsd), 'cash in the wallet', 'shell.balance'),
      stat(usd(p.totals?.valueUsd), 'coins held, valued now', 'portfolio.holdings'),
      stat(usdSigned(p.totals?.realizedUsd), 'realized profit (these coins)', 'portfolio.realized', signClass(p.totals?.realizedUsd)),
      stat(usdSigned(p.totals?.unrealizedUsd), 'unrealized profit', 'portfolio.unrealized', signClass(p.totals?.unrealizedUsd))),
    p.error ? h('p', { class: 'down' }, `GMGN holdings unavailable: ${p.error}`) : null,
    h('h2', { style: { fontSize: '15px', margin: '8px 0' }, ...explainAttrs('portfolio.holdings') }, `Open positions (${open.length})`),
    open.length ? holdTable(open) : h('p', { class: 'empty' }, 'No open coins.'),
    h('h2', { style: { fontSize: '15px', margin: '18px 0 8px' } }, `Closed recently (${closed.length})`),
    closed.length ? holdTable(closed.slice(0, 25)) : h('p', { class: 'empty' }, 'Nothing closed yet.'),
    h('h2', { style: { fontSize: '15px', margin: '18px 0 8px' }, ...explainAttrs('portfolio.orders') }, 'Orders from this terminal'),
    p.orders.length
      ? h('table', { class: 'grid' }, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Side'), h('th', {}, 'Coin'), h('th', {}, 'Status'), h('th', { class: 'n' }, 'Dollars'), h('th', {}, 'Detail'))),
        h('tbody', {}, p.orders.map((o) => h('tr', {},
          h('td', { class: 'faint' }, new Date(o.created_at).toLocaleString()),
          h('td', { class: o.side === 'buy' ? 'up' : 'down' }, o.side === 'buy' ? 'Buy' : 'Sell'),
          h('td', {}, h('button', { class: 'wl', type: 'button', onclick: () => hooks.openCoin(o.token) }, o.symbol || short(o.token))),
          h('td', {}, ORDER_WORDS[o.state] ?? o.state),
          h('td', { class: 'n' }, o.side === 'buy' ? usd(o.detail.paidUsd ?? o.detail.payUsd) : usd(o.detail.gotUsd ?? o.detail.receiveUsd)),
          h('td', { class: 'faint' }, o.detail.reason ?? (o.tx_hash ? h('a', { href: `https://solscan.io/tx/${o.tx_hash}`, target: '_blank', rel: 'noopener noreferrer' }, 'transaction') : ''))))))
      : h('p', { class: 'empty' }, 'No orders sent from this terminal yet.')));
}

function stat(v, k, key, cls = '') {
  return h('div', { class: 'stat', ...explainAttrs(key, v) }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'k' }, k));
}

// ---------- copy desk
const MODE_HELP = {
  off: 'Off: it only notes what it would have copied. Sells of copies it already opened still follow the wallet.',
  confirm: 'Ask me first: each copy waits for your tap here and expires after 45 seconds.',
  auto: 'Automatic: copies on its own inside your limits.',
};
const STATE_WORDS = { observed: 'would have copied (desk off)', skipped: 'skipped', awaiting_approval: 'waiting for you', approved: 'approved', checking: 'checking', sending: 'sending', submitted: 'sent', confirmed: 'filled', failed: 'failed', unknown: 'unknown (check GMGN)', expired: 'expired', rejected: 'you said no' };
let deskTimer = null;

export async function openDesk(root, hooks) {
  hooks.setContext({ view: 'desk', coin: null });
  clearTimeout(deskTimer);
  let d;
  try {
    d = await api('/api/copy');
  } catch (e) {
    clear(root).append(h('div', { class: 'page' }, h('p', {}, `Copy desk unavailable: ${e.message}`)));
    return;
  }
  const mode = d.config.mode;
  let help = MODE_HELP[mode];
  if (mode === 'auto' && !d.autoSwitch) help += ' The operator switch is not set on the server, so for now it still asks you.';
  if (d.config.pausedReason) help = `${d.config.pausedReason} ${help}`;
  const setMode = async (m) => {
    const body = { mode: m };
    if (m === 'auto') {
      const t = prompt('Automatic copying buys with real money without asking you each time, inside your limits.\nType AUTO to switch it on.');
      if (t !== 'AUTO') return;
      body.confirmText = 'AUTO';
    }
    try {
      await api('/api/copy/mode', body);
    } catch (e) {
      toast(e.message);
    }
    openDesk(root, hooks);
  };
  const limits = h('form', { class: 'limits', onsubmit: async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    await api('/api/copy/limits', { perTradeUsd: Number(f.perTradeUsd.value), maxDailyUsd: Number(f.maxDailyUsd.value), maxOpen: Number(f.maxOpen.value) });
    toast('Limits saved');
    openDesk(root, hooks);
  } },
    h('label', { class: 'field' }, 'Max per trade $', h('input', { name: 'perTradeUsd', type: 'number', min: '1', value: String(d.config.limits.perTradeUsd) })),
    h('label', { class: 'field' }, 'Max per day $', h('input', { name: 'maxDailyUsd', type: 'number', min: '1', value: String(d.config.limits.maxDailyUsd) })),
    h('label', { class: 'field' }, 'Open copies at once', h('input', { name: 'maxOpen', type: 'number', min: '1', max: '20', value: String(d.config.limits.maxOpen) })),
    h('button', { class: 'btn small', type: 'submit' }, 'Save limits'));
  const now = Date.now();
  const waiting = d.intents.filter((i) => i.state === 'awaiting_approval');
  clear(root).append(h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', explainAttrs('nav.desk'), 'Copy desk'), h('p', {}, 'Follows wallets you chose and turns their trades into your orders through GMGN.'))),
    h('div', { class: 'desk-grid' },
      h('section', {},
        h('h3', explainAttrs('desk.mode', mode), 'Mode'),
        h('div', { class: 'mode', role: 'radiogroup' }, [['off', 'Off'], ['confirm', 'Ask me first'], ['auto', 'Automatic']].map(([m, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(m === mode), onclick: () => setMode(m) }, l))),
        h('p', { class: 'muted', style: { fontSize: '12.5px', marginBottom: '10px' } }, help),
        limits),
      h('section', {},
        h('h3', {}, `Waiting for you (${waiting.length})`),
        h('ul', { class: 'list' }, waiting.length ? waiting.map((i) => h('li', {},
          h('span', {}, `Buy ${usd(i.detail.sizeUsd)} of ${i.symbol || 'a coin'} (wallet ${short(i.wallet)} spent ${usd(i.detail.walletSpentUsd)})`),
          h('span', { class: 'faint' }, `${Math.max(0, Math.round((i.detail.expiresAt - now) / 1000))}s`),
          h('span', {},
            h('button', { class: 'btn small buy', type: 'button', onclick: () => api('/api/copy/approve', { id: i.id }).then(() => openDesk(root, hooks)).catch((e) => toast(e.message)) }, 'Approve'), ' ',
            h('button', { class: 'btn small', type: 'button', onclick: () => api('/api/copy/reject', { id: i.id }).then(() => openDesk(root, hooks)) }, 'Skip')))) : h('li', { class: 'faint' }, 'Nothing to approve.'))),
      h('section', {},
        h('h3', {}, 'Wallets you copy'),
        h('ul', { class: 'list' }, d.watches.length ? d.watches.map((w) => h('li', {},
          h('button', { class: 'wl', type: 'button', onclick: () => hooks.openWallet(w.wallet) }, short(w.wallet)),
          h('span', { class: 'faint' }, `${usd(w.settings.sizeUsd)} a copy`),
          h('button', { class: 'btn small sell', type: 'button', onclick: () => api('/api/copy/unwatch', { wallet: w.wallet }).then(() => openDesk(root, hooks)) }, 'Stop'))) : h('li', { class: 'faint' }, 'No wallets yet. Open an explosive wallet and press "Copy on my desk".'))),
      h('section', {},
        h('h3', {}, 'Open copies ', label('LIVE')),
        h('ul', { class: 'list' }, d.positions.length ? d.positions.map((p) => h('li', {}, h('span', {}, p.symbol || short(p.token)), h('span', { class: 'faint' }, `cost ${usd(p.cost_usd)}`), h('span', { class: signClass(p.realized_usd) }, `sold so far ${usdSigned(p.realized_usd)}`))) : h('li', { class: 'faint' }, 'No open copies.'))),
      h('section', { style: { gridColumn: '1 / -1' } },
        h('h3', {}, 'What the desk did'),
        h('ul', { class: 'list' }, d.intents.length ? d.intents.slice(0, 30).map((i) => h('li', {}, h('span', { class: 'faint' }, new Date(i.created_at).toLocaleTimeString()), h('span', {}, `${i.side === 'buy' ? 'Buy' : 'Sell'} ${i.symbol || ''}: ${STATE_WORDS[i.state] ?? i.state}`), h('span', { class: 'faint' }, i.detail.reason ?? ''))) : h('li', { class: 'faint' }, 'Nothing yet.'))))));
  const again = () => {
    if (!location.hash.startsWith('#/desk')) return;
    if (root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') deskTimer = setTimeout(again, 2000);
    else openDesk(root, hooks);
  };
  deskTimer = setTimeout(again, waiting.length ? 1000 : 5000);
}

