// The advisor: decides FOR the owner. Picks the traders that fit his style (and says why),
// names the high earners it rejected (and says why), and turns the live board into a few
// opportunities with the dollars he could realistically capture, kept apart from the
// theoretical 10x.
import { classifyTrader, styleFit, describeBehavior, exitHabits } from '../analysis/traderType.js';
import { walletDays } from '../analysis/mission.js';
import { scenario } from '../analysis/scenario.js';
import { usd, usdWhole, usdSigned, pct } from '../money/usd.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const RANK = { fits: 0, close: 1, no: 2 };

export function recommendTraders(board, profiles, prefs, { nowSec = Math.floor(Date.now() / 1000), max = 3, tzOffsetSec = 0 } = {}) {
  const all = board.map((row) => {
    const p = profiles.get(row.wallet) ?? row;
    const ex = row.explosive ?? {};
    const fit = styleFit(row, p, prefs);
    // the edge is how it exits: reward taking profit, mark down riding losers to zero
    const exits = exitHabits(row.outcomes);
    if (exits.trades >= 5 && exits.rodeToZero / exits.trades > 0.3) {
      if (fit.level === 'fits') fit.level = 'close';
      fit.reasons.push(`Rides losers to almost zero on ${exits.rodeToZero} of ${exits.trades} trades instead of cutting them.`);
    } else if (exits.trades >= 5 && exits.tookProfit / exits.trades >= 0.3) fit.good.push(exits.text);
    const type = classifyTrader(p);
    const days = walletDays(row.outcomes ?? [], { targetUsd: prefs.dailyTargetUsd, maxCoinsPerDay: prefs.maxCoinsPerDay, tzOffsetSec });
    const size = row.sizeUsd ?? prefs.sizeUsd;
    const n = ex.copiedTrades ?? ex.trades ?? 0;
    return {
      wallet: row.wallet,
      name: row.name ?? null,
      type,
      fit,
      days,
      behavior: { ...describeBehavior(p, { nowSec }), exits: exits.text },
      exits,
      coinsPerDay: row.coinsPerActiveDay ?? p.coinsPerActiveDay ?? null,
      holdSec: row.medianHoldSec ?? p.medianHoldSec ?? null,
      lastActiveSec: isNum(row.lastTs) ? nowSec - row.lastTs : null,
      perActiveDayUsd: row.perActiveDayUsd ?? null,
      explosive: ex,
      copy: { netUsd: ex.followerNetUsd ?? null, trades: n, wins: ex.followerWins ?? null, losses: ex.followerLosses ?? null, sizeUsd: size, periodDays: row.periodDays ?? 14, delaySec: row.delaySec ?? null },
      why: `${type.plain} Your ${usdWhole(size)} copies of its last ${n} trades would have made ${usd(ex.followerNetUsd)} after fees and a few seconds of delay.`,
      reasons: fit.reasons,
    };
  });
  const picks = all
    .filter((r) => r.fit.level !== 'no')
    .sort((a, b) => RANK[a.fit.level] - RANK[b.fit.level] || (b.days.hitDays ?? 0) - (a.days.hitDays ?? 0) || (b.perActiveDayUsd ?? -Infinity) - (a.perActiveDayUsd ?? -Infinity))
    .slice(0, max);
  const skipped = all
    .filter((r) => r.fit.level === 'no')
    .sort((a, b) => (b.copy.netUsd ?? -Infinity) - (a.copy.netUsd ?? -Infinity));
  return { picks, skipped, measured: all.length, fitting: all.filter((r) => r.fit.level !== 'no').length };
}

// kind: 'momentum' (the Explosive-now column) or 'migration' (just graduated off the launch curve:
// the play profitable traders prefer over block-0 launches). Coins failing a hard filter
// (mint or freeze still active, a few wallets owning most of it) are never offered.
export function opportunitiesForYou(explosive, { study = {}, fees, sizeUsd = 25, targetUsd = null, picks = [], max = 3, kind = 'momentum', nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const names = new Map(picks.map((p) => [p.wallet, p.name]));
  return (explosive ?? [])
    .filter((c) => !c.momentum?.disqualified && c.checks?.pass !== false)
    .slice(0, max)
    .map((c) => {
      const venue = isNum(c.progress) && c.progress < 1 && !c.completeTs ? 'curve' : 'pool';
      const base = kind === 'migration' ? study.migrationMedian ?? study.followableMedian : study.followableMedian;
      const real = isNum(base) ? Math.round(base * 10) / 10 : null;
      const s = scenario({ sizeUsd, marketCapUsd: c.marketCapUsd, fees, venue, multiples: [real ?? 2, 10] });
      const at = (m) => s.rows.find((r) => r.multiple === m);
      const realRow = real != null ? at(real) : null;
      const tenRow = at(10);
      const covers = realRow && isNum(targetUsd) && targetUsd > 0 ? `A ${real}x would cover ${pct(Math.min(1, realRow.netUsd / targetUsd), 0)} of your ${usdWhole(targetUsd)} target.` : '';
      return {
        kind,
        checks: c.checks ?? null,
        address: c.address,
        symbol: c.symbol,
        name: c.name ?? '',
        logo: c.logo ?? '',
        marketCapUsd: c.marketCapUsd,
        ageSec: c.ageSec,
        momentum: c.momentum,
        evidence: [...(c.momentum?.reasons ?? []).slice(0, 4), ...(c.momentum?.warnings ?? []).slice(0, 2).map((w) => `Risk: ${w}`)],
        walletsIn: (c.explosiveIn ?? []).map((w) => ({ wallet: w.wallet, name: names.get(w.wallet) ?? null })),
        realistic: realRow
          ? { multiple: real, netUsd: realRow.netUsd, proceedsUsd: realRow.proceedsUsd, text: `If it gives a follower what ${kind === 'migration' ? 'buying at graduation typically gave on past runners' : 'entering after the first signal typically gave on past runners'} (${real}x, selling after a 30% drop from the high), ${usdWhole(sizeUsd)} becomes about ${usd(realRow.proceedsUsd)} (${usdSigned(realRow.netUsd)}) after fees. Those coins all ran; most coins do not.` }
          : { multiple: null, netUsd: null, proceedsUsd: null, text: 'No history study yet to say what followers typically capture.' },
        theoretical: { multiple: 10, netUsd: tenRow.netUsd, proceedsUsd: tenRow.proceedsUsd, text: `A full 10x would turn ${usdWhole(sizeUsd)} into about ${usd(tenRow.proceedsUsd)}${isNum(study.tenXFollowable) && study.examples ? `, but only ${study.tenXFollowable} of ${study.examples} signal-following entries on past runners reached 10x` : ''}.` },
        targetText: covers,
        entry: kind === 'migration'
          ? `It graduated to a trading pool ${isNum(c.completeTs) ? `${Math.max(1, Math.round((nowSec - c.completeTs) / 60))} minutes ago` : 'recently'}: migration buys beat block-0 launch snipes for most traders. Momentum ${c.momentum?.stage ?? 'unknown'}.`
          : `Momentum stage is ${c.momentum?.stage ?? 'unknown'}${c.momentum?.stage === 'Ignition' ? ': buying is speeding up right now, the window past runners rewarded' : c.momentum?.stage === 'Building' ? ': steady buying, not yet a breakout; a smaller size or a wait for Ignition fits' : ''}.`,
        exit: 'Decide the exit before buying: in the history study, followers did best selling after a 30% drop from the high instead of waiting for a target.',
        breakevenMultiple: s.breakevenMultiple,
        score: c.momentum?.score ?? null,
      };
    });
}
