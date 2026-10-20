// Hand-off file for JINX. JINX's smart-money watcher reads a JSON document with a
// `wallets` array whose entries carry a `wallet` string
// (JINX src/sources/smart_money.rs::read_auto_wallets, configured by
// JINX_SMART_MONEY_WATCHLIST_FILE or JINX_RUNTIME_DIR/smart_wallets.json) and subscribes
// to at most 30 wallets (MAX_SMART_WALLET_SUBSCRIPTIONS).
// This app only WRITES the file into its own data/exports folder. It does not touch
// JINX's runtime folder, modes (OFF/AUTO/COPY) or executor; pointing JINX at it is a
// separate owner decision.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const JINX_MAX_WALLETS = 30;

export function buildJinxWalletFile({ picks = [], boards = {}, now = Date.now() }) {
  const out = [];
  const seen = new Set();
  const add = (wallet, category, perWeekUsd, why) => {
    if (!wallet || seen.has(wallet) || out.length >= JINX_MAX_WALLETS) return;
    seen.add(wallet);
    out.push({ wallet, category, est_keep_per_week_usd: perWeekUsd ?? null, why });
  };
  for (const p of picks) add(p.wallet, p.style, p.perWeekUsd, 'suggestion: simulated copy profit after fees');
  const ranked = Object.entries(boards)
    .flatMap(([cat, rows]) => rows.filter((r) => r.fits && r.keepPerWeekUsd > 0).map((r) => ({ ...r, cat })))
    .sort((a, b) => b.keepPerWeekUsd - a.keepPerWeekUsd);
  for (const r of ranked) add(r.wallet, r.cat, r.keepPerWeekUsd, 'leaderboard: matches your style, positive after fees');
  return {
    source: 'jinxpersonalassistant',
    generated_at: new Date(now).toISOString(),
    note: 'Research export only. Not wired into JINX; JINX reads it only if the owner points JINX_SMART_MONEY_WATCHLIST_FILE at this file.',
    wallets: out,
  };
}

export function writeJinxWalletFile(dir, doc) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'smart_wallets.json');
  writeFileSync(path, JSON.stringify(doc, null, 2));
  return path;
}
