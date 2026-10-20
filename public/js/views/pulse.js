// Pulse: four GMGN-style columns fed by the server's live board. Explosive now comes first.
import { h, clear, icon, logo, usdShort, age, isNum, explainAttrs } from '../core.js';

const COLS = [
  { key: 'explosive', title: 'Explosive now', hint: 'strongest live momentum', explain: 'pulse.explosive' },
  { key: 'new', title: 'New', hint: 'just launched', explain: 'pulse.new' },
  { key: 'near', title: 'About to graduate', hint: 'launch curve 80%+', explain: 'pulse.near' },
  { key: 'graduated', title: 'Graduated', hint: 'now in a real pool', explain: 'pulse.graduated' },
];

let root = null;
let lastExplosive = new Set();
const rowsEls = {};
const countEls = {};
let onOpen = () => {};
let onVisible = () => {};

export function mountPulse(el, { open, visible }) {
  root = el;
  onOpen = open;
  onVisible = visible;
  const grid = h('div', { class: 'pulse' });
  for (const c of COLS) {
    rowsEls[c.key] = h('div', { class: 'rows' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    countEls[c.key] = h('span', { class: 'count' });
    grid.append(h('div', { class: `col ${c.key}` },
      h('div', { class: 'col-head', ...explainAttrs(c.explain) }, h('h2', {}, c.title), countEls[c.key], h('span', { class: 'hint' }, c.hint)),
      rowsEls[c.key]));
  }
  clear(root).append(grid);
}

function scoreClass(s) {
  return s >= 70 ? 'score hot' : s >= 50 ? 'score good' : 'score';
}

function row(c, { sweep }) {
  const r = c.rates;
  const buys = r?.buysPerMin;
  const m = c.momentum;
  const progress = isNum(c.progress) && c.progress < 1 ? c.progress : null;
  return h('button', { class: `row${sweep ? ' sweep' : ''}`, type: 'button', 'data-addr': c.address, onclick: () => onOpen(c.address), 'aria-label': `${c.symbol} momentum ${m.score}` },
    logo(c.logo, c.symbol),
    h('div', { class: 'r-top' },
      h('span', { class: 'r-sym' }, c.symbol || '?'),
      h('span', { class: 'r-name' }, c.name),
      h('span', { class: 'r-age', ...explainAttrs('row.age', age(c.ageSec)) }, age(c.ageSec))),
    h('div', { class: 'r-right' },
      h('span', { class: scoreClass(m.score), ...explainAttrs('coin.momentum', m.score) }, m.score),
      h('span', { class: `stage ${m.stage}`, ...explainAttrs('coin.stage', m.stage) }, m.stage)),
    h('div', { class: 'r-stats' },
      h('span', explainAttrs('row.mcap', usdShort(c.marketCapUsd)), 'MC ', h('b', {}, usdShort(c.marketCapUsd))),
      isNum(buys) ? h('span', explainAttrs('row.buys', `${Math.round(buys)} a minute`), h('b', {}, Math.round(buys)), ' buys/m') : null,
      c.smart ? h('span', { class: 'chip smart', ...explainAttrs('row.smart', c.smart) }, icon('star'), c.smart) : null,
      c.explosiveIn?.length ? h('span', { class: 'chip exp', ...explainAttrs('row.explosive', c.explosiveIn.length) }, icon('bolt'), c.explosiveIn.length) : null,
      m.warnings?.length ? h('span', { class: 'chip warn', title: m.warnings[0] }, `${m.warnings.length} risk${m.warnings.length > 1 ? 's' : ''}`) : null),
    progress != null ? h('span', { class: 'bar', ...explainAttrs('row.progress', `${Math.round(progress * 100)}%`) }, h('i', { style: { width: `${Math.round(progress * 100)}%` } })) : null);
}

export function updatePulse(cols) {
  if (!root || !cols) return;
  const nextExplosive = new Set((cols.explosive ?? []).map((c) => c.address));
  for (const c of COLS) {
    const list = cols[c.key] ?? [];
    const box = rowsEls[c.key];
    const top = box.scrollTop;
    countEls[c.key].textContent = list.length ? String(list.length) : '';
    if (!list.length) {
      clear(box).append(h('p', { class: 'empty' }, cols.error ? `GMGN did not answer: ${cols.error}` : c.key === 'explosive' ? 'Nothing is igniting right now. Coins appear here when buying speeds up with real buyers.' : 'Waiting for the next update.'));
      continue;
    }
    clear(box).append(...list.map((x) => row(x, { sweep: c.key === 'explosive' && lastExplosive.size > 0 && !lastExplosive.has(x.address) })));
    box.scrollTop = top;
  }
  lastExplosive = nextExplosive;
  onVisible([...nextExplosive].slice(0, 15));
}

// A followed (explosive) wallet just bought this coin: sweep its row wherever it is listed.
export function flashCoin(address) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return;
  for (const el of root?.querySelectorAll(`.row[data-addr="${address}"]`) ?? []) {
    el.classList.remove('sweep');
    void el.offsetWidth;
    el.classList.add('sweep');
  }
}
