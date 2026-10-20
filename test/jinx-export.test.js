import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJinxWalletFile, JINX_MAX_WALLETS } from '../src/jinx/export.js';

test("export matches JINX's smart_wallets.json reader: a wallets array of {wallet}", () => {
  const picks = [{ wallet: 'AAA111', style: 'graduated', perWeekUsd: 12, reasons: ['r'] }];
  const boards = { graduated: [{ wallet: 'BBB222', keepPerWeekUsd: 5, fits: true }, { wallet: 'AAA111', keepPerWeekUsd: 12, fits: true }], early: [], snipe: [] };
  const doc = buildJinxWalletFile({ picks, boards, now: 0 });
  assert.ok(Array.isArray(doc.wallets));
  assert.deepEqual(doc.wallets.map((w) => w.wallet), ['AAA111', 'BBB222'], 'suggestions first, no duplicates');
  for (const w of doc.wallets) assert.equal(typeof w.wallet, 'string');
  assert.equal(doc.source, 'jinxpersonalassistant');
  assert.match(doc.note, /not wired/i);
});

test('export never exceeds the 30 wallets JINX subscribes to', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ wallet: `W${i}`, keepPerWeekUsd: 50 - i, fits: true }));
  const doc = buildJinxWalletFile({ picks: [], boards: { graduated: rows, early: [], snipe: [] }, now: 0 });
  assert.equal(doc.wallets.length, JINX_MAX_WALLETS);
});
