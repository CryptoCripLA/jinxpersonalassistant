// GMGN uses a plan-based leaky bucket (rate tokens/s drained, capacity units max).
// A request of weight w may go when level + w <= capacity. Requests during a
// server-side ban extend the ban, so a ban pauses every call until it lifts.

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
    const elapsed = (t - this.last) / 1000;
    this.level = Math.max(0, this.level - elapsed * this.plan.rate);
    this.last = t;
  }

  delayFor(weight) {
    if (weight > this.plan.capacity) return { impossible: true, ms: Infinity };
    this.drain();
    const t = this.now();
    if (this.bannedUntil > t) return { impossible: false, ms: this.bannedUntil - t };
    const excess = this.level + weight - this.plan.capacity;
    return { impossible: false, ms: excess > 0 ? Math.ceil((excess / this.plan.rate) * 1000) : 0 };
  }

  // Reserve capacity now; returns how long the caller must wait before sending.
  take(weight) {
    const d = this.delayFor(weight);
    if (d.impossible) return d.ms;
    this.level += weight;
    return d.ms;
  }

  banUntil(ms) {
    this.bannedUntil = Math.max(this.bannedUntil, ms);
  }
}
