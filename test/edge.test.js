import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safetyChecks } from '../src/analysis/filters.js';
import { exitHabits } from '../src/analysis/traderType.js';

const coin = (o) => ({
  renounced_mint: 1, renounced_freeze_account: 1, creator_token_status: 'creator_hold', dev_team_hold_rate: 0.02, top_10_holder_rate: 0.22,
  twitter: 'https://x.com/zap', twitter_dup: 0, liquidity: 25_000, volume_24h: 60_000, created_timestamp: 1000, ...o,
});

test('the filters that matter, each as a plain pass or fail', () => {
  const r = safetyChecks(coin({}), { now: 1000 + 1800 });
  assert.equal(r.pass, true);
  assert.deepEqual(r.checks.map((c) => c.key), ['mint', 'freeze', 'dev', 'holders', 'socials', 'liquidity']);
  assert.ok(r.checks.every((c) => c.ok === true));
  const bad = safetyChecks(coin({ renounced_mint: 0, top_10_holder_rate: 0.62 }), { now: 2800 });
  assert.equal(bad.pass, false, 'mint still active or one wallet group owning most of it is a hard no');
  assert.match(bad.checks.find((c) => c.key === 'mint').text, /can still print/);
  const dump = safetyChecks(coin({ creator_token_status: 'creator_close' }), { now: 1000 + 120 });
  assert.equal(dump.checks.find((c) => c.key === 'dev').ok, false, 'creator sold within minutes of launch');
  const unknown = safetyChecks(coin({ renounced_mint: undefined }), { now: 2800 });
  assert.equal(unknown.checks.find((c) => c.key === 'mint').ok, null, 'unknown stays unknown');
});

test('exit habits: takes profit versus riding losers to zero', () => {
  const o = (wc, st = 'closed') => ({ status: st, walletCaptured: wc });
  const e = exitHabits([o(2.4), o(1.6), o(0.9), o(0.05), o(0.1), o(3), o(null, 'open')]);
  assert.equal(e.trades, 6);
  assert.equal(e.tookProfit, 3, 'sold at 1.5x or better');
  assert.equal(e.rodeToZero, 2, 'sold for under 20% of cost');
  assert.match(e.text, /took profit on 3 of 6/);
  assert.match(e.text, /rode 2 of 6 to almost zero/);
});
