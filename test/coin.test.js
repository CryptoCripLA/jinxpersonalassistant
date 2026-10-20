import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from '../src/analysis/scenario.js';
import { coinDetail, ratesFromInfo } from '../src/intel/coin.js';
import { feeModel } from '../src/money/fees.js';

const rate = { usdPerSol: 100, source: 'GMGN gas-price', at: 0 };
const fees = feeModel({ rate, networkSolPerTx: 0.002 }); // 1% GMGN + 1% curve + $0.20 a transaction

test('scenario shows dollars in and out at each multiple after every fee', () => {
  const s = scenario({ sizeUsd: 25, marketCapUsd: 40_000, fees, venue: 'curve' });
  const at = (m) => s.rows.find((r) => r.multiple === m);
  assert.equal(at(7).targetMarketCapUsd, 280_000);
  // buy: 25 - 0.25 GMGN - 0.25 curve - 0.20 network = 24.30 of coins; x7 = 170.10; sell fees 1% + 1% + 0.20
  assert.ok(Math.abs(at(7).sellValueUsd - 170.1) < 1e-6);
  assert.ok(Math.abs(at(7).netUsd - (170.1 * 0.98 - 0.2 - 25)) < 1e-6);
  assert.equal(at(0).netUsd, -25, 'a rug loses the whole entry (nothing to sell)');
  assert.ok(s.breakevenMultiple > 1.05 && s.breakevenMultiple < 1.06, 'about 6% rise just to pay the fees in and out');
  assert.match(s.rows.find((r) => r.multiple === 10).text, /\$25 becomes about \$237/);
});

test('ratesFromInfo turns GMGN 1m/5m windows into live rates when the tape has none', () => {
  const r = ratesFromInfo({ buys_1m: 30, sells_1m: 10, buys_5m: 75, volume_1m: 4000, swaps_1m: 40 });
  assert.equal(r.buysPerMin, 30);
  assert.equal(r.acceleration, 2, '30 in the last minute vs 15 a minute over five');
  assert.equal(r.volumePerMinUsd, 4000);
});

const info = {
  address: 'MINT', symbol: 'ZAP', name: 'Zap', logo: 'https://x/l.png', creation_timestamp: 1000, total_supply: '1000000000',
  launchpad: 'pump', launchpad_platform: 'Pump.fun', launchpad_progress: 0.8, migrated_timestamp: 0, liquidity: '12000', holder_count: 150, ath_price: '0.00009',
  price: { price: '0.00004', price_1m: '0.00003', price_5m: '0.00002', price_1h: '0.00001', buys_1m: 20, sells_1m: 5, buys_5m: 50, sells_5m: 20, volume_1m: 3000, volume_5m: 9000, volume_1h: 30000, swaps_1m: 25 },
  stat: { top_10_holder_rate: 0.25, bot_degen_rate: 0.1, dev_team_hold_rate: 0 },
  wallet_tags_stat: { smart_wallets: 2, renowned_wallets: 1 },
  dev: { creator_address: 'DEV', creator_token_status: 'creator_close' },
  link: { twitter_username: 'zap' },
};
const pfTrades = [
  { wallet: 'A', side: 'buy', ts: 1010, priceUsd: 0.000005, usd: 10, tokens: 2_000_000 },
  { wallet: 'EXP', side: 'buy', ts: 1020, priceUsd: 0.000006, usd: 30, tokens: 5_000_000 },
  { wallet: 'A', side: 'sell', ts: 1500, priceUsd: 0.00004, usd: 40, tokens: 1_000_000 },
];

test('coinDetail assembles live numbers, exact early buyers from pump.fun and the $25 scenario', async () => {
  const g = { tokenInfoLive: async () => info, tokenSecurity: async () => ({ rug_ratio: 0.05, is_honeypot: false }), tokenHolders: async () => ({ list: [{ address: 'H1', amount_percentage: 0.1, addr_type: 0 }] }), tokenTraders: async () => ({ list: [] }) };
  const pf = { trades: async () => ({ trades: pfTrades, complete: true, pages: 1, note: '' }) };
  const d = await coinDetail({ g, pf, token: 'MINT', explosive: new Map([['EXP', { wallet: 'EXP', name: '@exp' }]]), fees, sizeUsd: 25, nowSec: 1600 });
  assert.equal(d.symbol, 'ZAP');
  assert.equal(d.marketCapUsd, 40_000);
  assert.ok(Math.abs(d.multipleFromAth - 0.4444) < 0.001, '56% under its all-time high');
  assert.equal(d.early.source, 'pump.fun trades');
  assert.deepEqual(d.early.buyers.map((b) => b.wallet), ['A', 'EXP']);
  assert.equal(d.early.buyers[1].explosive, true);
  assert.equal(d.explosiveIn.length, 1);
  assert.match(d.early.summary.text, /first 2 buyers/);
  assert.equal(d.momentum.disqualified, null);
  assert.equal(d.rates.buysPerMin, 20);
  assert.ok(d.scenario.rows.length > 5);
  assert.equal(d.holders[0].wallet, 'H1');
  assert.equal(d.links.twitter, 'https://x.com/zap');
});

test('coinDetail falls back to GMGN top traders when pump.fun has no full history', async () => {
  const g = {
    tokenInfoLive: async () => ({ ...info, launchpad: 'raydium', address: 'RAY' }), tokenSecurity: async () => null, tokenHolders: async () => ({ list: [] }),
    tokenTraders: async () => ({ list: [{ address: 'Q', addr_type: 0, start_holding_at: 1100, avg_cost: 0.00001, amount_cur: 5, sell_amount_percentage: 0, realized_profit: 0, unrealized_profit: 30, tags: [] }] }),
  };
  const pf = { trades: async () => { throw new Error('should not be called for non-pump coins'); } };
  const d = await coinDetail({ g, pf, token: 'RAY', explosive: new Map(), fees, sizeUsd: 25, nowSec: 1600 });
  assert.equal(d.early.source, 'GMGN top traders');
  assert.equal(d.early.buyers[0].wallet, 'Q');
});

test('safety reads GMGN security as it really arrives and takes rug risk from the live list', async () => {
  const g = { tokenInfoLive: async () => info, tokenSecurity: async () => ({ honeypot: 1, is_honeypot: null, renounced_mint: true, renounced_freeze_account: false }), tokenHolders: async () => ({ list: [] }), tokenTraders: async () => ({ list: [] }) };
  const pf = { trades: async () => ({ trades: pfTrades, complete: true }) };
  const d = await coinDetail({ g, pf, token: 'MINT', fees, sizeUsd: 25, nowSec: 1600, listItem: { rug_ratio: 0.42, is_wash_trading: false, bundler_trader_amount_rate: 0.05 } });
  assert.equal(d.safety.honeypot, true);
  assert.equal(d.safety.mintRenounced, true);
  assert.equal(d.safety.freezeRenounced, false);
  assert.equal(d.safety.rugRatio, 0.42);
  assert.match(d.momentum.disqualified, /rug|honeypot/i, 'a honeypot or rug never scores as an opportunity');
});
