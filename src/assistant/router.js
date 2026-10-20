// Built-in answers for the everyday questions. No AI involved: the numbers come straight
// from the service (GMGN data, the simulator, the settings sheet). Anything this router
// does not recognise goes to the Claude assistant if one is configured.
import { explainTerm, TERM_PATTERN } from './glossary.js';
import { usd, usdSigned, pct } from '../money/usd.js';
import { roundNice, duration } from '../text/plain.js';

const WALLET_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const WORD_NUM = { once: 1, one: 1, twice: 2, two: 2, three: 3, thrice: 3, four: 4, five: 5 };
const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function category(q) {
  if (/snip/i.test(q)) return 'snipe';
  if (/early|momentum|curve|pre-?grad/i.test(q)) return 'early';
  if (/graduat|migrat/i.test(q)) return 'graduated';
  return null;
}

function coinCategory(q) {
  if (/about to graduate|graduat\w* soon|near/i.test(q)) return 'near';
  if (/just graduat|graduated|migrated/i.test(q)) return 'graduated';
  if (/smart money|whale/i.test(q)) return 'smart';
  if (/trend|hot/i.test(q)) return 'trending';
  if (/new|launch|fresh/i.test(q)) return 'new';
  return 'graduated';
}

export function classify(q, ctx = {}) {
  const text = String(q ?? '');
  const wallet = text.match(WALLET_RE)?.[0] ?? (/\bthis (wallet|trader)\b/i.test(text) ? ctx.wallet : null) ?? null;
  const money = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  if (/^\s*(what('?s| is| are| does)|explain|define|meaning of)\b/i.test(text) && TERM_PATTERN.test(text) && !/settings?/i.test(text)) {
    return { intent: 'explain', params: { term: text.match(TERM_PATTERN)[0].toLowerCase() } };
  }
  if (/(would|could) i (have )?(made|make|earn|lost|lose)|copying .* with|simulate|what if i copied/i.test(text)) {
    return { intent: 'simulate', params: { wallet: wallet ?? ctx.wallet ?? null, sizeUsd: money ? Number(money[1]) : null } };
  }
  if (/\bsettings?\b|how should i (set|copy)|set it up/i.test(text)) return { intent: 'settings', params: { wallet: wallet ?? ctx.wallet ?? null } };
  if (/\bwhy\b.*\b(choose|chose|pick|picked|recommend)|instead of|\bcompare\b|\bvs\.?\b|better than/i.test(text)) {
    return { intent: 'compare', params: { wallets: [...text.matchAll(new RegExp(WALLET_RE, 'g'))].map((m) => m[0]) } };
  }
  const few = text.match(/(?:only|just)?\s*(once|twice|thrice|one|two|three|four|five|\d+)\s*(?:times?|trades?|coins?|buys?)?\s*(?:a|per)\s*day/i);
  if (few && /(trad|buy|coin|times|once|twice)/i.test(text)) return { intent: 'few_trades', params: { perDay: WORD_NUM[few[1].toLowerCase()] ?? Number(few[1]) } };
  // asking about a trader or wallet beats asking about coins ("best trader who buys graduated coins")
  if (/(best|top|good|who) .*(trader|wallet)|who (makes|made|earns) the most|suggest|which wallet|who should i copy/i.test(text)) {
    return { intent: 'best_wallet', params: { category: category(text) } };
  }
  if (/\b(coin|token|opportunit)/i.test(text) && /(best|strong|opportunit|right now|buy now|worth|should i buy|which)/i.test(text)) {
    return { intent: 'opportunity', params: { category: coinCategory(text) } };
  }
  if (TERM_PATTERN.test(text) && /\?$/.test(text.trim())) return { intent: 'explain', params: { term: text.match(TERM_PATTERN)[0].toLowerCase() } };
  return { intent: 'unknown', params: {} };
}

const reply = (text, evidence = [], actions = [], data = null) => ({ text, evidence, actions, data, by: 'built-in' });

export async function answer(q, ctx, svc) {
  const { intent, params } = classify(q, ctx);
  const size = svc.user().sizeUsd;
  switch (intent) {
    case 'explain': {
      const e = explainTerm(params.term);
      return e ? reply(e) : null;
    }
    case 'best_wallet': {
      if (!params.category) {
        const s = await svc.suggestions();
        if (!s.picks.length) return reply(s.note || 'No wallet would have made you money after fees right now.');
        const p = s.picks[0];
        return reply(
          `My top pick is ${p.name ?? short(p.wallet)} (${p.style}, ${p.match}). ${p.headline}`,
          p.reasons,
          s.picks.map((x) => ({ label: `Open ${x.name ?? short(x.wallet)}`, kind: 'wallet', wallet: x.wallet })),
          s,
        );
      }
      const b = (await svc.boards())[params.category] ?? [];
      const top = b.find((r) => r.fits) ?? b[0];
      if (!top) return reply(`I have no wallet yet with enough ${params.category} trades to judge. Run discovery to look at more wallets.`);
      return reply(
        `For ${params.category === 'snipe' ? 'sniping' : params.category === 'early' ? 'early momentum' : 'graduated coins'}, the best fit is ${short(top.wallet)}${top.fits ? '' : " (it doesn't fully match your style)"}: copying with ${usd(size)} a trade would have kept about ${usdSigned(top.keepPerWeekUsd)} a week after fees, before copy delay.`,
        top.reasons,
        b.slice(0, 5).map((x) => ({ label: `Open ${short(x.wallet)}`, kind: 'wallet', wallet: x.wallet })),
      );
    }
    case 'few_trades': {
      const ps = svc.profiles().filter((p) => p.coinsPerActiveDay != null && p.coinsPerActiveDay <= params.perDay + 0.5 && p.closedCount >= 5 && !p.flags?.includes('bot-speed'));
      if (!ps.length) return reply(`None of the wallets I've read buys ${params.perDay} or fewer coins a day with enough history. Run discovery to read more wallets.`);
      ps.sort((a, b) => b.realizedUsd / b.spanDays - a.realizedUsd / a.spanDays);
      const p = ps[0];
      return reply(
        `${short(p.wallet)} buys about ${roundNice(p.coinsPerActiveDay)} coins a day and made ${usd(p.realizedUsd)} on finished trades over ${roundNice(p.spanDays)} days (won ${p.wins} of ${p.closedCount}).`,
        [`Usually sells within ${duration(p.medianHoldSec)}.`, 'That is what the wallet made. Open it to see what you would have made after fees.'],
        ps.slice(0, 5).map((x) => ({ label: `Open ${short(x.wallet)}`, kind: 'wallet', wallet: x.wallet })),
      );
    }
    case 'simulate': {
      if (!params.wallet) return reply('Which wallet? Open a wallet first or paste its address in your question.');
      const r = await svc.simulate(params.wallet, { sizeUsd: params.sizeUsd ?? size });
      const t = r.typical;
      const sz = params.sizeUsd ?? size;
      if (!t.taken) return reply(`Copying ${short(params.wallet)} with ${usd(sz)} would not have made any trades in the last ${r.periodDays} days (${r.unavailable} had no price data, ${t.skippedNoCash} skipped for cash).`);
      return reply(
        `Copying ${short(params.wallet)} with ${usd(sz)} a trade over the last ${r.periodDays} days would have ended at ${usdSigned(t.netUsd)} for you, after ${usd(t.feesUsd)} in fees. With bad luck on every fill: ${usdSigned(r.rough.netUsd)}.`,
        [
          `The wallet itself made ${usd(r.wallet.realizedUsd)} on those same trades. That is its money, not yours.`,
          `You would have made ${t.taken} copies: ${t.wins} won, ${t.losses} lost${t.openPositions ? `, ${t.openPositions} still open` : ''}.`,
          `Assumes you copy ${r.assumptions.delaySec} seconds late and follow its sells. ${r.rateLine}.`,
        ],
        [{ label: 'Open simulator', kind: 'simulate', wallet: params.wallet }],
        r,
      );
    }
    case 'settings': {
      if (!params.wallet) return reply('Which wallet? Open a wallet first or paste its address.');
      const d = await svc.walletDetail(params.wallet);
      const s = d.settings;
      const main = s.items.filter((i) => ['Single copy buying method', 'Selling method', 'Market Cap limit', 'Minimum copy amount'].includes(i.setting));
      return reply(
        `For ${short(params.wallet)}: ${main.map((i) => `${i.setting}: ${i.value}`).join('. ')}.`,
        [...s.warnings, ...main.map((i) => `${i.setting}: ${i.simple}`)],
        [{ label: 'See every setting', kind: 'settings', wallet: params.wallet }],
        s,
      );
    }
    case 'compare': {
      const s = await svc.suggestions();
      const [a, b] = params.wallets.length >= 2 ? params.wallets.map((w) => s.picks.find((p) => p.wallet === w)).filter(Boolean) : s.picks;
      if (!a || !b) return reply('I need two wallets from your suggestions to compare. Ask again once two are listed, or paste two addresses.');
      return reply(
        `I ranked ${a.name ?? short(a.wallet)} above ${b.name ?? short(b.wallet)} because copying it would have made you more: ${usdSigned(a.perWeekUsd)} a week versus ${usdSigned(b.perWeekUsd)}, after fees.`,
        [
          `${short(a.wallet)}: ${a.style}, ${a.match}. ${a.reasons.join(' ')}`,
          `${short(b.wallet)}: ${b.style}, ${b.match}. ${b.reasons.join(' ')}`,
          'I rank by what you would have kept, not by what the wallet made, because fees and copy delay hit a small account harder.',
        ],
        [a, b].map((x) => ({ label: `Open ${short(x.wallet)}`, kind: 'wallet', wallet: x.wallet })),
      );
    }
    case 'opportunity': {
      const o = await svc.opportunities(params.category);
      const top = o.items[0];
      if (!top) return reply(`Nothing in "${o.label}" passes GMGN's safety checks right now.`);
      return reply(
        `In "${o.label}", ${top.symbol} looks strongest right now: it scores ${top.score}/100 on GMGN's checklist and is in the "${top.stage.name}" stage. ${top.stage.when}`,
        [...top.reasons.slice(0, 4), top.breakevenText].filter(Boolean),
        o.items.slice(0, 5).map((x) => ({ label: `${x.symbol} (${x.score})`, kind: 'coin', address: x.address })),
        o,
      );
    }
    default:
      return null;
  }
}

