// The desk analyst: a docked rail that always knows what is on screen (view, open coin, open
// wallet, last clicked element) and sends that context with every question. Explain mode
// (button or "?") turns every data-explain element into a question instead of a click.
import { $, api, h, clear, label, toast } from './core.js';

const ctx = { view: 'pulse', coin: null, wallet: null, element: null, visible: [] };
let size = 25;
let explaining = false;
let tethered = null;
let onAction = () => {};

const SUGGEST = {
  pulse: () => ["What's the most promising opportunity right now?", 'Which of these coins has the strongest early momentum?', 'Show me the explosive wallets', 'Find traders getting in before graduation'],
  coin: () => ['Why is this coin pumping?', 'Who bought before everyone else?', 'Are the early profitable wallets still holding?', 'Could this coin realistically reach 10x from here?', `What happens if I put $${size} into this?`, `How much could $${size} make if this reaches 7x?`, 'When are the profitable wallets selling?', "What's X saying about this coin?"],
  wallets: () => ['Which wallet repeatedly catches explosive moves?', 'Find traders getting in before graduation', 'Explain the edge kept column'],
  wallet: () => ['Show me what this wallet did on its last 10 coins', 'Why did that trader sell?', `What would I have made copying this wallet with $${size}?`],
  history: () => ['Which signals came early enough to profit?', 'Which wallet repeatedly catches explosive moves?', "What's the most promising opportunity right now?"],
  portfolio: () => ['How are my open positions doing?', "What's the most promising opportunity right now?"],
  desk: () => ['Which wallet repeatedly catches explosive moves?', 'What does Ask me first do?'],
};

export function setSize(n) {
  if (Number(n) > 0) size = Number(n);
  renderSugs();
}

export function setContext(patch) {
  Object.assign(ctx, patch);
  const bits = [ctx.coin?.symbol ? ctx.coin.symbol : null, ctx.wallet && ctx.view === 'wallet' ? `${ctx.wallet.slice(0, 4)}…` : null].filter(Boolean);
  $('railCtx').textContent = bits.length ? `Looking at ${bits.join(' · ')}` : '';
  renderSugs();
}

export const getContext = () => ctx;

function renderSugs() {
  const s = clear($('sugs'));
  for (const q of (SUGGEST[ctx.view] ?? SUGGEST.pulse)().slice(0, 6)) s.append(h('button', { type: 'button', onclick: () => ask(q) }, q));
}

function scrollFeed() {
  const f = $('feed');
  f.scrollTop = f.scrollHeight;
}

function actionButton(a) {
  return h('button', { class: 'btn small', type: 'button', onclick: () => (a.kind === 'ask' ? ask(a.question) : onAction(a)) }, a.label);
}

export async function ask(question, { element = null } = {}) {
  const q = String(question ?? '').trim();
  if (!q) return;
  const feed = $('feed');
  feed.append(h('div', { class: 'msg me' }, q));
  const pending = h('div', { class: 'msg ai thinking' }, h('p', { class: 'lead' }, 'Checking the live data…'));
  feed.append(pending);
  scrollFeed();
  try {
    const context = { ...ctx, element: element ?? ctx.element };
    const r = await api('/api/ask', { question: q, context });
    const meta = h('div', { class: 'meta' }, r.label ? label(r.label) : null, r.by === 'grok' ? `Grok${r.costUsd ? `, ${r.costUsd < 0.01 ? 'under 1¢' : `about ${Math.round(r.costUsd * 100)}¢`}` : ''}` : r.by === 'built-in' ? 'from app data' : '');
    pending.replaceWith(h('div', { class: 'msg ai' },
      h('p', { class: 'lead' }, r.text),
      r.evidence?.length ? h('ul', {}, r.evidence.map((e) => h('li', {}, e))) : null,
      r.actions?.length ? h('div', { class: 'acts' }, r.actions.map(actionButton)) : null,
      meta));
  } catch (e) {
    pending.replaceWith(h('div', { class: 'msg ai' }, h('p', { class: 'lead' }, `I could not answer that: ${e.message}`)));
  }
  scrollFeed();
}

function elementContext(el) {
  const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { key: el.dataset.explain, label: text, value: el.dataset.value ?? null };
}

function tether(el) {
  tethered?.classList.remove('tethered');
  tethered = el;
  el.classList.add('tethered');
}

export function explainElement(el) {
  const element = elementContext(el);
  ctx.element = element;
  tether(el);
  if (window.innerWidth <= 1280) document.body.classList.add('rail-open');
  ask('Explain this', { element });
}

export function setExplain(on) {
  explaining = on;
  document.body.classList.toggle('explaining', on);
  $('explainBtn').setAttribute('aria-pressed', String(on));
  if (!on) {
    tethered?.classList.remove('tethered');
    tethered = null;
  } else toast('Explain mode on: click anything to have it explained.');
}

export function initAssistant({ onActionFn }) {
  onAction = onActionFn;
  $('askForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const v = $('askInput').value.trim();
    $('askInput').value = '';
    ask(v);
  });
  $('explainBtn').addEventListener('click', () => setExplain(!explaining));
  $('railBtn').addEventListener('click', () => {
    const open = !document.body.classList.contains('rail-open');
    document.body.classList.toggle('rail-open', open);
    $('railBtn').setAttribute('aria-expanded', String(open));
  });
  // Explain mode and Alt+click both turn any explainable element into a question.
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.('[data-explain]');
    if (!el || el.closest('#rail')) return;
    if (explaining || ev.altKey) {
      ev.preventDefault();
      ev.stopPropagation();
      explainElement(el);
      return;
    }
    ctx.element = elementContext(el); // remembered so "explain this" refers to the last thing clicked
  }, true);
  document.addEventListener('keydown', (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
    if (ev.key === '?' && !typing) {
      ev.preventDefault();
      setExplain(!explaining);
    } else if (ev.key === 'Escape' && explaining) setExplain(false);
  });
  $('feed').append(h('div', { class: 'msg ai' },
    h('p', { class: 'lead' }, 'I watch the same screens you do. Click a coin or wallet and ask in your own words, or turn on Explain (press ?) and click anything.'),
    h('ul', {}, h('li', {}, 'Numbers come from GMGN and pump.fun live, never made up.'), h('li', {}, 'HISTORICAL means a wallet really did it; SIMULATED is what your $25 copy would have done; LIVE is your real money.'))));
  renderSugs();
}
