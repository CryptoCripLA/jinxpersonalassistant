// Local SQLite store (Node built-in node:sqlite). Lives in data/ which is git-ignored:
// this repository is public and the database holds your wallet and copy ledger.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_profiles (
  wallet TEXT PRIMARY KEY, profile TEXT NOT NULL, built_at INTEGER NOT NULL, source TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  wallet TEXT PRIMARY KEY, sources TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  prefilter TEXT, status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS copy_watch (
  wallet TEXT PRIMARY KEY, settings TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_ts INTEGER NOT NULL DEFAULT 0, seen_tx TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS copy_intents (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, target_tx TEXT NOT NULL, side TEXT NOT NULL, token TEXT NOT NULL,
  symbol TEXT, state TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  order_id TEXT, tx_hash TEXT, UNIQUE (target_tx, side)
);
CREATE TABLE IF NOT EXISTS copy_positions (
  token TEXT NOT NULL, wallet TEXT NOT NULL, symbol TEXT, tokens_raw TEXT NOT NULL, cost_usd REAL NOT NULL,
  opened_at INTEGER NOT NULL, status TEXT NOT NULL, realized_usd REAL NOT NULL DEFAULT 0, fees_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (token, wallet, opened_at)
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);
  return db;
}

export function kvGet(db, k, fallback = null) {
  const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(k);
  return row ? JSON.parse(row.v) : fallback;
}

export function kvSet(db, k, v) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
