// Runtime settings. Everything private (database, ledger, exports) lives in data/,
// which is git-ignored because this repository is public.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.JPA_DATA_DIR || join(APP_DIR, 'data');
export const DB_PATH = join(DATA_DIR, 'app.db');
export const EXPORT_DIR = join(DATA_DIR, 'exports');
export const HOST = process.env.JPA_HOST || '127.0.0.1';
export const PORT = Number(process.env.JPA_PORT || 8899);
export const GMGN_PLAN = process.env.JPA_GMGN_PLAN || 'pro';
