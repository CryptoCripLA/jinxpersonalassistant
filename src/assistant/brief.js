// Proactive briefings: the analyst speaks first on every screen. Each briefing is a verdict in
// plain English (what to do), the evidence behind it from live and measured data, and one-click
// actions. No AI call: these come straight from the app's numbers, so they are instant and free.
import { usd, usdShort, usdSigned, usdWhole, pct } from '../money/usd.js';
import { duration } from '../text/plain.js';

const short = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '');
const nameOf = (p) => p?.name || short(p?.wallet);
const out = (text, evidence = [], actions = [], label = null) => ({ text, evidence: evidence.filter(Boolean), actions, label, by: 'built-in', proactive: true });

function coinVerdict(c) {
  const m = c.momentum ?? {};
  if (m.disqualified) return ['avoid', m.disqualified];
  if (m.stage === 'Fading') return ['wait it out', 'sellers are taking over'];
  if (m.stage === 'Watching') return ['not enough data yet', 'buying speed has not been measured'];
  if (m.stage === 'Ignition' && (m.warnings?.length ?? 0) <= 1) return ['worth a small try', 'buying is speeding up with real buyers'];
  if (m.stage === 'Ignition') return ['risky try', `buying is speeding up, but ${m.warnings.length} warnings`];
  return ['watch it', 'steady buying, not a breakout yet'];
}

