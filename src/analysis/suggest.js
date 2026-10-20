// "Suggestions": the 3-5 wallets that would have made YOU the most dollars.
// Order is decided by the full copy simulation (your delay, real candle prices,
// every fee, your cash), not by what the wallet itself made.
import { preferenceFit, DEFAULT_PREFS } from './profile.js';
import { quickKeepEstimate } from './rank.js';
import { usd, usdSigned, pct } from '../money/usd.js';
import { STAGE_SHORT, duration, roundNice } from '../text/plain.js';

const MIN_SPAN_DAYS = 3;
const MIN_CLOSED = 8;

function closeMatch(p, prefs) {
  // one soft rule broken by a little: up to 5 coins a day, or "generally" under 2 hours for 40%+
  const coinsOk = p.coinsPerActiveDay != null && p.coinsPerActiveDay <= prefs.maxCoinsPerDay + 2;
  const holdOk = p.shareHeldUnder2h == null || p.shareHeldUnder2h >= 0.4;
  return coinsOk && holdOk;
}

function mainStage(p) {
  return ['graduated', 'early', 'snipe'].sort((a, b) => (p.stageMix?.[b] ?? 0) - (p.stageMix?.[a] ?? 0))[0];
}

export async function suggestWallets({ profiles, sizeUsd, capitalUsd, fees, simulate, prefs = DEFAULT_PREFS, max = 5, shortlist = 8 }) {
  const pool = [];
  for (const p of profiles) {
    if (p.flags?.includes('bot-speed') || p.flags?.includes('wash-trader')) continue;
    if (!(p.spanDays >= MIN_SPAN_DAYS) || p.closedCount < MIN_CLOSED) continue;
    const fit = preferenceFit(p, prefs);
    const match = fit.fits ? 'match' : closeMatch(p, prefs) ? 'close match' : null;
    if (!match) continue;
    const quick = quickKeepEstimate(p.positions, { sizeUsd, fees });
    if (!(quick.keepUsd > 0)) continue;
    pool.push({ p, fit, match, quick });
  }
  pool.sort((a, b) => (a.match === b.match ? 0 : a.match === 'match' ? -1 : 1) || b.quick.keepUsd / b.p.spanDays - a.quick.keepUsd / a.p.spanDays);
  const picks = [];
  for (const c of pool.slice(0, shortlist)) {
    const sim = await simulate(c.p);
    const net = sim?.typical?.netUsd;
    if (!(net > 0)) continue;
    const days = sim.periodDays ?? c.p.spanDays;
    const perWeekUsd = (net / days) * 7;
    const stage = mainStage(c.p);
    const name = c.p.gmgn30?.identity?.twitter ? `@${c.p.gmgn30.identity.twitter}` : c.p.gmgn30?.identity?.name || null;
    picks.push({
      wallet: c.p.wallet,
      name,
      match: c.match,
      style: STAGE_SHORT[stage],
      perWeekUsd,
      netUsd: net,
      roughNetUsd: sim.rough?.netUsd ?? null,
      walletRealizedUsd: sim.wallet?.realizedUsd ?? null,
      periodDays: days,
      copies: sim.typical.taken,
      copyWins: sim.typical.wins,
      feesUsd: sim.typical.feesUsd,
      headline: `With ${usd(sizeUsd)} a trade you would have made about ${usdSigned(perWeekUsd)} a week (${usdSigned(net)} over ${roundNice(days)} days), after every fee, copying ${sim.assumptions?.delaySec ?? 5} seconds late.`,
      reasons: [
        `Trades ${STAGE_SHORT[stage]} coins, about ${roundNice(c.p.coinsPerActiveDay)} a day, and usually sells within ${duration(c.p.medianHoldSec)}.`,
        `Your copies would have won ${sim.typical.wins} of ${sim.typical.wins + sim.typical.losses} finished trades; fees would have cost you ${usd(sim.typical.feesUsd)}.`,
        sim.rough?.netUsd != null ? `With bad luck on every fill it would have been ${usdSigned(sim.rough.netUsd)}.` : null,
      ].filter(Boolean),
      differences: c.fit.reasons,
    });
  }
  picks.sort((a, b) => b.perWeekUsd - a.perWeekUsd);
  const top = picks.slice(0, max);
  const note =
    top.length === 0
      ? 'No wallet would have made you money after fees right now. Refresh discovery later or raise your trade size.'
      : top.length < 3
        ? `Only ${top.length} wallet${top.length === 1 ? '' : 's'} would have made you money after fees right now.`
        : '';
  return { picks: top, note, capitalUsd, sizeUsd, considered: pool.length };
}

