// Every amount the owner sees is US dollars. SOL and lamports exist only inside
// calculations; converting always takes an explicit rate object
// { usdPerSol, source, at } so a missing rate becomes "unavailable", never $0.

const LAMPORTS_PER_SOL = 1_000_000_000;

const round9 = (x) => Math.round(x * 1e9) / 1e9;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function usd(x) {
  if (!isNum(x)) return 'unavailable';
  const sign = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a > 0 && a < 0.01) {
    return `${sign}$${a.toLocaleString('en-US', { maximumSignificantDigits: 2 })}`;
  }
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// $25 rather than $25.00 when the amount is whole; used for sizes the owner typed.
export function usdWhole(x) {
  if (!isNum(x)) return 'unavailable';
  return Number.isInteger(x) ? `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US')}` : usd(x);
}

// Market caps and other big round numbers: $400K, $1.2M.
export const usdShort = (x) => {
  if (!isNum(x)) return 'unavailable';
  const a = Math.abs(x);
  const sign = x < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${+(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${+(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${+(a / 1e3).toFixed(0)}K`;
  return usd(x);
};

export function usdSigned(x) {
  if (!isNum(x)) return 'unavailable';
  return x > 0 ? `+${usd(x)}` : usd(x);
}

export function pct(ratio, digits = 1) {
  if (!isNum(ratio)) return 'unavailable';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function solToUsd(sol, rate) {
  if (!isNum(sol) || !rate || !isNum(rate.usdPerSol)) return null;
  return round9(sol * rate.usdPerSol);
}

export function usdToSol(amountUsd, rate) {
  if (!isNum(amountUsd) || !rate || !isNum(rate.usdPerSol) || rate.usdPerSol <= 0) return null;
  return amountUsd / rate.usdPerSol;
}

export function usdToLamports(amountUsd, rate) {
  const sol = usdToSol(amountUsd, rate);
  if (sol == null) return null;
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

export function lamportsToUsd(lamports, rate) {
  if (lamports == null || !rate || !isNum(rate.usdPerSol)) return null;
  return (Number(lamports) / LAMPORTS_PER_SOL) * rate.usdPerSol;
}

export function rateLine(rate) {
  if (!rate || !isNum(rate.usdPerSol)) return 'SOL price unavailable';
  const when = rate.at ? new Date(rate.at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown time';
  return `1 SOL = ${usd(rate.usdPerSol)} (${rate.source}, ${when})`;
}

export { round9, isNum, LAMPORTS_PER_SOL };
