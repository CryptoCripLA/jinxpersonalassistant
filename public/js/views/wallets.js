// Explosive wallets: ranked by what a $25 follower could have banked per active day (SIMULATED
// on real GMGN prices, copy delay and every fee), with the coin's peak, the wallet's capture and
// your copy kept apart on every recent coin.
import { h, clear, api, icon, usd, usdShort, usdSigned, pct, mult, short, age, duration, isNum, signClass, label, toast, explainAttrs } from '../core.js';
import { traderCard, skippedList } from '../cards.js';

const FLAG_WORDS = {
  SNIPER_SPEED: 'Sells within 5 minutes: faster than a copy',
  DISTRIBUTOR: 'Sells far more than it buys',
  HIGH_WINRATE_SUS: 'Win rate too good to be real',
  LOW_ACTIVITY: 'Few finished trades',
  DORMANT: 'Inactive 14+ days',
};
const STEPS = [3, 5, 7, 10, 19];
const mults = (counts, key) => h('span', { class: 'mults', ...explainAttrs(key) }, STEPS.map((s) => h('i', { class: counts?.[s] ? 'on' : '', title: `${counts?.[s] ?? 0} at ${s}x or more` }, counts?.[s] ?? 0)));

function jobLine(j) {
  if (j?.running) return `Working: ${j.progress?.phase ?? ''} ${j.progress?.total ? `${j.progress.done}/${j.progress.total}` : ''}`;
  if (j?.last) return j.last.error ? `Last research run failed: ${j.last.error}` : `Last research run (${j.last.kind}) finished ${new Date(j.last.at).toLocaleString()}.`;
  return '';
}

export async function openWallets(root, hooks) {
  hooks.setContext({ view: 'wallets', coin: null });
  clear(root).append(h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  const [rows, jobs, today] = await Promise.all([api('/api/wallets/explosive'), api('/api/jobs').catch(() => null), api('/api/today').catch(() => null)]);
  const status = h('span', { class: 'faint' }, jobLine(jobs));
  const runBtn = (kind, text) => h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('/api/jobs', { kind }); toast('Research started. It runs in the background; this page updates when you reopen it.'); status.textContent = 'Working…'; } catch (e) { toast(e.message); } } }, icon('refresh'), text);
  const picks = today?.traders?.picks ?? [];
  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', explainAttrs('wallets.board'), 'Traders for you'), h('p', {}, 'I research wallets that keep catching big moves, replay their recent trades with your trade size, a few seconds late and after every fee, and recommend only the ones that fit your style.')),
      h('div', { class: 'actions' }, status, runBtn('discover', 'Find more traders'), runBtn('wallets', 'Re-measure'))),
    h('div', { class: 'recs' }, picks.length ? picks.map((p) => traderCard(p, hooks, { targetUsd: today.prefs.dailyTargetUsd })) : h('p', { class: 'empty' }, 'No measured trader fits your style yet. Research keeps adding traders; you can widen your style on Today.')),
    today ? skippedList(today.traders.skipped ?? [], hooks) : null);
  const details = h('details', { class: 'more' }, h('summary', {}, `All ${rows.length} measured wallets (detailed table)`));
  page.append(details);
  if (!rows.length) {
    page.append(h('p', { class: 'empty' }, 'No wallet has been measured yet. Press "Re-measure" to start; each wallet takes about 20 seconds at your GMGN plan\'s speed.'));
    clear(root).append(page);
    return;
  }
  const measured = rows.length;
  const explosive = rows.filter((r) => r.isExplosive).length;
  details.append(h('p', { class: 'summary-line' }, `${measured} wallets measured; ${explosive} handed a follower at least one 3x copy. `, label('SIMULATED'), ' ', label('HISTORICAL')));
  details.append(h('table', { class: 'grid' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Wallet'),
      h('th', { class: 'n', ...explainAttrs('wallets.perday') }, 'Your $ per active day'),
      h('th', { class: 'n', ...explainAttrs('wallets.follower') }, 'Your copies (net)'),
      h('th', explainAttrs('wallets.found'), 'Coin went 3/5/7/10/19x+'),
      h('th', explainAttrs('wallets.captured'), 'Wallet sold 3/5/7/10/19x+'),
      h('th', explainAttrs('wallets.follower'), 'You caught 3/5/7/10/19x+'),
      h('th', { class: 'n', ...explainAttrs('wallets.edge') }, 'Edge kept'),
      h('th', { class: 'n', ...explainAttrs('wallets.losses') }, 'Losses'),
      h('th', { class: 'n' }, 'Coins/day'),
      h('th', { class: 'n' }, 'Last trade'),
      h('th', explainAttrs('wallets.flags'), 'Warnings'))),
    h('tbody', {}, rows.map((r) => {
      const e = r.explosive;
      return h('tr', { class: 'click', onclick: () => hooks.openWallet(r.wallet) },
        h('td', {}, h('button', { class: 'wl', type: 'button' }, r.name || short(r.wallet)), r.isExplosive ? h('span', { class: 'chip exp', style: { marginLeft: '6px' } }, icon('bolt')) : null),
        h('td', { class: `n ${signClass(r.perActiveDayUsd)}` }, usdSigned(r.perActiveDayUsd)),
        h('td', { class: `n ${signClass(e.followerNetUsd)}` }, `${usdSigned(e.followerNetUsd)} `, h('span', { class: 'faint' }, `(${e.followerWins}W ${e.followerLosses}L)`)),
        h('td', {}, mults(e.found, 'wallets.found')),
        h('td', {}, mults(e.captured, 'wallets.captured')),
        h('td', {}, mults(e.followerCaptured, 'wallets.follower')),
        h('td', { class: 'n' }, isNum(e.edgeKeptPct) ? `${Math.round(e.edgeKeptPct)}%` : 'n/a'),
        h('td', { class: 'n' }, `${e.losses}/${e.trades}`),
        h('td', { class: 'n' }, isNum(r.coinsPerActiveDay) ? Math.round(r.coinsPerActiveDay * 10) / 10 : 'n/a'),
        h('td', { class: 'n faint' }, isNum(r.lastTs) ? `${age(Date.now() / 1000 - r.lastTs)} ago` : ''),
        h('td', {}, (r.flags ?? []).filter((f) => f !== 'LOW_ACTIVITY').map((f) => h('span', { class: 'flag', title: FLAG_WORDS[f] }, FLAG_WORDS[f] ?? f))));
    }))));
  clear(root).append(page);
}

