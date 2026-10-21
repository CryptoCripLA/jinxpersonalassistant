// Shared front-end helpers. Plain DOM, no framework. Every string from GMGN, pump.fun or X is
// inserted as text (never as HTML), because coin and wallet names are written by strangers.
export const TOKEN = document.querySelector('meta[name="jpa-token"]').content;
export const $ = (id) => document.getElementById(id);
export const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function api(path, body) {
  const opts = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-jpa-token': TOKEN }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid);
  return el;
}

// Drawn icons, one stroke weight (lucide-style paths, authored here).
const ICONS = {
  flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.8 2.4-5 .2 1.6.9 2.7 2 3.2C11.2 9 11 6 12 3z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.25 3.25 0 0 1 0 6.1',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  x: 'M4 4l16 16M20 4 4 20',
  back: 'M15 18l-6-6 6-6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  check: 'M5 12.5 10 17l9-10',
  minus: 'M6 12h12',
};
export function icon(name) {
  return svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, svg('path', { d: ICONS[name] }));
}

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export function usd(x) {
  if (!isNum(x)) return 'unavailable';
  const s = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a > 0 && a < 0.01) return `${s}$${a.toLocaleString('en-US', { maximumSignificantDigits: 2 })}`;
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export const usdSigned = (x) => (isNum(x) && x > 0 ? `+${usd(x)}` : usd(x));
export const usdWhole = (x) => (isNum(x) && Number.isInteger(x) ? `$${x.toLocaleString('en-US')}` : usd(x));
export function usdShort(x) {
  if (!isNum(x)) return 'n/a';
  const a = Math.abs(x);
  const s = x < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${+(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${+(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${s}$${+(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return usd(x);
}
export function priceUsd(x) {
  if (!isNum(x)) return 'n/a';
  if (x >= 1) return `$${x.toFixed(3)}`;
  return `$${x.toPrecision(3)}`;
}
export const pct = (r, d = 0) => (isNum(r) ? `${(r * 100).toFixed(d)}%` : 'n/a');
export const pctSigned = (r) => (isNum(r) ? `${r > 0 ? '+' : ''}${(r * 100).toFixed(Math.abs(r) < 0.1 ? 1 : 0)}%` : 'n/a');
export const mult = (m) => (isNum(m) ? `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}x` : 'n/a');
export const short = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '');
export const signClass = (x) => (isNum(x) ? (x > 0 ? 'up' : x < 0 ? 'down' : '') : '');
export function age(sec) {
  if (!isNum(sec)) return '';
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 360) / 10}h`;
  return `${Math.round(sec / 8640) / 10}d`;
}
export function duration(sec) {
  if (!isNum(sec)) return 'unknown';
  if (sec < 90) return `${Math.round(sec)} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  if (sec < 172800) return `${Math.round((sec / 3600) * 10) / 10} hours`;
  return `${Math.round((sec / 86400) * 10) / 10} days`;
}

export function label(kind) {
  const k = String(kind ?? '').toLowerCase();
  const cls = k.includes('simul') ? 'simulated' : k.includes('live') ? 'live' : 'historical';
  const key = cls === 'simulated' ? 'label.simulated' : cls === 'live' ? 'label.live' : 'label.historical';
  return h('span', { class: `tag ${cls}`, 'data-explain': key }, cls.toUpperCase());
}

export function logo(src, sym) {
  if (src && /^https:\/\//.test(src)) {
    const img = h('img', { class: 'logo', src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(h('span', { class: 'logo fallback' }, (sym || '?').slice(0, 2))), { once: true });
    return img;
  }
  return h('span', { class: 'logo fallback' }, (sym || '?').slice(0, 2));
}

export function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// Element context for the analyst: what was clicked, its label and live value.
export function explainAttrs(key, value) {
  return { 'data-explain': key, 'data-value': value == null ? null : String(value) };
}
