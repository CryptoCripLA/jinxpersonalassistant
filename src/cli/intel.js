// Runs the history study and the explosive-wallet measurement from the terminal.
//   node src/cli/intel.js study [maxTokens]   real 7x+ coins, their signals and early wallets
//   node src/cli/intel.js wallets             peak / capture / follower replay for every wallet
//   node src/cli/intel.js discover [maxDeep]  profile the early wallets the study found
import { Gmgn, realApi } from '../gmgn/client.js';
import { openDb } from '../store/db.js';
import { Service } from '../service.js';
import { DB_PATH, EXPORT_DIR, GMGN_PLAN } from '../config.js';

const [cmd = 'study', arg] = process.argv.slice(2);
const api = await realApi();
if (!api) throw new Error('No GMGN API key found in ~/.config/gmgn/.env');
const db = openDb(DB_PATH);
const g = new Gmgn({ api, db, plan: GMGN_PLAN });
const svc = new Service({ g, db, exportDir: EXPORT_DIR, log: (m) => console.log(m) });
const t0 = Date.now();
const progress = (p) => process.stdout.write(`\r${p.phase} ${p.done}/${p.total}${p.examples != null ? ` examples ${p.examples}` : ''}   `);
let r;
if (cmd === 'study') r = await svc.runStudy({ limit: Number(arg) || 40, onProgress: progress });
else if (cmd === 'wallets') r = await svc.runWalletMeasure({ onProgress: progress });
else if (cmd === 'discover') r = await svc.discoverEarlyWallets({ maxDeep: Number(arg) || 40, onProgress: progress });
else throw new Error(`unknown command ${cmd}`);
console.log(`\n${cmd} done in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(r), 'GMGN', JSON.stringify(g.stats));