function ladder(o, size) {
  const vals = [['peak', o.tokenMaxMultiple, 'coin high'], ['took', o.walletCaptured, 'wallet sold'], ['you', o.followerCaptured, `your $${size}`]];
  const top = Math.max(1, ...vals.map(([, v]) => (isNum(v) ? v : 0)));
  return h('div', { class: 'ladder' }, vals.map(([cls, v, k]) => h('div', { class: cls },
    h('span', {}, isNum(v) ? mult(v) : 'n/a'),
    h('b', { style: { height: `${isNum(v) ? Math.max(3, Math.round((Math.log1p(Math.max(0, v)) / Math.log1p(top)) * 30)) : 2}px` } }),
    h('span', {}, k))));
}

export async function openWallet(root, wallet, hooks) {
  hooks.setContext({ view: 'wallet', wallet, coin: null });
  clear(root).append(h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('p', { class: 'faint' }, 'Reading this wallet from GMGN…')));
  let d;
  try {
    d = await api(`/api/wallet/${wallet}`);
  } catch (e) {
    clear(root).append(h('div', { class: 'page' }, h('p', {}, `Could not read this wallet: ${e.message}`)));
    return;
  }
  const p = d.profile;
  const x = d.explosive;
  const ident = p.gmgn30?.identity;
  const name = ident?.twitter ? `@${ident.twitter}` : ident?.name || short(wallet);
  const measureBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
    measureBtn.disabled = true;
    measureBtn.textContent = 'Measuring (about 20 s)…';
    try {
      await api('/api/wallet/measure', { wallet });
      openWallet(root, wallet, hooks);
    } catch (e) {
      toast(e.message);
      measureBtn.disabled = false;
    }
  } }, icon('refresh'), x ? 'Re-measure' : 'Measure explosive trades');
  const copyBtn = h('button', { class: 'btn gold small', type: 'button', ...explainAttrs('wallet.copy'), onclick: async () => {
    try {
      await api('/api/copy/watch', { wallet });
      copyBtn.textContent = 'On your copy desk';
      copyBtn.disabled = true;
      toast('Added to your copy desk. The desk mode decides whether it trades.');
    } catch (e) {
      toast(e.message);
    }
  } }, 'Copy on my desk');
  const page = h('div', { class: 'page wallet-page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, name), h('p', { class: 'faint' }, wallet)),
      h('div', { class: 'actions' }, measureBtn, h('a', { class: 'btn small', href: `https://gmgn.ai/sol/address/${wallet}`, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), 'GMGN'))));
  if (d.card) {
    const card = traderCard(d.card, hooks, {});
    page.append(card, h('section', { class: 'behavior' },
      h('h2', {}, 'How this trader behaves ', label('HISTORICAL')),
      h('ul', { class: 'reasons' }, Object.values(d.card.behavior ?? {}).map((b) => h('li', {}, b))),
      d.card.fit.good.length ? h('p', { class: 'rec-sub' }, d.card.fit.good.join(' ')) : null));
    if (sessionStorage.getItem('openCopy') === wallet) {
      sessionStorage.removeItem('openCopy');
      setTimeout(() => card.querySelector('.btn.primary')?.click(), 50);
    }
  } else {
    page.append(copyBtn);
  }
  if (x) {
    const e = x.explosive;
    page.append(
      h('div', { class: 'stats' },
        stat(usdSigned(e.followerNetUsd), `your $${x.sizeUsd} copies over ${x.periodDays} days`, 'wallets.follower', signClass(e.followerNetUsd)),
        stat(`${e.followerCaptured[3]} / ${e.followerCaptured[5]} / ${e.followerCaptured[10]}`, 'copies that caught 3x / 5x / 10x', 'wallets.follower'),
        stat(`${e.found[7]} / ${e.found[10]} / ${e.found[19]}`, 'buys that ran 7x / 10x / 19x', 'wallets.found'),
        stat(isNum(e.edgeKeptPct) ? `${Math.round(e.edgeKeptPct)}%` : 'n/a', 'edge kept after copy delay', 'wallets.edge'),
        stat(pct(e.medianCaptureShare), 'of each move it usually captures', 'wallets.captured'),
        stat(duration(e.medianHoldSec), 'usual hold', 'wallets.captured'),
        stat(usdShort(e.medianEntryMcapUsd), 'usual entry market cap', 'early.entry'),
        stat(`${e.losses} of ${e.trades}`, 'trades lost money', 'wallets.losses')),
      x.flags?.length ? h('p', { class: 'flag' }, x.flags.map((f) => FLAG_WORDS[f] ?? f).join(' · ')) : null,
      h('h2', { style: { fontSize: '15px', marginTop: '6px' }, ...explainAttrs('wallet.last') }, 'Recent coins, newest first ', label('HISTORICAL'), ' ', label('SIMULATED')),
      h('div', { class: 'outcomes' }, [...x.outcomes].sort((a, b) => b.entryTs - a.entryTs).slice(0, 20).map((o) => h('div', { class: 'outcome' },
        h('h4', {}, h('button', { class: 'wl', type: 'button', onclick: () => hooks.openCoin(o.token) }, o.symbol || short(o.token)), h('span', { class: 'faint', style: { fontWeight: 400, fontSize: '12px' } }, new Date(o.entryTs * 1000).toLocaleString())),
        ladder(o, x.sizeUsd),
        h('div', { class: 'ln' }, h('span', {}, 'Bought at market cap'), h('span', {}, usdShort(o.entryMcapUsd))),
        h('div', { class: 'ln' }, h('span', {}, 'Coin high within 8 h'), h('span', {}, isNum(o.peakMcapUsd) ? `${usdShort(o.peakMcapUsd)} after ${duration(o.timeToPeakSec)}` : 'n/a')),
        h('div', { class: 'ln' }, h('span', {}, 'Wallet held'), h('span', {}, o.status === 'closed' ? duration(o.holdSec) : 'still holding')),
        h('div', { class: 'ln' }, h('span', {}, 'Missed upside'), h('span', {}, isNum(o.missedUpside) ? `${mult(o.missedUpside)} more was there` : 'n/a')),
        h('div', { class: 'ln' }, h('span', {}, `Your $${x.sizeUsd} copy`), h('span', { class: signClass(o.followerNetUsd) }, o.followerNetUsd != null ? `${usdSigned(o.followerNetUsd)} → ${usd(x.sizeUsd + o.followerNetUsd)}` : o.followerNote || 'n/a'))))));
  } else {
    page.append(h('p', { class: 'summary-line' }, 'This wallet has not been measured for explosive trades yet. Press "Measure explosive trades": it replays its recent coins on real GMGN prices.'));
  }
  page.append(h('div', { class: 'stats' },
    stat(isNum(p.coinsPerActiveDay) ? `${Math.round(p.coinsPerActiveDay * 10) / 10}` : 'n/a', 'coins a day when it trades'),
    stat(`${p.wins} of ${p.closedCount}`, 'finished trades won'),
    stat(usd(p.realizedUsd), 'wallet made in this history (HISTORICAL)', null, signClass(p.realizedUsd)),
    stat(`${Math.round(p.spanDays ?? 0)} days`, 'of history read'),
    p.gmgn30?.returnBuckets ? stat(`${p.gmgn30.returnBuckets.over5x ?? 0}`, 'coins above 5x in 30 days (GMGN)') : null));
  clear(root).append(page);
}

function stat(v, k, key = null, cls = '') {
  return h('div', { class: 'stat', ...(key ? explainAttrs(key, v) : {}) }, h('div', { class: `v ${cls}` }, v), h('div', { class: 'k' }, k));
}
