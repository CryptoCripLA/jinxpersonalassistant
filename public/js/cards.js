// Recommendation cards (layout pinned by the owner's mockup): a titled card, a two-by-two of
// facts, "Why I picked this", a filled primary action and an outlined Explain action.
import { add, h, clear, api, icon, logo, usd, usdWhole, usdShort, usdSigned, duration, age, isNum, signClass, label, toast, explainAttrs, short } from './core.js';

const FIT = { fits: ['Fits your style', 'fit-ok'], close: ['Close match', 'fit-close'], no: ['Does not fit', 'fit-no'] };
const nameOf = (p) => p.name || short(p.wallet);

function fact(k, v, cls = '', key = null) {
  return h('div', { class: 'fact', ...(key ? explainAttrs(key, v) : {}) }, h('span', { class: 'fk' }, k), h('span', { class: `fv ${cls}` }, v));
}

export function traderCard(p, hooks, { targetUsd = null } = {}) {
  const [fitText, fitCls] = FIT[p.fit.level] ?? FIT.no;
  const card = h('article', { class: 'rec' });
  const panel = h('div', { class: 'copy-panel', hidden: true });
  const copyBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => openCopyPanel(panel, p, hooks, copyBtn) }, 'Copy this trader');
  add(card, 
    h('header', { class: 'rec-head' },
      h('div', {}, h('h3', {}, h('button', { class: 'wl', type: 'button', onclick: () => hooks.openWallet(p.wallet) }, nameOf(p))), h('p', { class: 'rec-type' }, p.type.label)),
      h('span', { class: `fit ${fitCls}`, ...explainAttrs('wallets.board', fitText) }, fitText)),
    h('div', { class: 'facts' },
      fact('Coins per day', isNum(p.coinsPerDay) ? `${Math.round(p.coinsPerDay * 10) / 10}` : 'n/a', '', 'wallets.perday'),
      fact('Usually holds', duration(p.holdSec)),
      fact('Last active', isNum(p.lastActiveSec) ? `${duration(p.lastActiveSec)} ago` : 'n/a'),
      fact(`Your $${p.copy.sizeUsd} copies`, `${usdSigned(p.copy.netUsd)} net`, signClass(p.copy.netUsd), 'wallets.follower')),
    h('p', { class: 'rec-sub' }, label('SIMULATED'), ` Last ${p.copy.trades} trades, ${p.copy.wins ?? 0} won and ${p.copy.losses ?? 0} lost, after fees and copy delay.`),
    h('p', { class: 'why' }, h('b', {}, 'Why I picked this trader: '), p.why),
    p.exits?.trades ? h('p', { class: 'rec-sub' }, h('b', {}, 'Exits: '), p.exits.text) : null,
    isNum(targetUsd) && p.days?.activeDays ? h('p', { class: 'rec-sub' }, `Would have reached your ${usdWhole(targetUsd)} target on ${p.days.hitDays} of ${p.days.activeDays} active days (a typical day ${usdSigned(p.days.medianDayUsd)}).`) : null,
    p.fit.reasons.length ? h('p', { class: 'rec-diff' }, h('b', {}, 'Differences from your style: '), p.fit.reasons.join(' ')) : null,
    h('div', { class: 'rec-actions' }, copyBtn, h('button', { class: 'btn outline', type: 'button', onclick: () => hooks.explainWallet(p.wallet) }, 'Explain why')),
    panel);
  return card;
}

