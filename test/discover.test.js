import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tradersToCandidates, feedToCandidates, prefilter } from '../src/discovery/discover.js';

test('top earners on a coin become candidates, but insiders and pools do not', () => {
  const list = [
    { address: 'A', addr_type: 0, realized_profit: 900, tags: ['smart_degen'], maker_token_tags: [] },
    { address: 'DEV', addr_type: 0, realized_profit: 3000, tags: [], maker_token_tags: ['creator', 'dev_team'] },
    { address: 'BUN', addr_type: 0, realized_profit: 2000, tags: [], maker_token_tags: ['bundler'] },
    { address: 'POOL', addr_type: 2, realized_profit: 5000, tags: [], maker_token_tags: [] },
    { address: 'LOSER', addr_type: 0, realized_profit: -50, tags: [], maker_token_tags: [] },
    { address: 'BOT', addr_type: 0, realized_profit: 400, tags: ['dex_bot'], maker_token_tags: [] },
  ];
  const c = tradersToCandidates(list, { symbol: 'XYZ', why: 'graduated' });
  assert.deepEqual(c.map((x) => x.wallet), ['A']);
  assert.match(c[0].source, /XYZ/);
});

test('smart money and KOL feeds give candidates with their GMGN tags', () => {
  const feed = { list: [
    { maker: 'S1', side: 'buy', maker_info: { tags: ['smart_degen'] } },
    { maker: 'S1', side: 'sell', maker_info: { tags: ['smart_degen'] } },
    { maker: 'K1', side: 'buy', maker_info: { tags: ['kol', 'wash_trader'], twitter_username: 'k' } },
  ] };
  const c = feedToCandidates(feed, 'smart money feed');
  assert.deepEqual(c.map((x) => x.wallet).sort(), ['K1', 'S1']);
});

test('prefilter keeps profitable, selective wallets and says why it dropped the rest', () => {
  const rows = [
    { wallet_address: 'GOOD', realized_profit: '2400', buy: 60, sell: 70 },
    { wallet_address: 'BOT', realized_profit: '9000', buy: 9600, sell: 9600 },
    { wallet_address: 'LOSER', realized_profit: '-300', buy: 40, sell: 40 },
    { wallet_address: 'IDLE', realized_profit: '0', buy: 0, sell: 0 },
    { wallet_address: 'RARE', realized_profit: '500', buy: 3, sell: 3 },
    { wallet_address: 'BUSYGOOD', realized_profit: '3000', buy: 500, sell: 500 },
  ];
  const { keep, dropped } = prefilter(rows, { days: 30 });
  assert.deepEqual(keep.map((k) => k.wallet), ['GOOD', 'BUSYGOOD'], 'profit per buy ranks the selective wallet first');
  assert.match(dropped.RARE, /too few/);
  assert.match(dropped.BOT, /buys a day/);
  assert.match(dropped.LOSER, /lost money/);
  assert.match(dropped.IDLE, /no trades/);
});
