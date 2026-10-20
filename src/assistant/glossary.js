// Trading words explained like you're new to this. No SOL talk: money is dollars.
export const GLOSSARY = {
  slippage: 'Slippage is how much the price is allowed to move while your order is on its way. If you set 30% and the price jumps more than that before your order lands, the order is cancelled instead of buying at a terrible price.',
  'market cap': "Market cap is what all of a coin's tokens are worth together: the price of one token times how many exist. A $50K coin is tiny and jumpy; a $5M coin is bigger and moves slower.",
  liquidity: 'Liquidity is the money sitting in the trading pool for a coin. More liquidity means you can buy and sell without moving the price much. Under about $10K, even a small sale can crash the price.',
  'anti-mev': 'Anti-MEV hides your order from robots that see it coming, jump in front of you, and make you pay more. It is like whispering your order instead of shouting it.',
  'bonding curve': 'A bonding curve is the launch stage on sites like Pump.fun. The price goes up automatically as people buy. When enough money comes in, the coin "graduates" to a normal trading pool.',
  graduated: 'A graduated coin finished its launch curve on Pump.fun and moved to a normal trading pool. It has survived its first stage, so it is usually a little less wild than a brand-new coin.',
  'rug pull': 'A rug pull is when the people behind a coin dump it or pull the money out, so the price crashes to almost nothing. GMGN gives each coin a rug-risk score to warn you.',
  'priority fee': 'A priority fee is a small tip you pay the network so your trade goes through faster. You pay it on every buy and every sell, so on small trades it adds up quickly.',
  'tip fee': 'A tip fee is an extra tip paid to fast private routes so your trade is processed sooner. Like the priority fee, it is paid on every transaction.',
  kol: 'A KOL ("key opinion leader") is an influencer wallet: someone famous on crypto Twitter. Their buys bring attention, but attention is not proof the coin will go up.',
  'smart money': "Smart money means wallets GMGN's own math marks as consistently profitable. When several of them buy the same coin, that is a stronger signal than one influencer.",
  sniping: 'Sniping means buying a coin in its first seconds after it is created. It can pay off big, but you are racing robots, and fees plus speed make it very hard to copy.',
  'early momentum': 'Early momentum trading means buying a coin while it is still on its launch curve, after the first minute, when it starts moving fast.',
  'win rate': 'Win rate is the share of finished trades that made money. 60% means 6 out of 10 trades won. It does not say how big the wins and losses were.',
  'copy trading': "Copy trading means your account automatically buys and sells what another wallet buys and sells. You copy its moves, but you pay your own fees and you are always a few seconds behind.",
  'take profit': 'Take profit is an automatic sale when the coin rises by the amount you chose, so you lock in a win.',
  'stop loss': 'Stop loss is an automatic sale when the coin falls by the amount you chose, so one bad coin cannot wipe you out.',
  realized: 'Realized profit is money you actually locked in by selling. Unrealized profit is what you would get if you sold right now.',
  'copy delay': 'Copy delay is the few seconds between the wallet buying and your copy buying. In fast coins the price can jump a lot in those seconds.',
  'gmgn fee': 'GMGN charges 1% of every buy and every sell. A $25 buy costs 25 cents to GMGN, and so does selling it.',
};

const ALIASES = {
  mcap: 'market cap', 'market cap': 'market cap', marketcap: 'market cap',
  mev: 'anti-mev', 'anti mev': 'anti-mev', antimev: 'anti-mev',
  curve: 'bonding curve', graduation: 'graduated', graduate: 'graduated', migrated: 'graduated',
  rug: 'rug pull', rugpull: 'rug pull', priority: 'priority fee', tip: 'tip fee',
  kols: 'kol', influencer: 'kol', smart: 'smart money', snipe: 'sniping', sniper: 'sniping',
  winrate: 'win rate', copy: 'copy trading', tp: 'take profit', sl: 'stop loss', fees: 'gmgn fee', fee: 'gmgn fee', delay: 'copy delay',
};

export function explainTerm(raw) {
  const t = String(raw ?? '').toLowerCase().trim().replace(/[?.!]/g, '');
  if (GLOSSARY[t]) return GLOSSARY[t];
  if (ALIASES[t]) return GLOSSARY[ALIASES[t]];
  for (const k of Object.keys(GLOSSARY)) if (t.includes(k)) return GLOSSARY[k];
  for (const [a, k] of Object.entries(ALIASES)) if (t.split(/\s+/).includes(a)) return GLOSSARY[k];
  return null;
}

export const TERM_PATTERN = /\b(slippage|market ?cap|mcap|liquidity|anti[- ]?mev|mev|bonding curve|curve|graduat\w*|migrated|rug(?: ?pull)?|priority fee|tip fee|kols?|smart money|snip\w*|win ?rate|copy trading|take profit|stop loss|realized|copy delay)\b/i;
