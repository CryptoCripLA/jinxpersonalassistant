// Pulse: the terminal's live discovery board. Polls GMGN's launch lists (new, about to
// graduate, just graduated) plus the 1-minute trending list, feeds every coin into the
// momentum tape, and ranks an "Explosive now" column by measured momentum. It only runs
// while the terminal is open, so a closed terminal costs no GMGN calls.
import { TokenTape, momentumScore } from '../analysis/momentum.js';
import { safetyChecks } from '../analysis/filters.js';
import { cleanLabel } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const COLS = { new_creation: 'new', near_completion: 'near', completed: 'graduated' };

export class Pulse {
  constructor({ g, nowSec = () => Math.floor(Date.now() / 1000), explosiveBuys = () => [], log = () => {}, limit = 50 }) {
    Object.assign(this, { g, nowSec, explosiveBuys, log, limit });
    this.tape = new TokenTape();
    this.lists = { new: [], near: [], graduated: [], movers: [] };
    this.updatedAt = null;
    this.error = null;
    this.polls = 0;
  }

  // A fresh start (no tab open for a while) measures from scratch: rates need two looks.
  reset() {
    this.tape = new TokenTape();
    this.polls = 0;
  }

  async poll() {
    const now = this.nowSec();
    this.polls += 1;
    try {
      const tr = await this.g.trenches(['new_creation', 'near_completion', 'completed'], {}, this.limit, { ttlMs: 3000 });
      for (const [k, col] of Object.entries(COLS)) {
        const items = tr?.[k] ?? [];
        for (const t of items) this.tape.add(t, now);
        this.lists[col] = items;
      }
      if (this.polls % 3 === 1) {
        const rk = await this.g.trending('1m', { order_by: 'volume', limit: 40 }).catch(() => ({ rank: [] }));
        this.lists.movers = rk.rank ?? [];
      }
      this.tape.prune(now);
      this.updatedAt = now;
      this.error = null;
    } catch (e) {
      this.error = e.message;
      this.log(`pulse poll failed: ${e.message}`);
    }
  }

  view(t, now, { trending = false } = {}) {
    const created = num(t.created_timestamp ?? t.creation_timestamp ?? t.open_timestamp);
    const rates = trending
      ? { windowSec: 60, buysPerMin: num(t.buys), sellsPerMin: num(t.sells), swapsPerMin: num(t.swaps), volumePerMinUsd: num(t.volume), holdersPerMin: null, progressPerMin: null, smartAdded: null, acceleration: null, mcapChange: num(t.price_change_percent1m) != null ? num(t.price_change_percent1m) / 100 : null }
      : this.tape.rates(t.address, now);
    const explosiveIn = this.explosiveBuys(t.address);
    const momentum = momentumScore(t, { now, rates, explosiveWalletsIn: explosiveIn });
    return {
      address: t.address,
      symbol: cleanLabel(t.symbol, 16),
      name: cleanLabel(t.name, 40),
      logo: typeof t.logo === 'string' && /^https:\/\//.test(t.logo) ? t.logo : '',
      launchpad: t.launchpad_platform || t.launchpad || '',
      ageSec: created != null ? now - created : null,
      marketCapUsd: num(t.market_cap ?? t.usd_market_cap),
      liquidityUsd: num(t.liquidity),
      holders: num(t.holder_count),
      progress: num(t.progress),
      completeTs: num(t.complete_timestamp) || null,
      smart: num(t.smart_degen_count) ?? 0,
      kol: num(t.renowned_count) ?? 0,
      volume24hUsd: num(t.volume_24h ?? t.volume),
      priceChange1m: num(t.price_change_percent1m),
      social: { twitter: Boolean(t.twitter || t.twitter_username), website: Boolean(t.website), telegram: Boolean(t.telegram) },
      devSold: t.creator_token_status === 'creator_close',
      rates,
      momentum,
      checks: safetyChecks(t, { now }),
      explosiveIn,
      source: trending ? 'trending 1m' : 'launch list',
    };
  }

  columns() {
    const now = this.updatedAt ?? this.nowSec();
    const hidden = [];
    const keep = (list, opts) => list.map((t) => this.view(t, now, opts)).filter((v) => {
      if (v.momentum.disqualified) {
        hidden.push({ address: v.address, symbol: v.symbol, why: v.momentum.disqualified });
        return false;
      }
      return true;
    });
    const cols = { new: keep(this.lists.new), near: keep(this.lists.near), graduated: keep(this.lists.graduated) };
    const movers = keep(this.lists.movers, { trending: true });
    const seen = new Set();
    const explosive = [...cols.near, ...cols.new, ...cols.graduated, ...movers]
      .filter((v) => v.rates && v.checks.pass && (v.momentum.stage === 'Ignition' || v.momentum.stage === 'Building'))
      .sort((a, b) => b.momentum.score - a.momentum.score)
      .filter((v) => (seen.has(v.address) ? false : seen.add(v.address)))
      .slice(0, 15);
    return { ...cols, explosive, hidden, updatedAt: this.updatedAt, error: this.error, warmingUp: this.polls < 3 };
  }

  // The raw GMGN list entry: carries rug ratio and fake-activity rates the token routes lack.
  raw(address) {
    for (const list of [this.lists.near, this.lists.new, this.lists.graduated, this.lists.movers]) {
      const t = list.find((x) => x.address === address);
      if (t) return t;
    }
    return null;
  }

  find(address) {
    const now = this.updatedAt ?? this.nowSec();
    for (const list of [this.lists.near, this.lists.new, this.lists.graduated]) {
      const t = list.find((x) => x.address === address);
      if (t) return this.view(t, now);
    }
    const m = this.lists.movers.find((x) => x.address === address);
    return m ? this.view(m, now, { trending: true }) : null;
  }
}
