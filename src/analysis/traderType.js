// What kind of trader is this, does it fit the owner's style, and how does it behave?
// Everything here turns measured numbers into plain sentences, and it is where contradictions
// get caught (a wallet with great copy results that buys 18 coins a day, or a replay that shows
// copiers beating a 1-minute flipper) so the owner never has to spot them in a table.
import { usd, usdShort, pct } from '../money/usd.js';
import { duration, roundNice } from '../text/plain.js';
import { replayTrusted } from './explosive.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const oneDec = (x) => Math.round(x * 10) / 10;

const TYPES = {
  bot: { label: 'Bot-like flipper', short: 'bot' },
  sniper: { label: 'Sniper', short: 'sniper' },
  early: { label: 'Early-entry hunter', short: 'early entries' },
  pregrad: { label: 'Pre-graduation trader', short: 'pre-graduation' },
  graduated: { label: 'Graduated-coin trader', short: 'graduated coins' },
  momentum: { label: 'Momentum trader', short: 'momentum' },
  mixed: { label: 'Mixed-style trader', short: 'mixed' },
};

export function classifyTrader(p) {
  const sm = p.stageMix ?? {};
  const cpd = p.coinsPerActiveDay;
  const hold = p.medianHoldSec;
  const mcap = p.entryMcap?.p50;
  const age = p.entryAgeSec?.p50;
  const at = isNum(mcap) ? ` at a typical ${usdShort(mcap)} market cap` : '';
  let type = 'mixed';
  let plain;
  if (cpd > 40 || (isNum(hold) && hold < 60 && cpd > 10)) {
    type = 'bot';
    plain = `Trades about ${roundNice(cpd)} coins a day and usually sells within ${duration(hold)}: machine speed, not something a person can copy.`;
  } else if ((sm.snipe ?? 0) >= 0.4 || (isNum(age) && age < 60)) {
    type = 'sniper';
    // the type can come from the snipe share or from launch timing alone; describe whichever it was
    plain = (sm.snipe ?? 0) >= 0.4
      ? `Buys ${pct(sm.snipe, 0)} of its coins in the first minute after launch${at}. It races bots for the launch.`
      : `Usually buys within ${duration(age)} of launch${at}. It races bots for the launch.`;
  } else if ((sm.early ?? 0) >= 0.4) {
    type = isNum(mcap) && mcap >= 25_000 ? 'pregrad' : 'early';
    plain = type === 'early'
      ? `Buys ${pct(sm.early, 0)} of its coins on the Pump.fun launch curve, after the first minute${at}${isNum(age) ? `, about ${duration(age)} after launch` : ''}.`
      : `Buys ${pct(sm.early, 0)} of its coins late on the launch curve${at}, betting they reach graduation.`;
  } else if ((sm.graduated ?? 0) >= 0.5) {
    type = (isNum(age) && age >= 6 * 3600) || (isNum(mcap) && mcap >= 1_000_000) ? 'momentum' : 'graduated';
    plain = type === 'graduated'
      ? `Buys ${pct(sm.graduated, 0)} of its coins after they graduated to a trading pool${at}${isNum(age) ? `, about ${duration(age)} after launch` : ''}.`
      : `Buys older coins that are already moving${at}${isNum(age) ? `, typically ${duration(age)} after launch` : ''}.`;
  } else {
    plain = `Mixes styles: ${['snipe', 'early', 'graduated'].map((k) => `${pct(sm[k] ?? 0, 0)} ${k === 'snipe' ? 'snipes' : k === 'early' ? 'launch-curve buys' : 'graduated coins'}`).join(', ')}.`;
  }
  const pace = isNum(hold) ? (hold < 600 ? 'quick flips' : hold > 2 * 3600 ? 'holds for hours' : null) : null;
  return { type, label: `${TYPES[type].label}${pace && type !== 'bot' ? ` · ${pace}` : ''}`, short: TYPES[type].short, plain };
}