async function openCopyPanel(panel, p, hooks, btn) {
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  add(clear(panel), h('p', { class: 'faint' }, 'Reading this trader\'s copy settings…'));
  let d;
  try {
    d = await api(`/api/wallet/${p.wallet}`);
  } catch (e) {
    add(clear(panel), h('p', { class: 'down' }, e.message));
    return;
  }
  let mode = 'watch';
  const radios = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'How copies should buy', ...explainAttrs('desk.mode') },
    [['watch', 'Watch first (recommended)', 'No money: I note every trade it makes and what your copy would have done. Watch a week or two before scaling.'], ['confirm', 'Ask me first', 'Each copy waits for your tap and expires after 45 seconds.'], ['auto', 'Automatic', 'Buys on its own inside your limits. Needs the server switch.']].map(([m, t, sub]) =>
      h('label', { class: 'mode-opt' }, h('input', { type: 'radio', name: `mode-${p.wallet}`, value: m, checked: m === mode, onchange: () => (mode = m) }), h('span', {}, h('b', {}, t), h('small', {}, sub)))));
  const items = (d.settings?.items ?? []).slice(0, 6);
  const status = h('p', { class: 'status-line' });
  const start = h('button', { class: 'btn primary', type: 'button' }, `Start copying ${nameOf(p)}`);
  start.addEventListener('click', async () => {
    const body = { wallet: p.wallet, mode };
    if (mode === 'auto') {
      const t = prompt('Automatic copying buys with real money without asking you each time, inside your limits.\nType AUTO to switch it on.');
      if (t !== 'AUTO') return;
      body.confirmText = 'AUTO';
    }
    start.disabled = true;
    try {
      const r = await api('/api/copy/start', body);
      const autoOff = mode === 'auto' && !r.automaticSwitch;
      status.className = 'status-line';
      status.textContent = mode === 'watch'
        ? `Watching ${nameOf(p)}: every trade it makes is noted on the Copy desk with what your copy would have done. No money is spent.`
        : autoOff
          ? `Copying ${nameOf(p)}. Automatic is chosen, but the server switch is off, so each copy still waits for your tap until it is turned on.`
          : `Copying ${nameOf(p)} in ${mode === 'auto' ? 'Automatic' : 'Ask me first'} mode with $${r.settings?.sizeUsd ?? ''} a trade${r.settings?.hardStopPct ? ` and your hard stop at -${r.settings.hardStopPct}%` : ''}. Approvals appear in the analyst panel.`;
      btn.textContent = mode === 'watch' ? 'Watching' : 'Copying';
      btn.disabled = true;
      toast(`Now copying ${nameOf(p)}`);
      hooks.onCopied?.(p.wallet);
    } catch (e) {
      status.className = 'status-line err';
      status.textContent = e.message;
      start.disabled = false;
    }
  });
  add(clear(panel), 
    h('h4', {}, 'How copying works for this trader'),
    radios,
    h('ul', { class: 'settings-plain' }, items.map((i) => h('li', {}, h('b', {}, `${i.setting}: `), i.value, h('span', { class: 'faint' }, ` — ${i.simple}`)))),
    d.settings?.warnings?.length ? h('p', { class: 'rec-diff' }, d.settings.warnings.join(' ')) : null,
    h('div', { class: 'rec-actions' }, start, h('button', { class: 'btn outline', type: 'button', onclick: () => (panel.hidden = true) }, 'Cancel')),
    status);
}

export function checkList(checks) {
  if (!checks?.checks?.length) return null;
  return h('ul', { class: 'checks', ...explainAttrs('coin.safety') }, checks.checks.map((c) => h('li', { class: c.ok === true ? 'ok' : c.ok === false ? (c.hard ? 'bad' : 'warn') : 'unk' }, icon(c.ok === true ? 'check' : c.ok === false ? 'x' : 'minus'), c.text)));
}

export function opportunityCard(o, hooks, { sizeUsd = 25 } = {}) {
  const m = o.momentum ?? {};
  return h('article', { class: `rec opp ${o.kind}` },
    h('header', { class: 'rec-head' },
      h('div', { class: 'opp-title' }, logo(o.logo, o.symbol), h('div', {}, h('h3', {}, h('button', { class: 'wl', type: 'button', onclick: () => hooks.openCoin(o.address) }, o.symbol)), h('p', { class: 'rec-type' }, `${usdShort(o.marketCapUsd)} market cap · ${age(o.ageSec)} old`))),
      h('span', { class: `stage-chip ${m.stage}`, ...explainAttrs('coin.stage', m.stage) }, `${o.kind === 'migration' ? 'Migration · ' : ''}${m.stage} · ${m.score}`)),
    h('ul', { class: 'reasons' }, o.evidence.slice(0, 4).map((e) => h('li', { class: /^Risk/.test(e) ? 'risk' : '' }, e))),
    checkList(o.checks),
    o.walletsIn?.length ? h('p', { class: 'rec-sub' }, icon('bolt'), ` Your traders in it: ${o.walletsIn.map((w) => w.name || short(w.wallet)).join(', ')}`) : null,
    h('div', { class: 'facts' },
      fact('Realistic for a follower', o.realistic.multiple ? `${o.realistic.multiple}x → ${usdSigned(o.realistic.netUsd)}` : 'n/a', signClass(o.realistic.netUsd), 'history.follower'),
      fact('If it ran a full 10x', `${usdSigned(o.theoretical.netUsd)}`, 'faint-v', 'coin.scenario')),
    h('p', { class: 'why' }, o.realistic.text, ' ', o.theoretical.text, ' ', label('SIMULATED')),
    o.targetText ? h('p', { class: 'rec-sub' }, o.targetText) : null,
    h('p', { class: 'rec-sub' }, h('b', {}, 'Entry: '), o.entry, ' ', h('b', {}, 'Exit: '), o.exit),
    h('div', { class: 'rec-actions' },
      h('button', { class: 'btn buy', type: 'button', onclick: () => hooks.openCoin(o.address) }, `Open and buy $${sizeUsd}`),
      h('button', { class: 'btn outline', type: 'button', onclick: () => hooks.explainCoin(o.address, o.symbol) }, 'Explain')));
}

export function skippedList(skipped, hooks) {
  const notable = skipped.filter((s) => (s.copy?.netUsd ?? 0) > 0).slice(0, 3);
  if (!notable.length) return null;
  return h('div', { class: 'skipped' },
    h('h4', {}, 'High earners I did not recommend'),
    h('ul', {}, notable.map((s) => h('li', {},
      h('button', { class: 'wl', type: 'button', onclick: () => hooks.openWallet(s.wallet) }, s.name || short(s.wallet)),
      ` (${usdSigned(s.copy.netUsd)} copy result): `, s.reasons[0]))));
}
