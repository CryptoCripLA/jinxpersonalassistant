// npm run discover -- [maxDeep]   Runs wallet discovery against live GMGN and stores profiles.
import { Gmgn, realApi } from '../gmgn/client.js';
import { openDb } from '../store/db.js';
import { runDiscovery } from '../discovery/discover.js';
import { DB_PATH, GMGN_PLAN } from '../config.js';

const api = await realApi();
if (!api) {
  console.error('No GMGN API key found. Run: gmgn-cli config');
  process.exit(1);
}
const db = openDb(DB_PATH);
const g = new Gmgn({ api, db, plan: GMGN_PLAN });
const maxDeep = Number(process.argv[2] ?? 40);
const result = await runDiscovery(g, db, {
  maxDeep,
  log: (m) => console.log(`  note: ${m}`),
  onProgress: (p) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${p.phase} ${p.done}/${p.total}`),
});
console.log(JSON.stringify({ ...result, gmgnCalls: g.stats }, null, 2));
