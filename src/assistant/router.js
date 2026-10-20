// Built-in answers for the everyday questions. No AI involved: the numbers come straight
// from the service (GMGN data, the simulator, the settings sheet). Anything this router
// does not recognise goes to the Grok assistant (read-only tools) when its key is set.
import { explainTerm, TERM_PATTERN } from './glossary.js';
import { explainElement } from './explain.js';
import { usd, usdSigned, usdShort, pct } from '../money/usd.js';
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
  return 'explosive'; // no stage named: the live Explosive-now column
}

const MINT_IN = (text, ctx) => text.match(WALLET_RE)?.[0] ?? ctx.coin?.address ?? null;
const MULT = /(\d+(?:\.\d+)?)\s*x\b/i;

export function classify(q, ctx = {}) {
  const text = String(q ?? '');
  const wallet = text.match(WALLET_RE)?.[0] ?? (/\bthis (wallet|trader)\b/i.test(text) ? ctx.wallet : null) ?? null;
  const money = text.match(/\$\s?(\d+(?:\.\d+)?)/);
  // ---- what is on screen
  if (ctx.element?.key && /^\s*(explain( (this|that|it)( button| number| chart)?)?|what('?s| is| does) (this|that|it)\b|what am i looking at|what does this|what's this)/i.test(text)) {
    return { intent: 'explain_element', params: { element: ctx.element } };
  }
  if (/^\s*(what('?s| is| are| does)|explain|define|meaning of)\b/i.test(text) && TERM_PATTERN.test(text) && !/settings?/i.test(text)) {
    return { intent: 'explain', params: { term: text.match(TERM_PATTERN)[0].toLowerCase() } };
  }
  if (/(would|could) i (have )?(made|make|earn|lost|lose)|copying .* with|simulate|what if i copied/i.test(text)) {
    return { intent: 'simulate', params: { wallet: wallet ?? ctx.wallet ?? null, sizeUsd: money ? Number(money[1]) : null } };
  }
  // ---- explosive-move questions
  if (/\bwhy\b.*\b(pump\w*|up|moving|running|ripping|moon\w*|rising|going up)\b/i.test(text) && !/\b(sell|sold)\b/i.test(text)) {
    return { intent: 'why_pumping', params: { coin: MINT_IN(text, ctx) } };
  }
  if (money && /(put|into|in this|invest|turn|make|if (this|it) (reaches|hits|goes|gets))/i.test(text)) {
    return { intent: 'scenario', params: { coin: MINT_IN(text, ctx), sizeUsd: Number(money[1]), multiple: text.match(MULT) ? Number(text.match(MULT)[1]) : null } };
  }
  if (/(who|which wallets?).*\b(bought|got in|buy)\b.*\b(first|early|before)\b|bought before everyone|first buyers|earliest (buyers|wallets)/i.test(text)) {
    return { intent: 'first_buyers', params: { coin: MINT_IN(text, ctx) } };
  }
  if (/(early|first).*(still hold|holding|sold)|still holding/i.test(text)) {
    return { intent: 'early_holding', params: { coin: MINT_IN(text, ctx) } };
  }
  if (/(could|can|will|would|might)\b.*\b(reach|hit|get to|go|do|make it to)\b/i.test(text) && MULT.test(text)) {
    return { intent: 'reach_multiple', params: { coin: MINT_IN(text, ctx), multiple: Number(text.match(MULT)[1]) } };
  }
  if (/\bwhen\b.*\b(sell|selling|exit|take profit)|why did .*\bsell|why .*\bsold\b/i.test(text)) {
    return { intent: 'when_selling', params: { coin: MINT_IN(text, ctx), wallet: wallet ?? ctx.wallet ?? null } };
  }
  if (/before (graduat|migrat)/i.test(text)) return { intent: 'before_graduation', params: {} };
  if (/explosive wallet|\b(wallet|trader)s?\b.*\b(repeatedly|keeps?|consistently|always)\b|catch(es)? explosive/i.test(text)) {
    return { intent: 'explosive_wallets', params: {} };
  }
  const last = text.match(/last (\d+|ten|five) (coins|trades|tokens)/i);
  if (last || /what did (this|that) (wallet|trader) do/i.test(text)) {
    const n = last ? (Number(last[1]) || { ten: 10, five: 5 }[last[1].toLowerCase()]) : 10;
    return { intent: 'wallet_last', params: { wallet: wallet ?? ctx.wallet ?? null, count: n } };
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
  if (/\b(coin|token|opportunit)/i.test(text) && /(best|strong|promising|opportunit|right now|buy now|worth|should i buy|which)/i.test(text)) {
    return { intent: 'opportunity', params: { category: coinCategory(text) } };
  }
  if (TERM_PATTERN.test(text) && /\?$/.test(text.trim())) return { intent: 'explain', params: { term: text.match(TERM_PATTERN)[0].toLowerCase() } };
  return { intent: 'unknown', params: {} };
}

const reply = (text, evidence = [], actions = [], data = null, label = null) => ({ text, evidence, actions, data, label, by: 'built-in' });
const x = (m) => (m == null || !Number.isFinite(m) ? '?' : `${roundNice(m)}x`);
const needCoin = () => reply('Which coin? Open a coin first (click it on the Pulse board) or paste its address.');
const who = (b) => (b.explosiveName ? `${b.explosiveName} (${short(b.wallet)})` : short(b.wallet));

export async function answer(q, ctx, svc) {
  const { intent, params } = classify(q, ctx);
  const size = svc.user().sizeUsd;
  switch (intent) {
    case 'explain_element':
      return explainElement(params.element, ctx);
    case 'explain': {
      const e = explainTerm(params.term);
      return e ? reply(e) : null;
    }
    case 'why_pumping': {
      if (!params.coin) return needCoin();
      const c = await svc.coin(params.coin);
      const moves = [c.changes?.m5 != null ? `${pct(c.changes.m5, 0)} in 5 minutes` : null, c.changes?.h1 != null ? `${pct(c.changes.h1, 0)} in the last hour` : null].filter(Boolean).join(' and ');
      return reply(
        `${c.symbol} is moving ${moves || 'right now'} at a ${usdShort(c.marketCapUsd)} market cap. Stage: ${c.momentum.stage}, momentum ${c.momentum.score}/100. Here is what the live data shows:`,
        [
          ...c.momentum.reasons,
          ...(c.explosiveIn?.length ? [`Explosive wallets in: ${c.explosiveIn.map((w) => w.name ?? short(w.wallet)).join(', ')}.`] : []),
          c.early?.summary?.text,
          ...c.momentum.warnings.map((w) => `Risk: ${w}`),
        ].filter(Boolean),
        [{ label: 'Who bought first?', kind: 'ask', question: 'Who bought before everyone else?' }, { label: 'What would $25 do?', kind: 'ask', question: `What happens if I put $${size} into this?` }],
        null,
        'LIVE',
      );
    }
    case 'first_buyers': {
      if (!params.coin) return needCoin();
      const c = await svc.coin(params.coin);
      const first = (c.early?.buyers ?? []).slice(0, 6);
      if (!first.length) return reply(`I could not get ${c.symbol}'s buyers from pump.fun or GMGN right now.`);
      const line = (b) => `#${b.rank} ${who(b)}: bought ${b.secondsAfterLaunch != null ? `${duration(b.secondsAfterLaunch)} after launch ` : ''}at a ${usdShort(b.entryMcapUsd)} market cap, now ${x(b.multipleNow)}; ${b.stillHolding ? 'still holding' : `sold${b.capturedMultiple ? ` at about ${x(b.capturedMultiple)}` : ''}`}.`;
      return reply(
        `The first buyer of ${c.symbol} was ${who(first[0])}, ${first[0].secondsAfterLaunch != null ? `${duration(first[0].secondsAfterLaunch)} after launch` : 'early'}, at a ${usdShort(first[0].entryMcapUsd)} market cap (${c.early.source}).`,
        [...first.map(line), c.early.summary?.text].filter(Boolean),
        first.slice(0, 4).map((b) => ({ label: `Open ${short(b.wallet)}`, kind: 'wallet', wallet: b.wallet })),
        null,
        'LIVE',
      );
    }
    case 'early_holding': {
      if (!params.coin) return needCoin();
      const c = await svc.coin(params.coin);
      const winners = (c.early?.buyers ?? []).filter((b) => b.rank <= 20 && b.profitUsd > 0);
      return reply(
        c.early?.summary?.text ?? 'Early-buyer data is unavailable right now.',
        winners.slice(0, 6).map((b) => `${who(b)}: up ${x(b.multipleNow)} from its entry, ${b.stillHolding ? `still holds ${pct(b.heldShare ?? 1, 0)} of its coins` : 'sold out'}.`),
        [{ label: 'See early buyers', kind: 'tab', tab: 'early' }],
        null,
        'LIVE',
      );
    }
    case 'reach_multiple': {
      if (!params.coin) return needCoin();
      const c = await svc.coin(params.coin);
      const target = c.marketCapUsd != null ? c.marketCapUsd * params.multiple : null;
      const base = svc.studyStats?.()?.reachedFromBase?.(c.marketCapUsd, params.multiple);
      const ev = [`Momentum ${c.momentum.score}/100, stage ${c.momentum.stage}.`, ...c.momentum.reasons.slice(0, 3), ...c.momentum.warnings.slice(0, 3).map((w) => `Risk: ${w}`)];
      if (base?.of) ev.unshift(`${base.count} of the ${base.of} past explosive coins I studied that traded near this market cap went on to ${params.multiple}x from there. Those coins all ran, so the real odds for a random coin are much lower.`);
      return reply(
        `For ${c.symbol} to reach ${params.multiple}x from here, its market cap has to go from ${usdShort(c.marketCapUsd)} to ${usdShort(target)}. That is not a prediction: no one can know. What the data says today:`,
        ev,
        [{ label: `What would $${size} make at ${params.multiple}x?`, kind: 'ask', question: `How much could $${size} make if this reaches ${params.multiple}x?` }],
        null,
        'LIVE',
      );
    }
    case 'scenario': {
      if (!params.coin) return needCoin();
      const c = await svc.coin(params.coin);
      const s = await svc.scenarioFor(c, params.sizeUsd, params.multiple);
      const be = s.breakevenMultiple != null ? `It must rise about ${pct(s.breakevenMultiple - 1, 0)} just to pay the fees in and out.` : 'Fees could not be fully priced.';
      if (params.multiple != null) {
        const row = s.rows.find((r) => r.multiple === params.multiple);
        return reply(
          row ? `If ${c.symbol} reaches ${params.multiple}x (market cap ${usdShort(row.targetMarketCapUsd)}), $${params.sizeUsd} becomes about ${usd(row.proceedsUsd)} after fees (${usdSigned(row.netUsd)}).` : `I could not price ${params.multiple}x.`,
          [be, 'If it goes to zero you lose the whole amount. This is a projection on today\'s market cap, not a prediction.'],
          [],
          s,
          'SIMULATED',
        );
      }
      return reply(
        `$${params.sizeUsd} into ${c.symbol} at a ${usdShort(c.marketCapUsd)} market cap:`,
        [...s.rows.filter((r) => [0, 0.5, 2, 3, 7, 10, 19].includes(r.multiple)).map((r) => r.text), be],
        [],
        s,
        'SIMULATED',
      );
    }
    case 'when_selling': {
      if (params.coin) {
        const c = await svc.coin(params.coin);
        const sold = (c.early?.buyers ?? []).filter((b) => b.lastSellTs != null && b.profitUsd > 0).sort((a, b) => b.lastSellTs - a.lastSellTs);
        const nowS = Math.floor(Date.now() / 1000);
        return reply(
          sold.length
            ? `${sold.length} profitable early wallet${sold.length === 1 ? ' has' : 's have'} sold ${c.symbol}. I can't see why anyone sells, only when and at what price. The most recent:`
            : `None of ${c.symbol}'s profitable early wallets has sold yet.`,
          sold.slice(0, 6).map((b) => `${who(b)} sold ${duration(nowS - b.lastSellTs)} ago${b.capturedMultiple ? ` at about ${x(b.capturedMultiple)} its entry` : ''}; ${b.stillHolding ? `still holds ${pct(b.heldShare ?? 0, 0)}` : 'now fully out'}.`),
          [{ label: 'See early buyers', kind: 'tab', tab: 'early' }],
          null,
          'LIVE',
        );
      }
      if (params.wallet) {
        const w = svc.walletExplosive(params.wallet);
        const outs = (w?.outcomes ?? []).filter((o) => o.walletCaptured != null);
        return reply(
          `I can't see a trader's reasons, only timing. ${short(params.wallet)} usually sells after ${duration(w?.explosive?.medianHoldSec)} and captures a median ${pct(w?.explosive?.medianCaptureShare ?? null, 0)} of the move that was available.`,
          outs.slice(-5).reverse().map((o) => `${o.symbol}: sold at ${x(o.walletCaptured)} after ${duration(o.holdSec)}; the coin's high after its buy was ${x(o.tokenMaxMultiple)}.`),
          [],
          null,
          'HISTORICAL',
        );
      }
      return needCoin();
    }
    case 'explosive_wallets':
    case 'before_graduation': {
      let board = (svc.explosiveBoard() ?? []).filter((r) => r.isExplosive);
      if (intent === 'before_graduation') board = board.filter((r) => ((r.stageMix?.early ?? 0) + (r.stageMix?.snipe ?? 0)) >= 0.5);
      if (!board.length) return reply('No measured wallet has handed a follower a 3x yet. The wallet measurement may still be running; check the Explosive wallets tab.', [], [{ label: 'Explosive wallets', kind: 'view', view: 'wallets' }]);
      const top = board[0];
      const ex = top.explosive;
      const name = top.name ?? short(top.wallet);
      return reply(
        `${name} ${intent === 'before_graduation' ? 'gets in before graduation and ' : ''}catches explosive moves you could have copied: following it with $${size} a trade would have made about ${usdSigned(top.perActiveDayUsd)} per active day after fees and copy delay.`,
        [
          `Its buys went on to 7x+ ${ex.found?.[7] ?? 0} times; your copies would have caught 3x+ ${ex.followerCaptured?.[3] ?? 0} times and 5x+ ${ex.followerCaptured?.[5] ?? 0} times (SIMULATED).`,
          ex.edgeKeptPct != null ? `A follower kept ${pct(ex.edgeKeptPct / 100, 0)} of its edge after the copy delay.` : 'Edge kept after delay: unavailable.',
          ...board.slice(1, 4).map((r) => `${r.name ?? short(r.wallet)}: ${usdSigned(r.perActiveDayUsd)} per active day, ${r.explosive.followerCaptured?.[3] ?? 0} copied 3x+ wins.`),
        ],
        [{ label: 'Explosive wallets', kind: 'view', view: 'wallets' }, ...board.slice(0, 3).map((r) => ({ label: `Open ${r.name ?? short(r.wallet)}`, kind: 'wallet', wallet: r.wallet }))],
        null,
        'SIMULATED',
      );
    }
    case 'wallet_last': {
      if (!params.wallet) return reply('Which wallet? Open a wallet first or paste its address.');
      const w = svc.walletExplosive(params.wallet);
      if (!w?.outcomes?.length) return reply(`I have not measured ${short(params.wallet)}'s recent coins yet. Open it to start.`, [], [{ label: `Open ${short(params.wallet)}`, kind: 'wallet', wallet: params.wallet }]);
      const outs = [...w.outcomes].sort((a, b) => b.entryTs - a.entryTs).slice(0, params.count);
      return reply(
        `${short(params.wallet)}'s last ${outs.length} coins: how high each went after it bought, what it sold for, and what your $${size} copy would have made.`,
        outs.map((o) => `${o.symbol}: went ${x(o.tokenMaxMultiple)} after it bought at ${usdShort(o.entryMcapUsd)}; it ${o.walletCaptured != null ? `sold for ${x(o.walletCaptured)}` : 'still holds'}${o.holdSec != null ? ` after ${duration(o.holdSec)}` : ''}; your copy: ${o.followerNetUsd != null ? usdSigned(o.followerNetUsd) : 'unavailable'}.`),
        [{ label: `Open ${short(params.wallet)}`, kind: 'wallet', wallet: params.wallet }],
        null,
        'HISTORICAL + SIMULATED',
      );
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
      if (params.category === 'explosive') {
        let list = svc.pulseColumns()?.explosive ?? [];
        if (ctx.visible?.length) list = list.filter((c) => ctx.visible.includes(c.address)).concat(list.filter((c) => !ctx.visible.includes(c.address)));
        const top = list[0];
        if (!top) return reply('Nothing on the live board shows strong momentum right now. The board updates every few seconds while the terminal is open.', [], [{ label: 'Pulse', kind: 'view', view: 'pulse' }]);
        return reply(
          `${top.symbol} has the strongest live momentum right now: ${top.momentum.score}/100, stage ${top.momentum.stage}, at a ${usdShort(top.marketCapUsd)} market cap. Momentum is a shortlist, not a promise.`,
          [...top.momentum.reasons.slice(0, 4), ...(top.momentum.warnings ?? []).slice(0, 2).map((w) => `Risk: ${w}`), ...list.slice(1, 4).map((c) => `Next: ${c.symbol} ${c.momentum.score}/100 (${c.momentum.stage}).`)],
          list.slice(0, 4).map((c) => ({ label: `${c.symbol} (${c.momentum.score})`, kind: 'coin', address: c.address })),
          null,
          'LIVE',
        );
      }
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

