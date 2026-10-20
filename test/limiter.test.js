import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeakyBucket, PLANS } from '../src/gmgn/limiter.js';
import { ROUTE_WEIGHTS } from '../src/gmgn/weights.js';

test('plan buckets match GMGN published rate/capacity', () => {
  assert.deepEqual(PLANS.free, { rate: 5, capacity: 5 });
  assert.deepEqual(PLANS.plus, { rate: 20, capacity: 20 });
  assert.deepEqual(PLANS.pro, { rate: 50, capacity: 50 });
});

test('route weights match GMGN skill docs for the routes this app uses', () => {
  assert.equal(ROUTE_WEIGHTS.walletActivity, 3);
  assert.equal(ROUTE_WEIGHTS.walletStats, 3);
  assert.equal(ROUTE_WEIGHTS.followWallet, 10);
  assert.equal(ROUTE_WEIGHTS.swap, 10);
  assert.equal(ROUTE_WEIGHTS.queryOrder, 5);
  assert.equal(ROUTE_WEIGHTS.tokenTraders, 5);
  assert.equal(ROUTE_WEIGHTS.kline, 2);
  assert.equal(ROUTE_WEIGHTS.kline1s, 3);
});

test('a route heavier than the plan capacity fails fast instead of calling GMGN', () => {
  let t = 0;
  const b = new LeakyBucket(PLANS.free, () => t);
  assert.equal(b.delayFor(10).impossible, true);
  assert.equal(b.delayFor(3).impossible, false);
});

test('bucket drains at plan rate: free plan allows one wallet_activity burst then waits', () => {
  let t = 0;
  const b = new LeakyBucket(PLANS.free, () => t);
  assert.equal(b.take(3), 0);          // level 3 of 5
  const wait = b.take(3);              // needs level <= 2 → drain 1 unit at 5/s = 200 ms
  assert.equal(wait, 200);
  t = 10_000;
  assert.equal(b.take(5), 0, 'fully drained after 10 s');
});

test('server ban pauses every call until the reset time', () => {
  let t = 1_000_000;
  const b = new LeakyBucket(PLANS.pro, () => t);
  b.banUntil(1_000_000 + 300_000);
  assert.equal(b.take(1), 300_000);
});
