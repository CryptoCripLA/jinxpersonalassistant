// Everything the terminal shows about one coin, in dollars: live price and flow, the safety
// readings, who bought first (exactly, from pump.fun's trade list when it has the whole
// history; otherwise GMGN's top traders ordered by when they first held), which wallets from
// your explosive list are in, the top holders, and the $25 scenario.
import { momentumScore } from '../analysis/momentum.js';
import { earlyBuyersFromTrades, earlyBuyersFromTopTraders, summarizeEarly } from '../analysis/earlybuyers.js';
import { scenario } from '../analysis/scenario.js';
import { cleanLabel } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function ratesFromInfo(p = {}) {
  const b1 = num(p.buys_1m);
  const b5 = num(p.buys_5m);
  return {
    windowSec: 60,
    buysPerMin: b1,
    sellsPerMin: num(p.sells_1m),
    swapsPerMin: num(p.swaps_1m),
    volumePerMinUsd: num(p.volume_1m),
    holdersPerMin: null,
    progressPerMin: null,
    smartAdded: null,
    acceleration: b1 != null && b5 > 0 ? b1 / (b5 / 5) : null,
    source: 'GMGN 1-minute and 5-minute windows',
  };
}

const change = (now, then) => (now != null && then > 0 ? now / then - 1 : null);

// GMGN's security route reports honeypots as honeypot: 0/1 (is_honeypot is null) and carries no
// rug ratio; the launch and trending lists do, so the live board's entry fills those in.
const flag = (a, b) => (a === true || a === 1 || a === '1' || b === true || b === 1 || b === '1' ? true : a === false || a === 0 || b === 0 || b === false ? false : null);