// fits | close | no, with every reason in a sentence. "no" reasons are deal-breakers for copying.
export function styleFit(row, p, prefs) {
  const reasons = [];
  const good = [];
  let level = 'fits';
  const worse = (l) => {
    if (l === 'no' || (l === 'close' && level === 'fits')) level = l;
  };
  const cpd = row.coinsPerActiveDay ?? p.coinsPerActiveDay;
  const hold = row.medianHoldSec ?? p.medianHoldSec;
  const ex = row.explosive ?? {};
  const { minCoinsPerDay: lo, maxCoinsPerDay: hi, maxHoldSec } = prefs;
  if (isNum(cpd)) {
    if (cpd > hi * 2 || cpd < lo / 2) {
      worse('no');
      reasons.push(`Buys about ${oneDec(cpd)} coins a day; you want ${lo} to ${hi}. Copying it means taking the coins it picks, not the few you would.`);
    } else if (cpd > hi || cpd < lo) {
      worse('close');
      reasons.push(`Buys about ${oneDec(cpd)} coins a day, a bit ${cpd > hi ? 'more' : 'less'} than your ${lo} to ${hi}.`);
    } else good.push(`Buys about ${oneDec(cpd)} coins a day, inside your ${lo} to ${hi}.`);
  }
  if (isNum(hold)) {
    if (hold < 300) {
      worse('no');
      reasons.push(`Usually sells within ${duration(hold)}: faster than a copy can follow.`);
    } else if (hold > maxHoldSec * 2) {
      worse('no');
      reasons.push(`Usually holds ${duration(hold)}, far longer than your ${duration(maxHoldSec)}.`);
    } else if (hold > maxHoldSec) {
      worse('close');
      reasons.push(`Usually holds ${duration(hold)}, longer than your ${duration(maxHoldSec)}.`);
    } else good.push(`Usually sells within ${duration(hold)}.`);
  }
  const untrusted = !replayTrusted({ explosive: ex, medianHoldSec: hold });
  if (untrusted) {
    worse('no');
    // first: it decides how every other number about this wallet should be read
    reasons.unshift(`Its copy result cannot be trusted: it flips in about ${duration(hold)}, and the replay on 30-second prices shows copiers beating the wallet itself (${Math.round(ex.edgeKeptPct)}% of its edge), which does not happen in real trading.`);
  }
  for (const f of row.flags ?? []) {
    if (f === 'DISTRIBUTOR') { worse('no'); reasons.push('Sells far more often than it buys: it looks like it is unloading coins it got elsewhere.'); }
    if (f === 'HIGH_WINRATE_SUS') { worse('no'); reasons.push('Wins over 90% of 20+ trades: often farmed or faked.'); }
    if (f === 'DORMANT') { worse('no'); reasons.push('Has not traded in over two weeks.'); }
  }
  const copied = ex.copiedTrades ?? ex.trades ?? 0;
  if (copied < 5) {
    worse('no');
    reasons.push(`Only ${copied} copied trade${copied === 1 ? '' : 's'} in the last two weeks to judge it by.`);
  }
  if (isNum(ex.followerNetUsd)) {
    if (ex.followerNetUsd <= 0) {
      worse('no');
      reasons.push(`Copying it would have lost ${usd(-ex.followerNetUsd)} over its last ${copied} trades, after fees and delay.`);
    } else if (!untrusted) good.push(`Your copies of its last ${copied} trades would have made ${usd(ex.followerNetUsd)} after fees and a few seconds of delay.`);
  }
  if (isNum(ex.edgeKeptPct) && ex.edgeKeptPct > 0 && ex.edgeKeptPct <= 100) good.push(`A follower kept about ${Math.round(ex.edgeKeptPct)}% of its edge after the copy delay.`);
  return { level, reasons, good, untrusted };
}

export function describeBehavior(p, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const adds = p.addsPerPosition;
  return {
    buys: `Buys about ${oneDec(p.coinsPerActiveDay ?? 0)} coins a day on days it trades${isNum(adds) && adds >= 0.15 ? `, and adds more to about ${pct(Math.min(1, adds), 0)} of its positions` : ''}.`,
    holds: `Usually holds ${duration(p.medianHoldSec)}${isNum(p.shareHeldUnder2h) ? `; sells within 2 hours on ${pct(p.shareHeldUnder2h, 0)} of trades` : ''}.`,
    sells: isNum(p.sellPattern?.oneShot) ? `Sells all at once ${pct(p.sellPattern.oneShot, 0)} of the time and in pieces ${pct(p.sellPattern.scaled ?? 0, 0)}.` : 'Selling pattern unavailable.',
    last: isNum(p.lastTs) ? `Last traded ${duration(nowSec - p.lastTs)} ago.` : 'Last trade time unavailable.',
    realized: `Made ${usd(p.realizedUsd)} on finished trades in the history read, winning ${p.wins ?? 0} of ${p.closedCount ?? 0}.`,
  };
}

// "Actually takes profit, not just holds to zero": from the wallet's own finished trades.
export function exitHabits(outcomes) {
  const closed = (outcomes ?? []).filter((o) => o.status === 'closed' && isNum(o.walletCaptured));
  const tookProfit = closed.filter((o) => o.walletCaptured >= 1.5).length;
  const rodeToZero = closed.filter((o) => o.walletCaptured < 0.2).length;
  return {
    trades: closed.length,
    tookProfit,
    rodeToZero,
    text: closed.length ? `It took profit on ${tookProfit} of ${closed.length} finished trades (selling for 1.5x or more) and rode ${rodeToZero} of ${closed.length} to almost zero.` : 'No finished trades to judge its exits.',
  };
}
