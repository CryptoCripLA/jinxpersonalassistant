// Local web app. Listens on 127.0.0.1 only. Every POST must carry the per-launch token that
// is embedded in the page this server serves, so another website open in your browser
// cannot press "Approve" or switch the copy desk on.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Gmgn, realApi } from './gmgn/client.js';
import { openDb } from './store/db.js';
import { Service } from './service.js';
import { ClaudeAssistant, claudeFromEnv } from './assistant/llm.js';
import { APP_DIR, DATA_DIR, DB_PATH, EXPORT_DIR, HOST, PORT, GMGN_PLAN } from './config.js';

const TOKEN = randomBytes(24).toString('hex');
const PUBLIC = join(APP_DIR, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const api = await realApi();
if (!api) {
  console.error('No GMGN API key found in ~/.config/gmgn/.env. Run: gmgn-cli config');
  process.exit(1);
}
const db = openDb(DB_PATH);
const g = new Gmgn({ api, db, plan: GMGN_PLAN });
const svc = new Service({ g, db, exportDir: EXPORT_DIR, log: (m) => console.log(m) });
const claudeClient = claudeFromEnv(DATA_DIR);
svc.claude = claudeClient ? new ClaudeAssistant({ client: claudeClient, svc }) : null;

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 64_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('bad JSON'));
      }
    });
  });

const wallet = (w) => {
  if (!WALLET_RE.test(String(w ?? ''))) throw Object.assign(new Error('That does not look like a Solana wallet address.'), { status: 400 });
  return w;
};

const ROUTES = {
  'GET /api/status': () => svc.status(),
  'GET /api/suggestions': (q) => svc.suggestions({ refresh: q.get('refresh') === '1' }),
  'GET /api/boards': () => svc.boards(),
  'GET /api/coins': (q) => svc.opportunities(q.get('category') || 'graduated'),
  'GET /api/copy': () => svc.copyState(),
  'POST /api/ask': (q, b) => svc.ask(b.question, { wallet: b.wallet && WALLET_RE.test(b.wallet) ? b.wallet : undefined }),
  'POST /api/simulate': (q, b) => svc.simulate(wallet(b.wallet), { sizeUsd: Number(b.sizeUsd) || undefined, delaySec: b.delaySec != null ? Number(b.delaySec) : undefined, days: Number(b.days) || 14 }),
  'POST /api/user': (q, b) => svc.setUser(Object.fromEntries(Object.entries({ sizeUsd: Number(b.sizeUsd) || undefined, delaySec: b.delaySec != null ? Number(b.delaySec) : undefined, capitalUsd: b.capitalUsd === null ? null : Number(b.capitalUsd) || undefined }).filter(([, v]) => v !== undefined))),
  'POST /api/discover': (q, b) => svc.startDiscovery(Math.min(200, Number(b.maxDeep) || 80)),
  'POST /api/copy/watch': (q, b) => svc.copyWallet(wallet(b.wallet)),
  'POST /api/copy/unwatch': (q, b) => (svc.desk.unwatch(wallet(b.wallet)), svc.copyState()),
  'POST /api/copy/mode': (q, b) => {
    if (!['off', 'confirm', 'auto'].includes(b.mode)) throw Object.assign(new Error('mode must be off, confirm or auto'), { status: 400 });
    if (b.mode === 'auto' && b.confirmText !== 'AUTO') throw Object.assign(new Error('Type AUTO to switch on unattended copying.'), { status: 400 });
    svc.desk.setConfig({ mode: b.mode });
    return svc.copyState();
  },
  'POST /api/copy/limits': (q, b) => {
    const lim = {};
    for (const k of ['perTradeUsd', 'maxDailyUsd', 'maxOpen']) if (Number(b[k]) > 0) lim[k] = Number(b[k]);
    svc.desk.setConfig({ limits: lim });
    return svc.copyState();
  },
  'POST /api/copy/approve': async (q, b) => ({ state: await svc.desk.approve(String(b.id)), copy: svc.copyState() }),
  'POST /api/copy/reject': (q, b) => (svc.desk.reject(String(b.id)), svc.copyState()),
  'POST /api/export/jinx': () => svc.exportJinx(),
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && req.headers['x-jpa-token'] !== TOKEN) return send(res, 403, { error: 'Missing app token. Reload the page.' });
      const m = url.pathname.match(/^\/api\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
      if (req.method === 'GET' && m) return send(res, 200, await svc.walletDetail(m[1]));
      const fn = ROUTES[`${req.method} ${url.pathname}`];
      if (!fn) return send(res, 404, { error: 'not found' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      return send(res, 200, await fn(url.searchParams, body));
    }
    const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC) || !existsSync(file)) return send(res, 404, 'not found', 'text/plain');
    let content = readFileSync(file, 'utf8');
    if (rel === 'index.html') content = content.replace('__JPA_TOKEN__', TOKEN);
    return send(res, 200, content, TYPES[extname(file)] ?? 'application/octet-stream');
  } catch (e) {
    console.error(`${req.method} ${url.pathname}: ${e.message}`);
    return send(res, e.status ?? 500, { error: e.message });
  }
});

// Copy desk loop: reads watched wallets and checks submitted orders. Idle when nothing is watched.
let loopBusy = false;
setInterval(async () => {
  if (loopBusy || !svc.desk.watches().length && !svc.desk.intents(50).some((i) => i.state === 'submitted' || i.state === 'awaiting_approval')) return;
  loopBusy = true;
  try {
    await svc.desk.tick();
    await svc.desk.reconcile();
  } catch (e) {
    console.error(`copy desk loop: ${e.message}`);
  } finally {
    loopBusy = false;
  }
}, svc.desk.config().pollSec * 1000);

server.listen(PORT, HOST, () => {
  console.log(`JINX personal assistant ready on http://${HOST}:${PORT}  (Claude assistant: ${svc.claude ? 'on' : 'off'}, copy desk: ${svc.desk.config().mode})`);
});
