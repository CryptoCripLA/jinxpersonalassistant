// Local web app. Listens on 127.0.0.1 only. Every POST must carry the per-launch token that
// is embedded in the page this server serves, so another website open in your browser
// cannot press Buy, confirm a quote or switch the copy desk on.
// Live feeds (GMGN Pulse polling and the PumpPortal stream) run only while a terminal tab
// is open (an /api/events connection exists), and stop a minute after the last tab closes.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Gmgn, realApi } from './gmgn/client.js';
import { openDb } from './store/db.js';
import { Service } from './service.js';
import { ClaudeAssistant, claudeFromEnv } from './assistant/llm.js';
import { GrokAssistant, grokFromEnv } from './assistant/grok.js';
import { APP_DIR, DATA_DIR, DB_PATH, EXPORT_DIR, HOST, PORT, GMGN_PLAN } from './config.js';

const TOKEN = randomBytes(24).toString('hex');
const PUBLIC = join(APP_DIR, 'public');
const VENDOR = { '/vendor/lightweight-charts.js': join(APP_DIR, 'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const ADDR = '[1-9A-HJ-NP-Za-km-z]{32,44}';
const ADDR_RE = new RegExp(`^${ADDR}$`);
const PULSE_MS = 5000;

const api = await realApi();
if (!api) {
  console.error('No GMGN API key found in ~/.config/gmgn/.env. Run: gmgn-cli config');
  process.exit(1);
}
const db = openDb(DB_PATH);
const g = new Gmgn({ api, db, plan: GMGN_PLAN });
const svc = new Service({ g, db, exportDir: EXPORT_DIR, log: (m) => console.log(m) });
const grokKey = grokFromEnv(DATA_DIR);
svc.grok = grokKey ? new GrokAssistant({ apiKey: grokKey.apiKey, svc, log: (m) => console.log(m) }) : null;
const claudeClient = svc.grok ? null : claudeFromEnv(DATA_DIR);
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

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const address = (a, what = 'address') => {
  if (!ADDR_RE.test(String(a ?? ''))) throw bad(`That does not look like a Solana ${what}.`);
  return a;
};
const str = (v, n = 60) => (v == null ? undefined : String(v).slice(0, n));

// What the page says is on screen. Everything is clipped and addresses are checked.
function screenContext(b = {}) {
  const c = b.context ?? {};
  return {
    view: str(c.view, 20),
    coin: c.coin && ADDR_RE.test(c.coin.address ?? '') ? { address: c.coin.address, symbol: str(c.coin.symbol, 16) } : undefined,
    wallet: ADDR_RE.test(c.wallet ?? b.wallet ?? '') ? (c.wallet ?? b.wallet) : undefined,
    element: c.element?.key ? { key: str(c.element.key, 40), label: str(c.element.label, 60), value: str(c.element.value, 60) } : undefined,
    visible: Array.isArray(c.visible) ? c.visible.filter((a) => ADDR_RE.test(a)).slice(0, 30) : undefined,
  };
}

// ---- live events (server-sent events)
const clients = new Set();
let lastClientAt = 0;
let pulseTimer = null;
const broadcast = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
};
let pulseBusy = false;
async function pulseTick() {
  if (!clients.size && Date.now() - lastClientAt > 60_000) return stopLive();
  if (pulseBusy) return;
  pulseBusy = true;
  try {
    await svc.pulse.poll();
    broadcast('pulse', svc.pulseColumns());
  } finally {
    pulseBusy = false;
  }
}
function refreshWatchedWallets() {
  svc.stream.watchWallets(svc.explosiveBoard().filter((r) => r.isExplosive).slice(0, 50).map((r) => r.wallet));
}
function startLive() {
  if (pulseTimer) return;
  refreshWatchedWallets();
  svc.stream.start();
  pulseTick();
  pulseTimer = setInterval(pulseTick, PULSE_MS);
}
function stopLive() {
  clearInterval(pulseTimer);
  pulseTimer = null;
  svc.stream.stop();
}
svc.stream.on((e) => {
  if (!clients.size) return;
  if (e.kind === 'trade' && !svc.stream.tokens.has(e.mint) && !svc.stream.wallets.has(e.wallet)) return;
  broadcast('pp', { ...e, followed: e.wallet ? svc.stream.wallets.has(e.wallet) : false });
});
setInterval(() => clients.size && refreshWatchedWallets(), 5 * 60_000);

const ROUTES = {
  'GET /api/status': async () => ({ ...(await svc.status()), live: { clients: clients.size, pulse: Boolean(pulseTimer), pulseUpdatedAt: svc.pulse.updatedAt, pulseError: svc.pulse.error, stream: { open: svc.stream.open, ...svc.stream.stats } }, ai: svc.grok ? 'grok' : svc.claude ? 'claude' : 'off', aiSpentUsd: svc.grok?.spentUsd ?? 0, pumpfun: svc.pf.stats, jobs: svc.jobs }),
  'GET /api/pulse': () => svc.pulseColumns(),
  'GET /api/suggestions': (q) => svc.suggestions({ refresh: q.get('refresh') === '1' }),
  'GET /api/boards': () => svc.boards(),
  'GET /api/coins': (q) => svc.opportunities(q.get('category') || 'graduated'),
  'GET /api/copy': () => svc.copyState(),
  'GET /api/wallets/explosive': () => svc.explosiveBoard().map(({ outcomes, ...r }) => ({ ...r, recent: (outcomes ?? []).slice(-3) })),
  'GET /api/history': () => ({ summary: svc.historySummary(), examples: svc.examples() }),
  'GET /api/portfolio': () => svc.portfolio(),
  'GET /api/jobs': () => svc.jobs,
  'POST /api/jobs': (q, b) => svc.startJob(String(b.kind)),
  'POST /api/ask': (q, b) => svc.ask(b.question, screenContext(b)),
  'POST /api/focus': (q, b) => {
    const list = (Array.isArray(b.coins) ? b.coins : []).filter((a) => ADDR_RE.test(a)).slice(0, 3);
    svc.stream.watchTokens(list);
    return { watching: list };
  },
  'POST /api/trade/quote': (q, b) => svc.trader.quote({ side: b.side, token: address(b.token, 'coin address'), usd: b.usd != null ? Number(b.usd) : undefined, pct: b.pct != null ? Number(b.pct) : undefined, slippage: Math.min(50, Math.max(1, Number(b.slippage) || 30)) }),
  'POST /api/trade/confirm': async (q, b) => {
    const o = await svc.trader.confirm(String(b.quoteId));
    broadcast('order', o);
    return o;
  },
  'POST /api/wallet/measure': (q, b) => svc.measureWallet(address(b.wallet, 'wallet address')),
  'POST /api/simulate': (q, b) => svc.simulate(address(b.wallet), { sizeUsd: Number(b.sizeUsd) || undefined, delaySec: b.delaySec != null ? Number(b.delaySec) : undefined, days: Number(b.days) || 14 }),
  'POST /api/user': (q, b) => svc.setUser(Object.fromEntries(Object.entries({ sizeUsd: Number(b.sizeUsd) || undefined, delaySec: b.delaySec != null ? Number(b.delaySec) : undefined, capitalUsd: b.capitalUsd === null ? null : Number(b.capitalUsd) || undefined }).filter(([, v]) => v !== undefined))),
  'POST /api/discover': (q, b) => svc.startDiscovery(Math.min(200, Number(b.maxDeep) || 80)),
  'POST /api/copy/watch': (q, b) => svc.copyWallet(address(b.wallet)),
  'POST /api/copy/unwatch': (q, b) => (svc.desk.unwatch(address(b.wallet)), svc.copyState()),
  'POST /api/copy/mode': (q, b) => {
    if (!['off', 'confirm', 'auto'].includes(b.mode)) throw bad('mode must be off, confirm or auto');
    if (b.mode === 'auto' && b.confirmText !== 'AUTO') throw bad('Type AUTO to switch on unattended copying.');
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

const PATTERNS = [
  [new RegExp(`^/api/coin/(${ADDR})$`), (m) => svc.coin(m[1])],
  [new RegExp(`^/api/coin/(${ADDR})/candles$`), (m, q) => svc.candles(m[1], ['1m', '5m', '15m', '1h'].includes(q.get('res')) ? q.get('res') : '1m')],
  [new RegExp(`^/api/wallet/(${ADDR})$`), async (m) => ({ ...(await svc.walletDetail(m[1])), explosive: svc.walletExplosive(m[1]) })],
];

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = createServer(async (req, res) => {
  // DNS-rebinding guard: only answer requests addressed to this machine by name.
  if (!ALLOWED_HOSTS.has(String(req.headers.host ?? '').toLowerCase())) return send(res, 421, 'wrong host', 'text/plain');
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
      res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
      clients.add(res);
      lastClientAt = Date.now();
      startLive();
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
        lastClientAt = Date.now();
      });
      return undefined;
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && req.headers['x-jpa-token'] !== TOKEN) return send(res, 403, { error: 'Missing app token. Reload the page.' });
      if (req.method === 'GET') {
        for (const [re, fn] of PATTERNS) {
          const m = url.pathname.match(re);
          if (m) return send(res, 200, await fn(m, url.searchParams));
        }
      }
      const fn = ROUTES[`${req.method} ${url.pathname}`];
      if (!fn) return send(res, 404, { error: 'not found' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      return send(res, 200, await fn(url.searchParams, body));
    }
    if (VENDOR[url.pathname]) return send(res, 200, readFileSync(VENDOR[url.pathname], 'utf8'), TYPES['.js']);
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

// Your own orders: ask GMGN for the status of anything submitted.
let ordersBusy = false;
setInterval(async () => {
  if (ordersBusy || !svc.trader.orders(20).some((o) => o.state === 'submitted')) return;
  ordersBusy = true;
  try {
    await svc.trader.reconcile();
    broadcast('orders', svc.trader.orders(30));
  } catch (e) {
    console.error(`order check: ${e.message}`);
  } finally {
    ordersBusy = false;
  }
}, 4000);

server.listen(PORT, HOST, () => {
  console.log(`JINX personal assistant ready on http://${HOST}:${PORT}  (assistant: ${svc.grok ? 'Grok' : svc.claude ? 'Claude' : 'built-in only'}, copy desk: ${svc.desk.config().mode}, GMGN plan: ${GMGN_PLAN})`);
});
