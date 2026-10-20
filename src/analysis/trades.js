// Turns GMGN wallet_activity rows into round trips ("positions").
// Live field names (gmgn-cli 1.6.7, checked against real responses 2026-10-20):
// tx_hash, event_type, timestamp (s), cost_usd, token_amount, price_usd, gas_usd,
// priority_fee / tip_fee (SOL), dex_usd (venue fee in USD), launchpad_platform,
// token.{address,symbol,total_supply}. Rows arrive newest first.

export const SNIPE_WINDOW_SEC = 60; // "sniping" = first buy within 1 minute of the coin's creation
const DUST = 0.99; // a position is closed once 99% of the bought tokens are sold

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeActivity(r) {
  const side = r.event_type ?? r.type;
  if (side !== 'buy' && side !== 'sell') return null;
  const usdAmt = num(r.cost_usd);
  const tokenAmount = num(r.token_amount);
  const priceUsd = num(r.price_usd) ?? (usdAmt != null && tokenAmount ? usdAmt / tokenAmount : null);
  const totalSupply = num(r.token?.total_supply);
  return {
    tx: r.tx_hash,
    side,
    ts: num(r.timestamp),
    token: r.token?.address,
    symbol: r.token?.symbol ?? '',
    usd: usdAmt,
    tokenAmount,
    priceUsd,
    mcapUsd: priceUsd != null && totalSupply ? priceUsd * totalSupply : null,
    gasUsd: num(r.gas_usd) ?? 0,
    priorityFeeSol: num(r.priority_fee),
    tipSol: num(r.tip_fee),
    dexFeeUsd: num(r.dex_usd),
    launchpad: r.launchpad_platform || r.launchpad || '',
  };
}

function newPosition(t) {
  return {
    token: t.token, symbol: t.symbol, launchpad: t.launchpad,
    openTs: t.ts, firstSellTs: null, closeTs: null, status: 'open',
    buys: [], sells: [], boughtTokens: 0, soldTokens: 0, heldTokens: 0,
    buyUsd: 0, sellUsd: 0, feesUsd: 0,
    entryPriceUsd: t.priceUsd, entryMcapUsd: t.mcapUsd,
  };
}

function finish(p) {
  p.holdSec = p.closeTs != null ? p.closeTs - p.openTs : null;
  p.copyWindowSec = p.firstSellTs != null ? p.firstSellTs - p.openTs : null;
  const soldShare = p.boughtTokens > 0 ? Math.min(1, p.soldTokens / p.boughtTokens) : 0;
  p.realizedUsd = p.status === 'closed' ? p.sellUsd - p.buyUsd : p.sellUsd - p.buyUsd * soldShare;
  p.exitPriceUsd = p.soldTokens > 0 ? p.sellUsd / p.soldTokens : null;
  p.returnRatio = p.status === 'closed' && p.buyUsd > 0 ? p.sellUsd / p.buyUsd - 1 : null;
  p.sellPattern = p.sells.length === 0 ? 'none' : p.sells.length === 1 ? 'one-shot' : 'scaled';
  return p;
}

export function buildPositions(trades) {
  const sorted = trades.filter(Boolean).filter((t) => t.ts != null && t.token).sort((a, b) => a.ts - b.ts);
  const open = new Map();
  const positions = [];
  let orphanSells = 0;
  for (const t of sorted) {
    let p = open.get(t.token);
    if (t.side === 'buy') {
      if (!p) {
        p = newPosition(t);
        open.set(t.token, p);
        positions.push(p);
      }
      p.buys.push(t);
      p.boughtTokens += t.tokenAmount ?? 0;
      p.heldTokens += t.tokenAmount ?? 0;
      p.buyUsd += t.usd ?? 0;
      p.feesUsd += (t.gasUsd ?? 0) + (t.dexFeeUsd ?? 0);
      continue;
    }
    if (!p) {
      orphanSells += 1;
      continue;
    }
    const before = p.heldTokens;
    const amt = Math.min(t.tokenAmount ?? 0, before);
    p.sells.push({ ...t, fractionOfHolding: before > 0 ? Math.round((amt / before) * 1e6) / 1e6 : 0 });
    p.soldTokens += amt;
    p.heldTokens = before - amt;
    p.sellUsd += t.usd ?? 0;
    p.feesUsd += (t.gasUsd ?? 0) + (t.dexFeeUsd ?? 0);
    if (p.firstSellTs == null) p.firstSellTs = t.ts;
    if (p.soldTokens >= p.boughtTokens * DUST) {
      p.status = 'closed';
      p.closeTs = t.ts;
      p.sells[p.sells.length - 1].fractionOfHolding = 1;
      p.heldTokens = 0;
      open.delete(t.token);
    }
  }
  return { positions: positions.map(finish), orphanSells };
}

// token info -> the three timestamps that decide what stage a buy happened in
export function tokenMetaFromInfo(info) {
  if (!info) return null;
  const creationTs = num(info.creation_timestamp);
  const openTs = num(info.open_timestamp);
  const launchpad = info.launchpad || info.launchpad_platform || '';
  const migrated = Boolean(info.migrated_pool) || Number(info.launchpad_status) === 2;
  let migratedAt = null;
  if (launchpad) migratedAt = migrated && openTs ? openTs : null;
  else migratedAt = openTs || creationTs;
  return {
    creationTs, migratedAt, launchpad,
    poolFeePct: num(info.pool?.fee_ratio),
    liquidityUsd: num(info.liquidity),
    symbol: info.symbol,
  };
}

export function classifyEntry(position, meta) {
  if (!meta || meta.creationTs == null) return 'unknown';
  if (meta.migratedAt != null && position.openTs >= meta.migratedAt) return 'graduated';
  return position.openTs - meta.creationTs <= SNIPE_WINDOW_SEC ? 'snipe' : 'early';
}
