// History: real coins that ran 7x+ within a day, what was visible before the breakout, what
// came too late, and what a follower entering after each signal would have made.
import { h, svg, clear, api, icon, usdShort, mult, short, duration, isNum, label, toast, explainAttrs } from '../core.js';

const WHEN = { before: ['before', 'BEFORE'], during: ['during', 'DURING'], 'too late': ['late', 'TOO LATE'] };

function spark(ex) {
  const cs = ex.candles ?? [];
  const W = 300;
  const H = 150;
  const P = 8;
  if (cs.length < 2) return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}` });
  const t0 = cs[0].t;
  const t1 = cs[cs.length - 1].t;
  const lo = Math.log(Math.max(1e-12, Math.min(...cs.map((c) => c.low))));
  const hi = Math.log(Math.max(...cs.map((c) => c.high)));
  const x = (t) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
  const y = (v) => H - P - ((Math.log(Math.max(1e-12, v)) - lo) / Math.max(1e-9, hi - lo)) * (H - 2 * P);
  const d = cs.map((c, i) => `${i ? 'L' : 'M'}${x(c.t).toFixed(1)},${y(c.close).toFixed(1)}`).join(' ');
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const mark = (t, price, color, text) => [
    svg('line', { x1: x(t), x2: x(t), y1: P, y2: H - P, stroke: color, 'stroke-dasharray': '3 3', 'stroke-width': '1', opacity: '0.7' }),
    svg('circle', { cx: x(t), cy: y(price), r: '3.5', fill: color }),
    svg('text', { x: Math.min(W - 40, x(t) + 4), y: P + 10, fill: color, 'font-size': '10', 'font-family': 'Hanken Grotesk, sans-serif' }, document.createTextNode(text)),
  ];
  const sigs = (ex.signals ?? []).filter((s) => s.timing !== 'too late' && isNum(s.priceAtSignal)).slice(0, 6);
  return svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${ex.symbol} ran ${mult(ex.move.multiple)} from ${usdShort(ex.baseMcapUsd)} to ${usdShort(ex.peakMcapUsd)}` },
    svg('path', { d, fill: 'none', stroke: css('--ink-2') || '#aaa', 'stroke-width': '1.5' }),
    ...mark(ex.move.baseTs, ex.move.basePrice, css('--ink-3') || '#888', 'base'),
    ...mark(ex.move.breakoutTs, (ex.candles.find((c) => c.t === ex.move.breakoutTs)?.high) ?? ex.move.basePrice * 2, css('--ignite') || '#e93', 'breakout'),
    ...mark(ex.move.peakTs, ex.move.peakPrice, css('--gold') || '#cb4', 'peak'),
    ...sigs.map((s) => svg('circle', { cx: x(s.ts), cy: y(s.priceAtSignal), r: '3', fill: css('--up') || '#3c9', stroke: css('--bg') || '#111', 'stroke-width': '1' })),
    svg('text', { x: P, y: H - P - 2, fill: css('--ink-3') || '#888', 'font-size': '10', 'font-family': 'Hanken Grotesk, sans-serif' }, document.createTextNode('first 24 hours, log scale')));
}

function rel(sec) {
  if (!isNum(sec)) return '';
  return sec >= 0 ? `${duration(sec)} before the breakout` : `${duration(-sec)} after the breakout`;
}

function studyLine(r) {
  if (!r) return null;
  const why = Object.entries(r.reasons ?? {}).map(([k, v]) => `${v} ${k}`).join(', ');
  return h('p', { class: 'faint', style: { fontSize: '12.5px', marginTop: '4px' } }, `Last study ${new Date(r.at).toLocaleString()}: ${r.studied} coins read, ${r.examples} ran 7x+${why ? `; left out: ${why}` : ''}.`);
}

