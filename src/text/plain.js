// Small helpers for elementary-school English.

export function duration(sec) {
  if (sec == null || !Number.isFinite(sec)) return 'unknown time';
  const s = Math.round(sec);
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round((s / 3600) * 10) / 10;
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round((s / 86400) * 10) / 10;
  return `${d} day${d === 1 ? '' : 's'}`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const roundNice = (x) => (Math.abs(x) >= 10 ? Math.round(x) : Math.round(x * 10) / 10);

export const STAGE_WORDS = {
  graduated: 'graduated coins (already moved off the Pump.fun curve to a real trading pool)',
  early: 'early coins (still on the launch curve, bought after the first minute)',
  snipe: 'snipes (bought in the first minute after the coin was created)',
  unknown: 'coins whose launch stage GMGN did not report',
};

export const STAGE_SHORT = { graduated: 'graduated', early: 'early momentum', snipe: 'sniping', unknown: 'unknown stage' };

// Untrusted third-party text (token names, wallet names) shown as plain data only.
export function cleanLabel(s, max = 40) {
  if (s == null) return '';
  return String(s)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/[<>`*[\]]/g, '')
    .replace(/https?:\/\//gi, '')
    .trim()
    .slice(0, max);
}
