// Today: the home screen. Opens already researched: account, today's target and the plan,
// the traders I recommend, the opportunities right now, and what I skipped and why.
import { h, clear, api, icon, usd, duration, isNum, toast, explainAttrs } from '../core.js';
import { traderCard, opportunityCard, skippedList } from '../cards.js';

let timer = null;

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Working late.' : hr < 12 ? 'Good morning.' : hr < 18 ? 'Good afternoon.' : 'Good evening.';
}

function accountLine(a) {
  if (!a) return null;
  const bits = [
    h('span', explainAttrs('shell.balance', usd(a.cashUsd)), 'Cash ', h('b', { class: 'money' }, usd(a.cashUsd))),
    h('span', {}, 'Available to trade ', h('b', {}, usd(a.availableUsd))),
    h('span', explainAttrs('nav.desk', a.copy.mode), 'Copy desk ', h('b', {}, a.copy.mode === 'off' ? 'Off' : a.copy.mode === 'confirm' ? 'Ask me first' : 'Automatic'), `, copying ${a.copy.watching}`),
    h('span', explainAttrs('shell.live'), 'GMGN ', h('b', { class: a.gmgnPausedUntil ? 'down' : 'up' }, a.gmgnPausedUntil ? 'pausing us' : a.connected ? 'connected' : 'not connected')),
  ];
  const notes = [];
  if (a.stale) notes.push(`Balance from ${new Date(a.asOf).toLocaleTimeString()}: GMGN did not answer just now (${a.staleReason}).`);
  if (a.gmgnPausedUntil) notes.push(`GMGN asked us to slow down until ${new Date(a.gmgnPausedUntil).toLocaleTimeString()}. Requests resume on their own, one at a time.`);
  return h('div', { class: 'acct' }, h('div', { class: 'acct-row' }, bits), notes.map((n) => h('p', { class: 'faint acct-note' }, n)));
}

function prefsPanel(p, onSaved) {
  const box = h('details', { class: 'prefs' });
  const field = (k, labelText, v, attrs = {}) => h('label', { class: 'pf' }, h('span', {}, labelText), h('input', { name: k, type: 'number', value: v ?? '', step: 'any', ...attrs }));
  const form = h('form', { class: 'prefs-form', onsubmit: async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const body = Object.fromEntries([...f.entries()].filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'exitTps' ? v : Number(v)]));
    body.useExitPlan = f.get('useExitPlan') ? 1 : 0;
    try {
      await api('/api/prefs', body);
      toast('Saved. Recommendations update with your new style.');
      onSaved();
    } catch (e) {
      toast(e.message);
    }
  } },
    field('sizeUsd', 'Dollars per trade', p.sizeUsd, { min: 1 }),
    field('minCoinsPerDay', 'Fewest coins a day', p.minCoinsPerDay, { min: 0.5 }),
    field('maxCoinsPerDay', 'Most coins a day', p.maxCoinsPerDay, { min: 0.5 }),
    field('maxHoldMin', 'Longest hold (minutes)', p.maxHoldMin, { min: 1 }),
    field('targetMultipleLow', 'Moves I hunt, from (x)', p.targetMultipleLow, { min: 1.5 }),
    field('targetMultipleHigh', 'up to (x)', p.targetMultipleHigh, { min: 1.5 }),
    h('label', { class: 'pf' }, h('span', {}, 'Take profits (multiple:percent)'), h('input', { name: 'exitTps', type: 'text', value: p.exitTps ?? '', placeholder: '2:30,3:30,5:20' })),
    field('trailDrawdownPct', 'Trailing stop: sell the rest after a drop of (%)', p.trailDrawdownPct, { min: 5, max: 90 }),
    field('hardStopPct', 'Hard stop: sell everything after a loss of (%)', p.hardStopPct, { min: 5, max: 95 }),
    h('label', { class: 'pf pf-check' }, h('input', { name: 'useExitPlan', type: 'checkbox', value: '1', checked: p.useExitPlan }), h('span', {}, 'Attach this exit plan to every buy')),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save my style'));
  box.append(h('summary', {}, h('b', {}, 'Your style: '), `$${p.sizeUsd} a trade · ${p.minCoinsPerDay}–${p.maxCoinsPerDay} coins a day · holds under ${duration(p.maxHoldMin * 60)} · hunting ${p.targetMultipleLow}x–${p.targetMultipleHigh}x+ · exits: ${p.exitText}`, h('span', { class: 'edit' }, 'Edit')), form);
  return box;
}