export async function openHistory(root, hooks) {
  hooks.setContext({ view: 'history', coin: null });
  clear(root).append(h('div', { class: 'page' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  const { summary, examples } = await api('/api/history');
  const page = h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', explainAttrs('nav.history'), 'Past explosive runs'), h('p', {}, `${examples.length} real coins that ran 7x or more within 6 hours of launch, read from GMGN 1-minute candles and top traders: ${summary.launches} launch spikes (the run happened in the first minutes, before anyone could react) and ${summary.breakouts} later breakouts. Every one of them did run, so these show what early looked like, not how often coins run.`), studyLine(summary.lastRun)),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await api('/api/jobs', { kind: 'study' }); toast('Studying more coins in the background.'); } catch (e) { toast(e.message); } } }, icon('refresh'), 'Study more coins'))));
  if (summary.signals.length) {
    page.append(h('h2', { style: { fontSize: '15px', margin: '6px 0 10px' }, ...explainAttrs('history.signal') }, 'Which signals came early enough to profit ', label('SIMULATED')),
      h('div', { class: 'sigbars' }, summary.signals.map((s) => h('div', { class: 'sigbar' },
        h('span', {}, s.label),
        h('span', { class: 'track', title: `${s.early} before, ${s.during} during, ${s.late} too late` },
          h('i', { class: 'b', style: { width: `${(s.early / s.seen) * 100}%` } }),
          h('i', { class: 'd', style: { width: `${(s.during / s.seen) * 100}%` } }),
          h('i', { class: 'l', style: { width: `${(s.late / s.seen) * 100}%` } })),
        h('span', { class: 'faint' }, `${s.early}/${s.seen} early · follower ${mult(s.medianFollowerMultiple)} median`)))),
      h('p', { class: 'faint', style: { fontSize: '12px', marginBottom: '16px' } }, 'Green: showed up before the price doubled. Amber: after, with at least 2x left. Red: too late. Follower result: entering 30 seconds after the signal, selling after a 30% drop from the high; candle prices, fees not included.'));
  }
  if (!examples.length) page.append(h('p', { class: 'empty' }, 'No study yet. Press "Study more coins".'));
  page.append(h('div', { class: 'examples' }, examples.map((ex) => h('article', { class: 'example', ...explainAttrs('history.example') },
    spark(ex),
    h('div', { class: 'ex-body' },
      h('h3', {}, h('button', { class: 'wl', type: 'button', onclick: () => hooks.openCoin(ex.token) }, ex.symbol || short(ex.token)), h('span', { class: 'money' }, mult(ex.move.multiple)), h('span', { class: `chip ${ex.kind === 'launch' ? 'warn' : 'smart'}` }, ex.kind === 'launch' ? 'Launch spike' : 'Later breakout'), h('span', { class: 'faint', style: { fontSize: '12.5px', fontWeight: 400 } }, `${usdShort(ex.baseMcapUsd)} → ${usdShort(ex.peakMcapUsd)} in ${duration(ex.move.durationSec)} · launched ${new Date(ex.creationTs * 1000).toLocaleString()}`), label('HISTORICAL')),
      h('p', { class: 'muted', style: { fontSize: '12.5px' } }, ex.kind === 'launch'
        ? `Most of this happened in the first minutes: only snipers and bundled launch wallets were in. ${ex.followable ? `After the launch minute the best run was ${mult(ex.followable.multiple)}, from ${usdShort(ex.followable.baseMcapUsd)} to ${usdShort(ex.followable.peakMcapUsd)} in ${duration(ex.followable.durationSec)}.` : 'Nothing worth following came after it.'}`
        : `The run started ${duration(ex.move.breakoutTs - ex.creationTs)} after launch, so a watcher had time to see it.${ex.followable ? ` Best run after the launch minute: ${mult(ex.followable.multiple)} from ${usdShort(ex.followable.baseMcapUsd)}.` : ''}`),
      h('div', { class: 'timeline' }, (ex.signals ?? []).slice(0, 8).map((s) => {
        const [cls, word] = WHEN[s.timing] ?? ['late', s.timing];
        return h('div', { class: 'sig' },
          h('span', { class: `when ${cls}`, ...explainAttrs('history.signal', word) }, word),
          h('span', {}, s.label, s.wallet ? h('span', { class: 'faint' }, ` (${short(s.wallet)})`) : null, h('span', { class: 'faint' }, ` · ${rel(s.secondsBeforeBreakout)}, ${mult(s.upsideLeft)} left`)),
          h('span', { class: s.follower?.multiple >= 1 ? 'up' : 'down', ...explainAttrs('history.follower', mult(s.follower?.multiple)) }, s.follower ? `follower ${mult(s.follower.multiple)}` : ''));
      })),
      ex.earlyWallets?.length
        ? h('p', { class: 'faint', style: { fontSize: '12.5px' } }, `${ex.earlyWallets.length} wallets were in before the breakout: `, ...ex.earlyWallets.slice(0, 4).map((w) => h('button', { class: 'wl', type: 'button', style: { marginRight: '8px' }, onclick: () => hooks.openWallet(w.wallet) }, `${w.name || short(w.wallet)}${isNum(w.capturedMultiple) ? ` sold ${mult(w.capturedMultiple)}` : ''}`)))
        : h('p', { class: 'faint', style: { fontSize: '12.5px' } }, 'GMGN listed no wallets that were in before the breakout.'))))));
  clear(root).append(page);
}