export async function brief(ctx, svc) {
  const size = svc.user().sizeUsd;
  switch (ctx.view) {
    case 'today':
    case 'pulse': {
      const t = await svc.today();
      const top = t.traders?.picks?.[0];
      const opp = t.opportunities?.[0];
      const skip = t.traders?.skipped?.find((s) => (s.copy?.netUsd ?? 0) > 0);
      const parts = [
        top ? `Best trader to copy right now: ${nameOf(top)} (${top.type.label}).` : 'No measured trader fits your style yet; research is still running.',
        opp ? `Strongest live coin: ${opp.symbol} (${opp.momentum.stage}, ${opp.momentum.score}/100).` : 'No coin is igniting at this moment.',
      ];
      return out(
        `Here is what I found for you. ${parts.join(' ')}`,
        [
          t.plan?.text,
          top ? `${nameOf(top)}: ${top.why}` : null,
          opp?.realistic?.text,
          opp?.targetText,
          skip ? (skip.copy.trusted === false
            ? `I skipped ${nameOf(skip)}: ${skip.reasons[0]}`
            : `I skipped ${nameOf(skip)} despite its ${usdSigned(skip.copy.netUsd)} copy result: ${skip.reasons[0]}`) : null,
        ],
        [
          top ? { kind: 'copy', wallet: top.wallet, label: `Copy ${nameOf(top)}` } : null,
          top ? { kind: 'wallet', wallet: top.wallet, label: 'See trader' } : null,
          opp ? { kind: 'coin', address: opp.address, label: `Open ${opp.symbol}` } : null,
        ].filter(Boolean),
        'LIVE',
      );
    }
    case 'coin': {
      if (!ctx.coin?.address) return null;
      const c = await svc.coin(ctx.coin.address);
      const [verdict, why] = coinVerdict(c);
      const m = c.momentum ?? {};
      return out(
        `${c.symbol}: ${verdict} (${why}). It is at a ${usdShort(c.marketCapUsd)} market cap, momentum ${m.score ?? '?'}/100.`,
        [
          ...(m.reasons ?? []).slice(0, 3),
          c.explosiveIn?.length ? `Your traders in it: ${c.explosiveIn.map((w) => w.name || short(w.wallet)).join(', ')}.` : null,
          c.early?.summary?.text,
          ...(m.warnings ?? []).slice(0, 3).map((w) => `Risk: ${w}`),
          c.scenario?.breakevenMultiple ? `With ${usdWhole(size)} it must rise about ${pct(c.scenario.breakevenMultiple - 1, 0)} before you make a cent.` : null,
        ],
        [{ kind: 'ask', question: 'Who bought before everyone else?', label: 'Who bought first?' }, { kind: 'ask', question: `What happens if I put $${size} into this?`, label: `What would $${size} do?` }],
        'LIVE',
      );
    }
    case 'wallet': {
      if (!ctx.wallet) return null;
      const card = await svc.traderCard(ctx.wallet);
      if (!card) return out(`I have not measured ${short(ctx.wallet)} yet. Press "Measure" on this page and I will replay its recent coins with your ${usdWhole(size)}.`);
      const verdict = card.fit.level === 'fits' ? 'Copy-worthy' : card.fit.level === 'close' ? 'Worth watching' : 'Skip';
      return out(
        `${verdict}: ${card.type.label}. ${card.type.plain ?? ''}`,
        [
          `Your ${usdWhole(card.copy.sizeUsd)} copies of its last ${card.copy.trades} trades: ${usdSigned(card.copy.netUsd)} after fees and delay (SIMULATED).`,
          card.days?.activeDays ? `It would have reached your daily target on ${card.days.hitDays} of ${card.days.activeDays} active days; a typical day made ${usdSigned(card.days.medianDayUsd)}.` : null,
          ...card.fit.good.slice(0, 2),
          ...card.fit.reasons.map((r) => `Watch out: ${r}`),
          card.lastActiveSec != null ? `Last traded ${duration(card.lastActiveSec)} ago.` : null,
        ],
        card.fit.level === 'no' ? [] : [{ kind: 'copy', wallet: card.wallet, label: 'Copy this trader' }],
        'SIMULATED',
      );
    }
    case 'wallets': {
      const t = await svc.today();
      const picks = t.traders?.picks ?? [];
      return out(
        picks.length ? `${picks.length} trader${picks.length === 1 ? '' : 's'} fit your style out of ${t.traders.measured} I measured. Top: ${nameOf(picks[0])}.` : `None of the ${t.traders?.measured ?? 0} traders I measured fits your style yet. Research keeps adding wallets.`,
        picks.map((p) => `${nameOf(p)}: ${p.why}`),
        picks.map((p) => ({ kind: 'wallet', wallet: p.wallet, label: `See ${nameOf(p)}` })),
        'SIMULATED',
      );
    }
    case 'desk': {
      const st = svc.copyState();
      if (st.watches?.length) return out(`You are copying ${st.watches.length} trader${st.watches.length === 1 ? '' : 's'} in ${st.config.mode === 'off' ? 'Off mode (it only notes what it would copy)' : st.config.mode === 'confirm' ? 'Ask me first mode' : 'Automatic mode'}.`, [], [], 'LIVE');
      const t = await svc.today();
      const top = t.traders?.picks?.[0];
      return out(
        `You are not copying anyone yet, so the desk has nothing to do. ${top ? `I recommend starting with ${nameOf(top)}.` : 'Once a trader fits your style I will suggest one here.'}`,
        top ? [top.why] : [],
        top ? [{ kind: 'copy', wallet: top.wallet, label: `Copy ${nameOf(top)}` }] : [],
        'LIVE',
      );
    }
    case 'history': {
      const h = svc.historySummary();
      const early = (h.signals ?? []).filter((s) => s.early > 0).sort((a, b) => b.early / b.seen - a.early / a.seen)[0];
      return out(
        `${h.examples} past coins ran 7x or more: ${h.launches} were launch spikes (over in the first minutes, snipers only) and ${h.breakouts} were later breakouts you could have seen coming.`,
        [early ? `The signal that most often came early enough: "${early.label}" (${early.early} of ${early.seen} times before the breakout).` : null, 'Followers did best selling after a 30% drop from the high rather than waiting for a target.'],
        [],
        'HISTORICAL',
      );
    }
    case 'portfolio': {
      const p = await svc.portfolio();
      const open = (p.holdings ?? []).filter((x) => x.open);
      const best = [...open].sort((a, b) => (b.totalPct ?? 0) - (a.totalPct ?? 0))[0];
      return out(
        `You have ${usd(p.account?.totalUsd)} in cash and ${open.length} open position${open.length === 1 ? '' : 's'} worth ${usd(p.totals?.valueUsd)}.`,
        [
          best && best.totalPct > 1 ? `${best.symbol} is up ${pct(best.totalPct, 0)}: consider selling part to make the gain real.` : null,
          `Realized so far on these coins: ${usdSigned(p.totals?.realizedUsd)}; on paper: ${usdSigned(p.totals?.unrealizedUsd)}.`,
        ],
        [],
        'LIVE',
      );
    }
    default:
      return null;
  }
}