function missionCard(t, reload) {
  const p = t.prefs;
  const input = h('input', { type: 'number', min: '1', step: '1', value: p.dailyTargetUsd ?? '', placeholder: 'e.g. 50', 'aria-label': "Today's profit target in dollars" });
  const save = async (ev) => {
    ev.preventDefault();
    if (!(Number(input.value) > 0)) return toast('Enter a dollar amount.');
    await api('/api/prefs', { dailyTargetUsd: Number(input.value) }).catch((e) => toast(e.message));
    reload(true);
  };
  const hits = (t.traders.picks ?? []).filter((x) => x.days?.activeDays).map((x) => `${x.name || x.wallet.slice(0, 4)}: ${x.days.hitDays} of ${x.days.activeDays} days`);
  return h('section', { class: 'mission' },
    h('form', { class: 'mission-form', onsubmit: save },
      h('label', {}, h('span', { class: 'mission-q' }, 'What do you want to make today?'), h('span', { class: 'field-usd' }, '$', input)),
      h('button', { class: 'btn primary', type: 'submit' }, p.dailyTargetUsd ? 'Update target' : 'Set target')),
    t.plan ? h('p', { class: 'mission-plan' }, t.plan.text) : h('p', { class: 'faint' }, 'Set a target and I will work out what each trade has to do with your money, and which traders have actually done it.'),
    t.plan && hits.length ? h('p', { class: 'rec-sub' }, `Days your recommended traders would have reached it (your pace, after fees): ${hits.join(' · ')}.`) : null);
}

export async function openToday(root, hooks) {
  hooks.setContext({ view: 'today', coin: null, wallet: null });
  clearTimeout(timer);
  if (!root.firstChild) clear(root).append(h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('p', { class: 'faint' }, 'Researching for you…')));
  const load = async (fresh = false) => {
    let t;
    try {
      t = await api(`/api/today${fresh ? '?fresh=1' : ''}`);
    } catch (e) {
      clear(root).append(h('div', { class: 'page' }, h('p', {}, `I could not finish the research: ${e.message}`)));
      return;
    }
    if (!location.hash.startsWith('#/today') && location.hash !== '' && location.hash !== '#/') return;
    hooks.onToday?.(t);
    const picks = t.traders.picks ?? [];
    const opps = t.opportunities ?? [];
    const r = t.research;
    clear(root).append(h('div', { class: 'page today' },
      h('header', { class: 'today-head' },
        h('h1', {}, greeting(), ' ', h('span', { class: 'muted' }, "Here's what I researched for you.")),
        accountLine(t.account)),
      missionCard(t, load),
      prefsPanel(t.prefs, () => load(true)),
      h('section', { class: 'block-today' },
        h('h2', explainAttrs('nav.wallets'), 'Traders I recommend'),
        h('p', { class: 'faint' }, picks.length
          ? `${t.traders.fitting} of the ${t.traders.measured} traders I measured fit your style. These ${picks.length} have the best copyable results at your trade size.`
          : `None of the ${t.traders.measured} traders I measured fits your style yet. ${r.running ? 'Research is running and adds traders as it goes.' : ''}`),
        h('div', { class: 'recs' }, picks.map((p) => traderCard(p, hooks, { targetUsd: t.prefs.dailyTargetUsd }))),
        skippedList(t.traders.skipped ?? [], hooks)),
      h('section', { class: 'block-today' },
        h('h2', explainAttrs('pulse.explosive'), 'Opportunities right now'),
        h('p', { class: 'faint' }, opps.length
          ? 'Coins with the strongest live buying, with what a follower realistically captured on past runners kept apart from a full 10x.'
          : t.live.warmingUp ? 'Measuring live buying speed (about 10 seconds after opening)…' : 'Nothing is igniting right now. I keep watching and will tell you in the analyst panel.'),
        h('div', { class: 'recs' }, opps.map((o) => opportunityCard(o, hooks, { sizeUsd: t.prefs.sizeUsd })))),
      (t.migrations ?? []).length ? h('section', { class: 'block-today' },
        h('h2', explainAttrs('pulse.graduated'), 'Fresh migrations'),
        h('p', { class: 'faint' }, `Coins that graduated to a trading pool in the last 30 minutes and pass the hard filters. Profitable traders prefer these to block-0 launch snipes.${isNum(t.study.migrationMedian) ? ` In the history study, buying at graduation gave a follower a median ${t.study.migrationMedian.toFixed(1)}x (${t.study.migrationSeen} runners).` : ''}`),
        h('div', { class: 'recs' }, t.migrations.map((o) => opportunityCard(o, hooks, { sizeUsd: t.prefs.sizeUsd })))) : null,
      h('footer', { class: 'research' },
        icon('refresh'),
        r.running ? ` Researching now: ${r.progress?.phase ?? ''} ${r.progress?.total ? `${r.progress.done} of ${r.progress.total}` : ''}.` : ` Research last finished ${r.last?.at ? new Date(r.last.at).toLocaleString() : 'never'}.`,
        ` ${t.study.runners} past runners studied; a follower entering after the first signal and selling on a 30% drop typically made ${isNum(t.study.followableMedian) ? `${t.study.followableMedian.toFixed(1)}x` : 'n/a'} (the coins' own best runs were a median ${isNum(t.study.bestRunMedian) ? `${t.study.bestRunMedian.toFixed(1)}x` : 'n/a'}).`,
        r.running ? null : h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('/api/jobs', { kind: 'all' }).catch((e) => toast(e.message)); toast('Researching: new runners, their early wallets, and fresh copy results.'); } }, 'Research more'))));
    timer = setTimeout(() => location.hash.startsWith('#/today') && load(), 30_000);
  };
  await load();
}

