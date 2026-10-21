// GMGN uses a plan-based leaky bucket (rate tokens/s drained, capacity units max).
// A request of weight w may go when level + w <= capacity.
// A server-side ban pauses every call until it lifts. When it lifts, the bucket restarts FULL,
// so the callers that queued during the ban leave one at a time at the plan rate. (Releasing
// them all at the reset instant re-tripped GMGN's limiter and extended the ban, seen live
// 2026-10-20.)

export const PLANS = {
  free: { rate: 5, capacity: 5 },
  plus: { rate: 20, capacity: 20 },
  pro: { rate: 50, capacity: 50 },
};

export class LeakyBucket {
  constructor(plan, now = Date.now) {
    this.plan = plan;
    this.now = now;
    this.level = 0;
    this.last = now();
    this.bannedUntil = 0;
  }

  drain() {
    const t = this.now();
    if (t <= this.last) return; // never drain ahead of a ban's end
    const elapsed = (t - this.last) / 1000;
    this.level = Math.max(0, this.level - elapsed * this.plan.rate);
    this.last = t;
  }

  // ceiling: the share of capacity this caller may fill. Background research uses less than 1,
  // so the owner's clicks and trades (a quote or swap weighs 10) always find room.
  delayFor(weight, ceiling = 1) {
    if (weight > this.plan.capacity) return { impossible: true, ms: Infinity };
    this.drain();
    const t = this.now();
    const banned = Math.max(0, this.bannedUntil - t);
    const excess = this.level + weight - this.plan.capacity * ceiling;
    return { impossible: false, ms: banned + (excess > 0 ? Math.ceil((excess / this.plan.rate) * 1000) : 0) };
  }

  // Reserve capacity now; returns how long the caller must wait before sending.
  take(weight, ceiling = 1) {
    const d = this.delayFor(weight, ceiling);
    if (d.impossible) return d.ms;
    this.level += weight;
    return d.ms;
  }

  banUntil(ms) {
    if (ms <= this.bannedUntil) return;
    this.bannedUntil = ms;
    this.level = Math.max(this.level, this.plan.capacity);
    this.last = Math.max(this.last, ms);
  }
}
