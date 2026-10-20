import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pulse } from '../src/intel/pulse.js';

const coin = (o) => ({
  address: o.a, symbol: o.a, name: o.a, created_timestamp: 1000, market_cap: 20_000, liquidity: 10_000, progress: 0.5,
  swaps_24h: 10, buys_24h: 6, sells_24h: 4, volume_24h: 1000, holder_count: 20, smart_degen_count: 0, renowned_count: 0,
  rug_ratio: 0.05, top_10_holder_rate: 0.2, ...o,
});

function fakeG(frames) {
  let i = 0;
  return {
    calls: 0,
    trenches: async () => {
      const f = frames[Math.min(i, frames.length - 1)];
      i += 1;
      return f;
    },
    trending: async () => ({ rank: [] }),
  };
}

test('pulse builds the three launch columns and an Explosive-now column ranked by live momentum', async () => {
  const frames = [
    { new_creation: [coin({ a: 'NEW1' })], near_completion: [coin({ a: 'HOT', progress: 0.85, smart_degen_count: 3 })], completed: [coin({ a: 'GRAD', progress: 1, complete_timestamp: 1100 })] },
    { new_creation: [coin({ a: 'NEW1', buys_24h: 8, sells_24h: 5, swaps_24h: 13 })], near_completion: [coin({ a: 'HOT', progress: 0.9, smart_degen_count: 4, buys_24h: 66, sells_24h: 8, swaps_24h: 74, volume_24h: 9000, holder_count: 60 })], completed: [coin({ a: 'GRAD', progress: 1, complete_timestamp: 1100 })] },
  ];
  let now = 1200;
  const p = new Pulse({ g: fakeG(frames), nowSec: () => now, explosiveBuys: (mint) => (mint === 'HOT' ? [{ wallet: 'EXP', ts: now - 30 }] : []) });
  await p.poll();
  now = 1260;
  await p.poll();
  const cols = p.columns();
  assert.deepEqual(cols.new.map((c) => c.address), ['NEW1']);
  assert.deepEqual(cols.near.map((c) => c.address), ['HOT']);
  assert.deepEqual(cols.graduated.map((c) => c.address), ['GRAD']);
  assert.equal(cols.explosive[0].address, 'HOT', 'fast buying + smart money + your explosive wallet + near graduation');
  const hot = cols.explosive[0];
  assert.equal(hot.rates.buysPerMin, 60);
  assert.equal(hot.explosiveIn.length, 1);
  assert.ok(hot.momentum.score > cols.new[0].momentum.score);
  assert.equal(hot.ageSec, 260);
  assert.ok(cols.updatedAt === 1260);
});

test('pulse drops rugs from every column and keeps the reason', async () => {
  const p = new Pulse({ g: fakeG([{ new_creation: [coin({ a: 'RUG', rug_ratio: 0.9 })], near_completion: [], completed: [] }]), nowSec: () => 1200 });
  await p.poll();
  const cols = p.columns();
  assert.equal(cols.new.length, 0);
  assert.equal(cols.hidden[0].address, 'RUG');
  assert.match(cols.hidden[0].why, /rug/i);
});

test('a failed GMGN poll keeps the last good columns and reports the problem', async () => {
  const g = fakeG([{ new_creation: [coin({ a: 'A' })], near_completion: [], completed: [] }]);
  const p = new Pulse({ g, nowSec: () => 1200 });
  await p.poll();
  g.trenches = async () => { throw new Error('GMGN paused requests'); };
  await p.poll();
  const cols = p.columns();
  assert.equal(cols.new.length, 1);
  assert.match(cols.error, /paused/);
});
