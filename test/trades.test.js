import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivity, buildPositions, classifyEntry, tokenMetaFromInfo } from '../src/analysis/trades.js';

// Rows use the live GMGN wallet_activity field names (verified 2026-10-20).
const row = (o) => ({
  tx_hash: o.tx, event_type: o.side, timestamp: o.ts, cost_usd: String(o.usd),
  token_amount: String(o.amt), price_usd: String(o.usd / o.amt), gas_usd: '0.002',
  priority_fee: '0.00001', tip_fee: '0', dex_usd: String(o.dex ?? 0), launchpad_platform: 'Pump.fun',
  token: { address: o.token ?? 'MINT1', symbol: o.sym ?? 'AAA', total_supply: '1000000000' },
});

test('normalizes a live activity row and drops transfers', () => {
  const t = normalizeActivity(row({ tx: 'a', side: 'buy', ts: 100, usd: 50, amt: 1000, dex: 0.6 }));
  assert.equal(t.side, 'buy');
  assert.equal(t.usd, 50);
  assert.equal(t.priceUsd, 0.05);
  assert.equal(t.mcapUsd, 50_000_000);
  assert.equal(t.dexFeeUsd, 0.6);
  assert.equal(normalizeActivity({ ...row({ tx: 'b', side: 'buy', ts: 1, usd: 1, amt: 1 }), event_type: 'transferIn' }), null);
});

test('builds round trips oldest-first even though GMGN returns newest-first', () => {
  const rows = [
    row({ tx: 's2', side: 'sell', ts: 400, usd: 90, amt: 500 }),
    row({ tx: 's1', side: 'sell', ts: 200, usd: 60, amt: 500 }),
    row({ tx: 'b1', side: 'buy', ts: 100, usd: 50, amt: 1000 }),
  ];
  const { positions } = buildPositions(rows.map(normalizeActivity).filter(Boolean));
  assert.equal(positions.length, 1);
  const p = positions[0];
  assert.equal(p.status, 'closed');
  assert.equal(p.openTs, 100);
  assert.equal(p.closeTs, 400);
  assert.equal(p.holdSec, 300);
  assert.equal(p.copyWindowSec, 100, 'first sell came 100 s after first buy');
  assert.equal(p.realizedUsd, 100);
  assert.equal(p.sells.length, 2);
  assert.equal(p.sells[0].fractionOfHolding, 0.5, 'first sell dumped half the bag');
  assert.equal(p.sells[1].fractionOfHolding, 1);
  assert.equal(p.sellPattern, 'scaled');
});

test('a re-buy after a full exit is a new position, not a lifetime ban', () => {
  const rows = [
    row({ tx: 'b1', side: 'buy', ts: 100, usd: 10, amt: 100 }),
    row({ tx: 's1', side: 'sell', ts: 150, usd: 12, amt: 100 }),
    row({ tx: 'b2', side: 'buy', ts: 900, usd: 10, amt: 100 }),
  ];
  const { positions } = buildPositions(rows.map(normalizeActivity));
  assert.equal(positions.length, 2);
  assert.equal(positions[1].status, 'open');
  assert.equal(positions[1].realizedUsd, 0);
});

test('sells of coins bought before the data window are counted, not invented', () => {
  const { positions, orphanSells } = buildPositions([row({ tx: 's', side: 'sell', ts: 5, usd: 9, amt: 9 })].map(normalizeActivity));
  assert.equal(positions.length, 0);
  assert.equal(orphanSells, 1);
});

test('dust left after selling still counts as a closed trade', () => {
  const rows = [
    row({ tx: 'b1', side: 'buy', ts: 100, usd: 10, amt: 1000 }),
    row({ tx: 's1', side: 'sell', ts: 160, usd: 20, amt: 995 }),
  ];
  const { positions } = buildPositions(rows.map(normalizeActivity));
  assert.equal(positions[0].status, 'closed');
  assert.equal(positions[0].sellPattern, 'one-shot');
});

test('entry stage: snipe, early curve, graduated, unknown', () => {
  const pump = tokenMetaFromInfo({ creation_timestamp: 1000, open_timestamp: 5000, launchpad: 'pump', migrated_pool: 'POOL', launchpad_status: 2 });
  assert.equal(classifyEntry({ openTs: 1030 }, pump), 'snipe');
  assert.equal(classifyEntry({ openTs: 1600 }, pump), 'early');
  assert.equal(classifyEntry({ openTs: 6000 }, pump), 'graduated');
  const curveOnly = tokenMetaFromInfo({ creation_timestamp: 1000, open_timestamp: 0, launchpad: 'pump', migrated_pool: '', launchpad_status: 1 });
  assert.equal(classifyEntry({ openTs: 99999 }, curveOnly), 'early', 'never migrated means still on the curve');
  const dexListing = tokenMetaFromInfo({ creation_timestamp: 1000, open_timestamp: 1000, launchpad: '', migrated_pool: '' });
  assert.equal(classifyEntry({ openTs: 1010 }, dexListing), 'graduated', 'a plain DEX listing is open-market from the start');
  assert.equal(classifyEntry({ openTs: 1 }, null), 'unknown');
});
