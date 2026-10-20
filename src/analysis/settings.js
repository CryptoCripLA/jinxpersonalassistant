// GMGN copy-trade settings for one wallet, sized to YOUR dollars.
// Setting names and meanings follow GMGN's official copy-trade guide
// (https://docs.gmgn.ai/index/copy-trade-copy-smart-money-automatically-earn-sol) and fee guide
// (https://docs.gmgn.ai/index/gmgn-fees-settings), read 2026-10-20.
// Shown in USD only. GMGN's own boxes take SOL, so each money item also carries
// `gmgnInput`: the converted number for the "copy for GMGN" button, never displayed.
import { usd, usdToSol, solToUsd, pct } from '../money/usd.js';
import { roundTripCosts } from '../money/fees.js';
import { duration } from '../text/plain.js';

const niceFloor = (x) => {
  if (!(x > 0)) return null;
  const p = 10 ** Math.floor(Math.log10(x));
  return Math.floor(x / p) * p;
};
const niceCeil = (x) => {
  if (!(x > 0)) return null;
  const p = 10 ** Math.floor(Math.log10(x));
  return Math.ceil(x / p) * p;
};
export const usdShort = (x) => {
  if (x == null) return 'unavailable';
  if (x >= 1e6) return `$${+(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `$${+(x / 1e3).toFixed(0)}K`;
  return usd(x);
};
const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

export function maxConcurrent(positions) {
  const ev = [];
  for (const p of positions) {
    ev.push([p.openTs, 1]);
    ev.push([p.closeTs ?? Infinity, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

function measuredVenuePct(positions) {
  return median(positions.map((p) => (p.buys?.[0]?.dexFeeUsd > 0 && p.buys[0].usd > 0 ? (p.buys[0].dexFeeUsd / p.buys[0].usd) * 100 : NaN)));
}

export function recommendSettings(p, { capitalUsd, rate, fees, sizeUsd = null }) {
  const warnings = [];
  const items = [];
  const solFor = (u) => (u == null ? null : Math.round(usdToSol(u, rate) * 1e4) / 1e4);
  const conc = Math.max(1, maxConcurrent(p.positions ?? []));
  const slots = conc + 1;
  const venuePct = measuredVenuePct(p.positions ?? []) ?? fees.curveFeePct;
  const gradHeavy = (p.stageMix?.graduated ?? 0) >= 0.5;
  const snipeHeavy = (p.stageMix?.snipe ?? 0) >= 0.3;

  // 1. buy size
  let size = sizeUsd ?? Math.floor((capitalUsd * 0.9) / slots);
  if (p.medianBuyUsd > 0) size = Math.min(size, Math.floor(p.medianBuyUsd / 2) || size);
  size = Math.max(1, size);
  const rt = roundTripCosts(fees, { usd: size, venue: 'measured', poolFeePct: venuePct });
  const net = solToUsd(fees.networkSolPerTx, rate);
  const pctFees = (2 * (fees.gmgnFeePct + venuePct)) / 100;
  const minSizeFor10 = net != null && 0.1 - pctFees > 0 ? Math.ceil((2 * net) / (0.1 - pctFees)) : null;
  if (rt.shareOfTrade != null && rt.shareOfTrade > 0.1) {
    warnings.push(`At ${usd(size)} a trade, fees take about ${pct(rt.shareOfTrade, 0)} of every buy-and-sell. ${minSizeFor10 ? `Trades of ${usd(minSizeFor10)} or more keep fees under 10%.` : ''}`.trim());
  }
  items.push({
    setting: 'Single copy buying method',
    value: `Fixed buy: ${usd(size)} per copy`,
    usd: size,
    gmgnInput: solFor(size),
    simple: `Every time this wallet buys a coin, you buy ${usd(size)} of the same coin. Same amount every time, no matter how much the wallet spends.`,
    why: `This wallet held up to ${conc} coin${conc === 1 ? '' : 's'} at the same time, so ${usd(size)} lets you follow ${slots} trades at once with ${usd(capitalUsd)} and still keep money for fees.`,
  });

  // 2. selling method
  const total = (p.closedCount ?? 0) + (p.openCount ?? 0);
  const bagShare = total ? (p.openCount ?? 0) / total : 0;
  const rets = (p.positions ?? []).filter((x) => x.status === 'closed' && x.returnRatio != null).map((x) => x.returnRatio);
  const tp = median(rets.filter((r) => r > 0));
  const sl = median(rets.filter((r) => r < 0));
  if (bagShare > 0.4 && tp != null) {
    items.push({
      setting: 'Selling method',
      value: `Take profit and stop loss: sell at +${pct(tp, 0)}, cut at ${sl != null ? pct(sl, 0) : '-30%'}`,
      simple: 'Your copy sells by itself when the coin goes up enough, or when it falls too far, even if the wallet never sells.',
      why: `This wallet still holds ${pct(bagShare, 0)} of the coins it bought, so following its sells could leave you stuck. Its typical winner gained ${pct(tp, 0)}.`,
    });
  } else {
    items.push({
      setting: 'Selling method',
      value: 'Automatic follow-up selling',
      simple: 'When the wallet sells part of its coins, you sell the same part of yours. If it sells half, you sell half.',
      why: `This wallet finishes ${pct(1 - bagShare, 0)} of its trades and usually sells within ${duration(p.medianHoldSec)}. Its exits are part of why it wins.`,
    });
    if ((p.sellPattern?.scaled ?? 0) > 0.4 && net != null) {
      warnings.push(`This wallet often sells in pieces. Every piece is one more sale for you, about ${usd(net)} in network fee each time.`);
    }
  }

  // 3. trade parameters
  items.push({
    setting: 'Slippage',
    value: snipeHeavy ? '50%' : '30%',
    simple: 'How much the price may move while your order travels. If it moves more than this, the order is cancelled instead of buying at a terrible price.',
    why: snipeHeavy
      ? 'GMGN suggests 50% or more for brand-new, busy coins, which is what this wallet buys.'
      : 'GMGN suggests 30-35% for automatic copy orders.',
  });
  const prioSol = snipeHeavy || !gradHeavy ? 0.003 : 0.001;
  items.push({
    setting: 'Priority fee',
    value: `${usd(solToUsd(prioSol, rate))} priority + ${usd(solToUsd(prioSol, rate))} tip per trade`,
    usd: solToUsd(prioSol * 2, rate),
    gmgnInput: prioSol,
    simple: 'A tip you pay the network so your trade goes through faster. Paid on every buy and every sell.',
    why: gradHeavy && !snipeHeavy
      ? 'This wallet buys coins that already graduated and holds for minutes, so a few seconds of speed matter less. A small fee saves you money on every trade.'
      : 'This wallet buys early, where seconds matter, so you pay a little more to keep up.',
  });
  items.push({
    setting: 'Anti-MEV',
    value: snipeHeavy ? 'On (Reduced protection)' : 'On (Secure protection)',
    simple: 'Hides your order from robots that jump in front of you and make you pay more.',
    why: snipeHeavy ? 'Reduced protection is faster, which early buys need.' : 'Secure protection is slightly slower but safest, and this wallet does not need split-second speed.',
  });

  // 4. advanced filters: copy only the trades where this wallet usually plays
  const mcMin = niceFloor(p.entryMcap?.p10);
  const mcMax = niceCeil(p.entryMcap?.p90);
  items.push({
    setting: 'Market Cap limit',
    value: mcMin && mcMax ? `${usdShort(mcMin)} to ${usdShort(mcMax)}` : 'No limit (not enough data)',
    simple: "A coin's market cap is what all of its coins are worth together. You only copy buys when the coin's value is inside this range.",
    why: mcMin ? `Nine out of ten of this wallet's buys happened between ${usdShort(mcMin)} and ${usdShort(mcMax)}. Outside that it is guessing.` : 'GMGN did not report enough prices to set a range.',
  });
  items.push({
    setting: 'Liquidity Limit',
    value: gradHeavy ? 'Minimum $10K' : 'No limit',
    simple: 'Liquidity is the money sitting in the trading pool. Too little means you cannot sell without crashing the price.',
    why: gradHeavy ? "GMGN's own coin checklist treats pools under $10K as a skip." : 'Coins still on the launch curve do not have a normal pool yet.',
  });
  const ageMin = p.entryAgeSec?.p10;
  const ageMax = p.entryAgeSec?.p90;
  items.push({
    setting: 'Token creation time limit',
    value: ageMin != null && ageMax != null ? `Coin age ${duration(Math.max(0, ageMin))} to ${duration(ageMax)}` : 'No limit',
    simple: 'How old a coin must be before you copy a buy, counted from the moment it was created.',
    why: ageMin != null ? `This wallet usually buys coins aged ${duration(Math.max(0, ageMin))} to ${duration(ageMax)}.` : 'Not enough data to set it.',
  });
  if (p.p25BuyUsd > 0) {
    items.push({
      setting: 'Minimum copy amount',
      value: `Only copy when the wallet spends ${usd(p.p25BuyUsd)} or more`,
      usd: p.p25BuyUsd,
      gmgnInput: solFor(p.p25BuyUsd),
      simple: 'Small buys are often the wallet testing a coin. This skips them so you only copy its real bets.',
      why: `A quarter of this wallet's buys are under ${usd(p.p25BuyUsd)}.`,
    });
  }
  if (p.medianBuyUsd > 0) {
    items.push({
      setting: 'Maximum copy amount',
      value: `Skip buys over ${usd(p.medianBuyUsd * 5)}`,
      usd: p.medianBuyUsd * 5,
      gmgnInput: solFor(p.medianBuyUsd * 5),
      simple: 'A giant buy can be a trick to pump the price before dumping. This skips those.',
      why: `This wallet normally spends about ${usd(p.medianBuyUsd)}. Five times that is unusual for it.`,
    });
  }
  items.push({
    setting: 'Single coin position increase times',
    value: '0',
    simple: 'You buy each coin once. If the wallet buys more of the same coin, you do not buy again.',
    why: `Every extra buy is another fee. This wallet adds to a coin ${(p.addsPerPosition ?? 0).toFixed(1)} times on average.`,
  });
  items.push({
    setting: 'Filter platform',
    value: p.platforms?.length ? p.platforms.join(', ') : 'All platforms',
    simple: 'Only copy coins launched on these sites.',
    why: p.platforms?.length ? 'These are where this wallet trades.' : 'No platform data.',
  });
  items.push({ setting: 'Blacklist', value: 'Leave empty', simple: 'Coins you never want to copy. Add a coin here if you never want to touch it.', why: 'Nothing to block yet.' });
  items.push({
    setting: 'Lightning Mode',
    value: 'Off',
    simple: 'A faster mode that acts before the network confirms the trade. It is about 2 seconds faster but can buy twice by mistake.',
    why: "GMGN warns it can repeat a buy or miss a sell. On a small account one mistake costs a lot.",
  });

  return {
    wallet: p.wallet,
    sizeUsd: size,
    capitalUsd,
    items,
    warnings,
    feeCheck: { roundTripUsd: rt.totalUsd, shareOfTrade: rt.shareOfTrade, minSizeFor10PctFees: minSizeFor10 },
  };
}