export async function coinDetail({ g, pf, token, explosive = new Map(), fees, sizeUsd = 25, nowSec = Math.floor(Date.now() / 1000), tapeRates = null, listItem = null, log = () => {} }) {
  const [info, security, holdersRaw] = await Promise.all([
    g.tokenInfoLive(token),
    g.tokenSecurity(token).catch(() => null),
    g.tokenHolders(token, { limit: 20 }).catch(() => null),
  ]);
  const p = info.price ?? {};
  const priceNowUsd = num(p.price);
  const supply = num(info.total_supply) ?? 1e9;
  const created = num(info.creation_timestamp);
  const mcap = priceNowUsd != null ? priceNowUsd * supply : null;
  const ath = num(info.ath_price);
  const graduatedTs = num(info.migrated_timestamp) || null;
  const progress = num(info.launchpad_progress);
  const isPump = /pump/i.test(info.launchpad || info.launchpad_platform || '');

  // ---- early buyers
  let buyers = [];
  let source = 'none';
  let note = '';
  if (isPump && pf) {
    try {
      const r = await pf.trades(token, { maxPages: 10 });
      if (r.trades.length && r.complete) {
        buyers = earlyBuyersFromTrades(r.trades, { totalSupply: supply, priceNowUsd, creationTs: created });
        source = 'pump.fun trades';
      } else {
        note = r.note || 'pump.fun did not return the whole history.';
      }
    } catch (e) {
      note = `pump.fun unavailable: ${e.message}`;
    }
  }
  if (!buyers.length) {
    const tt = await g.tokenTraders(token, { orderBy: 'profit', limit: 100 }).catch((e) => {
      log(`top traders unavailable for ${token}: ${e.message}`);
      return null;
    });
    buyers = earlyBuyersFromTopTraders(tt?.list ?? [], { totalSupply: supply, creationTs: created, priceNowUsd });
    source = buyers.length ? 'GMGN top traders' : 'none';
  }
  for (const b of buyers) {
    const e = explosive.get(b.wallet);
    if (e) {
      b.explosive = true;
      b.explosiveName = e.name ?? null;
    }
  }
  const explosiveIn = buyers.filter((b) => b.explosive);
  const summary = summarizeEarly(buyers, { first: 20, now: nowSec, explosive: new Set(explosive.keys()) });

  // ---- momentum
  const stat = info.stat ?? {};
  const tags = info.wallet_tags_stat ?? {};
  const flat = {
    address: token,
    symbol: info.symbol,
    market_cap: mcap,
    liquidity: num(info.liquidity),
    progress: graduatedTs ? 1 : progress,
    complete_timestamp: graduatedTs,
    smart_degen_count: num(tags.smart_wallets),
    renowned_count: num(tags.renowned_wallets),
    holder_count: num(info.holder_count),
    rug_ratio: num(listItem?.rug_ratio ?? security?.rug_ratio),
    is_honeypot: flag(security?.is_honeypot, security?.honeypot),
    is_wash_trading: listItem?.is_wash_trading ?? security?.is_wash_trading ?? null,
    top_10_holder_rate: num(stat.top_10_holder_rate),
    bot_degen_rate: num(stat.bot_degen_rate),
    dev_team_hold_rate: num(stat.dev_team_hold_rate),
    bundler_trader_amount_rate: num(listItem?.bundler_trader_amount_rate ?? stat.top_bundler_trader_percentage),
    rat_trader_amount_rate: num(listItem?.rat_trader_amount_rate ?? stat.top_rat_trader_percentage),
    entrapment_ratio: num(listItem?.entrapment_ratio ?? stat.top_entrapment_trader_percentage),
    suspected_insider_hold_rate: num(listItem?.suspected_insider_hold_rate),
    creator_token_status: info.dev?.creator_token_status,
  };
  const rates = tapeRates ?? ratesFromInfo(p);
  const momentum = momentumScore(flat, { now: nowSec, rates, explosiveWalletsIn: explosiveIn.map((b) => ({ wallet: b.wallet, ts: b.firstBuyTs })) });

  const link = info.link ?? {};
  const holders = (holdersRaw?.list ?? []).slice(0, 12).map((h) => ({
    wallet: h.address,
    share: num(h.amount_percentage),
    valueUsd: num(h.usd_value),
    isPool: h.addr_type != null && Number(h.addr_type) !== 0,
    tags: [...(h.tags ?? []), ...(h.maker_token_tags ?? [])].slice(0, 4),
    explosive: explosive.has(h.address),
  }));

  return {
    address: token,
    symbol: cleanLabel(info.symbol, 16),
    name: cleanLabel(info.name, 40),
    logo: typeof info.logo === 'string' && /^https:\/\//.test(info.logo) ? info.logo : '',
    launchpad: info.launchpad_platform || info.launchpad || '',
    isPump,
    creationTs: created,
    ageSec: created != null ? nowSec - created : null,
    graduatedTs,
    progress,
    priceUsd: priceNowUsd,
    marketCapUsd: mcap,
    athMarketCapUsd: ath != null ? ath * supply : null,
    multipleFromAth: ath > 0 && priceNowUsd != null ? priceNowUsd / ath : null,
    liquidityUsd: num(info.liquidity),
    holderCount: num(info.holder_count),
    totalSupply: supply,
    changes: { m1: change(priceNowUsd, num(p.price_1m)), m5: change(priceNowUsd, num(p.price_5m)), h1: change(priceNowUsd, num(p.price_1h)) },
    flow: {
      buys1m: num(p.buys_1m), sells1m: num(p.sells_1m), buys5m: num(p.buys_5m), sells5m: num(p.sells_5m),
      volume1mUsd: num(p.volume_1m), volume5mUsd: num(p.volume_5m), volume1hUsd: num(p.volume_1h), volume24hUsd: num(p.volume_24h),
    },
    safety: {
      rugRatio: flat.rug_ratio, honeypot: flat.is_honeypot, washTrading: flat.is_wash_trading,
      top10: flat.top_10_holder_rate, botRate: flat.bot_degen_rate, devTeamHold: flat.dev_team_hold_rate,
      bundlerShare: flat.bundler_trader_amount_rate, ratShare: flat.rat_trader_amount_rate, trapShare: flat.entrapment_ratio,
      sniperHold: num(stat.top70_sniper_hold_rate), freshWallets: num(stat.fresh_wallet_rate),
      devSold: info.dev?.creator_token_status === 'creator_close',
      mintRenounced: security?.renounced_mint ?? null, freezeRenounced: security?.renounced_freeze_account ?? null,
      insiderHold: flat.suspected_insider_hold_rate,
    },
    walletTags: { smart: num(tags.smart_wallets) ?? 0, kol: num(tags.renowned_wallets) ?? 0, snipers: num(tags.sniper_wallets) ?? 0, insiders: num(tags.rat_trader_wallets) ?? 0, bundlers: num(tags.bundler_wallets) ?? 0, whales: num(tags.whale_wallets) ?? 0 },
    links: {
      twitter: link.twitter_username ? `https://x.com/${String(link.twitter_username).replace(/^@/, '')}` : null,
      website: /^https?:\/\//.test(link.website ?? '') ? link.website : null,
      telegram: /^https?:\/\//.test(link.telegram ?? '') ? link.telegram : null,
    },
    rates,
    momentum,
    early: { source, note, buyers: buyers.slice(0, 60), summary },
    explosiveIn: explosiveIn.map((b) => ({ wallet: b.wallet, name: b.explosiveName, firstBuyTs: b.firstBuyTs, entryMcapUsd: b.entryMcapUsd, stillHolding: b.stillHolding })),
    holders,
    scenario: scenario({ sizeUsd, marketCapUsd: mcap, fees, venue: graduatedTs || (progress ?? 0) >= 1 ? 'pool' : 'curve' }),
    fetchedAt: nowSec,
  };
}
