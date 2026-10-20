import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PumpPortalStream, normalizeEvent } from '../src/pumpfun/stream.js';

class FakeWS {
  static last = null;
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeWS.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  send(m) { this.sent.push(JSON.parse(m)); }
  close() { this.closed = true; this.onclose?.(); }
  emit(o) { this.onmessage?.({ data: JSON.stringify(o) }); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('normalizeEvent reads PumpPortal create, trade and migrate messages', () => {
  assert.equal(normalizeEvent({ message: 'Successfully subscribed' }), null);
  const c = normalizeEvent({ signature: 's', mint: 'M', traderPublicKey: 'DEV', txType: 'create', name: 'Zap', symbol: 'ZAP', marketCapSol: 30, solAmount: 1 });
  assert.deepEqual([c.kind, c.mint, c.wallet, c.symbol], ['new', 'M', 'DEV', 'ZAP']);
  const t = normalizeEvent({ signature: 's2', mint: 'M', traderPublicKey: 'W', txType: 'buy', solAmount: 0.5, marketCapSol: 40 });
  assert.deepEqual([t.kind, t.side, t.solAmount], ['trade', 'buy', 0.5]);
  assert.equal(normalizeEvent({ signature: 's3', mint: 'M', txType: 'migrate', pool: 'pump-amm' }).kind, 'migration');
});

test('the stream subscribes to launches and graduations and follows chosen wallets and coins', async () => {
  const s = new PumpPortalStream({ WebSocketImpl: FakeWS, now: () => 1000 });
  const seen = [];
  s.on((e) => seen.push(e));
  s.watchWallets(['W1', 'W2']);
  s.start();
  await tick();
  const ws = FakeWS.last;
  assert.deepEqual(ws.sent.map((m) => m.method), ['subscribeNewToken', 'subscribeMigration', 'subscribeAccountTrade']);
  assert.deepEqual(ws.sent[2].keys, ['W1', 'W2']);
  s.watchTokens(['M']);
  assert.deepEqual(ws.sent.at(-1), { method: 'subscribeTokenTrade', keys: ['M'] });
  s.watchTokens([]);
  assert.deepEqual(ws.sent.at(-1), { method: 'unsubscribeTokenTrade', keys: ['M'] });
  ws.emit({ signature: 'x', mint: 'M', traderPublicKey: 'W1', txType: 'buy', solAmount: 1, marketCapSol: 50 });
  assert.equal(seen.length, 1);
  assert.deepEqual(s.walletBuys('M', 1000, 1800).map((b) => b.wallet), ['W1'], 'explosive-wallet buys are remembered per coin');
  s.stop();
  assert.equal(ws.closed, true);
});

test('a dropped connection reconnects while the stream is wanted, and stays down after stop', async () => {
  const waits = [];
  const s = new PumpPortalStream({ WebSocketImpl: FakeWS, now: () => 0, setTimer: (fn, ms) => { waits.push(ms); fn(); return 0; } });
  s.start();
  await tick();
  const first = FakeWS.last;
  first.onclose();
  await tick();
  assert.notEqual(FakeWS.last, first, 'reconnected');
  assert.ok(waits[0] >= 5000, 'waits before reconnecting');
  s.stop();
  const after = FakeWS.last;
  after.onclose?.();
  await tick();
  assert.equal(FakeWS.last, after, 'no reconnect after stop');
});
