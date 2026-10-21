# Requirement ledger

Status words: NOT STARTED, PARTIAL, IMPLEMENTED, TESTED, WIRED, LIVE VERIFIED.
"Live verified" means run against the real GMGN, pump.fun and xAI services with the owner's keys
on jinx-nyc and seen in the running app. **No real order has been placed by TRADES**; every
order path is verified up to a live GMGN quote.

Owner orders, newest first (a newer order wins where they differ):

1. 2026-10-21 edge logic: stop blind auto-sniping; copy proven wallets that take profit, with a
   max size and hard stop, watching 1-2 weeks first; migration over launch sniping; mint/freeze,
   dev, holder, socials, liquidity and volume filters; mechanical exits (2x/3x/5x partials,
   trailing stop, hard stop); size small, competitive tips only on conviction.
2. 2026-10-21 redirect: a personal AI trading expert, not a GMGN clone (T1-T12 below).
3. 2026-10-20 rebuild: FOMO/GMGN-style terminal with an embedded assistant, Impeccable, explosive
   capture ranking, 7x+ discovery study, USD profit presentation (M1-M10).
4. 2026-10-20 first build (R-rows at the end, corrected where later facts changed them).

## T: personal AI trading expert (2026-10-21)

| # | Requirement | Where | Status | Evidence / gap |
|---|---|---|---|---|
| T1 | Real USD balance and trades; explain "GMGN paused" and "wallet unavailable" | `src/service.js` `account`, `accountView`; `public/js/views/today.js` | TESTED, LIVE VERIFIED | Live account read (stale: false). On a failed read the last known balance is shown with its time and the reason; a GMGN pause shows when it lifts |
| T2 | Daily dollar target and wallets that reached comparable copyable days | `src/analysis/mission.js` `dailyPlan`, `walletDays` | TESTED, LIVE VERIFIED | Live plan for $50 with $25 trades: 3 trades at about 1.7x each or one at about 3.1x, with how many positions the real balance allows. Each trader card counts the days its copies would have reached the target |
| T3 | Find traders for me, with fit and why | `src/intel/advisor.js` `recommendTraders` | TESTED, LIVE VERIFIED | 112 wallets measured; 2 close matches recommended; 110 skipped, each with its reason (e.g. the +$724 wallet: 18.3 coins a day, sells within 62 s, replay not trustworthy) |
| T4 | Trader type, coins per day, hold time, last trade, buying/selling behaviour, realized profit | `src/analysis/traderType.js`; `public/js/cards.js` | TESTED, LIVE VERIFIED | Types: bot, sniper, early-entry, pre-graduation, graduated, momentum, mixed. Exit habits (took profit vs rode to zero) on every card |
| T5 | Simulated results at my size with delay, slippage, fees, losses, exits | `src/intel/wallets.js` `analyzeWallet` (replay), `src/analysis/simulate.js` | TESTED, LIVE VERIFIED | $25 copies replayed on real candles with copy delay, price impact, GMGN and network fees; labelled SIMULATED |
| T6 | Explosive opportunities with evidence, wallets, entry/exit timing; theoretical vs executable apart | `src/intel/advisor.js` `opportunitiesForYou`; `src/intel/study.js` | TESTED, LIVE VERIFIED | Cards show the realistic follower result (median 1.4x on 139 past entries) next to the theoretical 10x. The live board fills only while a TRADES tab is open |
| T7 | One-click copy (automatic / ask me first) and Buy/Sell, settings in plain English | `public/js/cards.js` copy panel; `/api/copy/start`; `src/trade/manual.js` | TESTED, WIRED; quote LIVE VERIFIED | Live $25 quote with worst fill, tip and exit plan; no order sent. Automatic also needs the server switch `GMGN_ALLOW_AUTOMATED_TRADES=1`, which is not set (owner decision) |
| T8 | Proactive analyst that explains screens on its own | `src/assistant/brief.js`; `public/js/assistant.js` `autoBrief`, buy alerts | TESTED, LIVE VERIFIED | Each screen gets a brief on arrival; recommended traders' buys raise an alert. Grok (`grok-4.7`) answers open questions through read-only tools |
| T9 | USD everywhere | `src/money/usd.js`, all copy | TESTED, LIVE VERIFIED | Tests assert no SOL or lamports in explanations; the only SOL figure is GMGN's own rate line |
| T10 | Easy by default, tables secondary | `public/` (Today home, details toggles) | IMPLEMENTED, LIVE VERIFIED | Seen in the owner's Chrome via KAYJAY. Owner design review pending |
| T11 | Editable preferences: 7x-19x+, about $25, 1-3 coins a day | `/api/prefs`; Today > Your style | TESTED, LIVE VERIFIED | Live prefs: 7x-19x, $25, 1-3 coins a day, 2 h max hold, exit plan |
| T12 | Preserve the repo, use Impeccable, full functionality | `PRODUCT.md`, `DESIGN.md`, `.impeccable/surfaces/public-index-html.md` | IMPLEMENTED | Earlier routes and data kept. Impeccable's detector scan did not run: it needs Chromium, which jinx-nyc does not have; the finish review was done by hand against the direction contract |

## E: edge rules (2026-10-21)

| # | Requirement | Where | Status | Evidence / gap |
|---|---|---|---|---|
| E1 | Stop blind auto-sniping | `src/copy/desk.js`, server switch | IMPLEMENTED | TRADES has no auto-snipe path. Copies start on Watch first; Automatic needs the server switch |
| E2 | Copy proven wallets that take profit; max size and hard stop; watch 1-2 weeks first | `traderType.js` `exitHabits`, `styleFit`; `desk.js` `onBuy` (watchOnly); `service.js` `copyWallet` | TESTED, WIRED | Wallets that ride coins to zero lose their fit. Watch first records what a copy would have done without spending. Every copy buy carries a hard stop |
| E3 | Migration sniping over launch sniping | `opportunitiesForYou` kind `migration`; Today "Fresh migrations" | TESTED, LIVE VERIFIED | Study: graduation signal median 1.5x for a follower over 89 graduations |
| E4 | Filters: mint and freeze revoked, dev not dumping, holder concentration, socials, liquidity and volume | `src/analysis/filters.js` `safetyChecks`; Pulse Explosive column | TESTED, LIVE VERIFIED | Hard fails (mint or freeze active, top 10 over 50%) never reach an opportunity card; the checklist shows on cards and the coin page |
| E5 | Mechanical exits: partial take-profits, trailing stop, hard stop | `src/trade/manual.js` `conditionOrders`, `describeExitPlan`; prefs | TESTED; quote LIVE VERIFIED | Default 30% at 2x, 30% at 3x, 20% at 5x, trail 30% from 2x, hard stop -40%. Condition orders have not been placed live (no real order yet) |
| E6 | Size small; competitive tips only on conviction | `$25` default; `TIPS` normal/fast | TESTED, WIRED | Tip chosen per buy and shown in dollars in the quote |

## M: terminal rebuild (2026-10-20)

| # | Requirement | Where | Status | Evidence / gap |
|---|---|---|---|---|
| M1 | Install and use Impeccable, with evidence | `~/.claude/skills/impeccable`; `PRODUCT.md`, `DESIGN.md`, surface brief | IMPLEMENTED | See T12 for the detector gap |
| M2 | Inspect fomo-terminal, million, gmgnAgent, solbeam for reuse and licenses | README "Built on" | IMPLEMENTED | million (MIT) adapted; the other three studied only (missing or no license file) |
| M3 | New launches, near-graduation, graduated, explosive, live charts, volume/liquidity/holders, smart money, wallet activity | `src/intel/pulse.js`, `coin.js`; `src/pumpfun/*`; `public/js/views/pulse.js`, `coin.js` | TESTED, LIVE VERIFIED | 4-column live board, coin page with pump.fun candles, first buyers, live trades |
| M4 | Buy/Sell through GMGN | `src/trade/manual.js` | TESTED, WIRED; quote LIVE VERIFIED | No real order sent |
| M5 | Holdings and realized profit | `public/js/views/portfolio.js`; `/api/portfolio` | IMPLEMENTED, WIRED | GMGN holdings plus the app's own order and copy ledger. No app-placed trade exists yet, so no realized result from TRADES |
| M6 | Assistant explains every button, chart, coin and wallet; answers natural questions | `src/assistant/explain.js`, `router.js`, `grok.js` | TESTED, LIVE VERIFIED | 30+ explainable elements (Explain mode, Alt+click); the owner's example questions routed; live Grok answer cost about $0.02 |
| M7 | Explosive capture ranking (entry mcap, max vs captured multiple, 3/5/7/10/19x, losses, copyability, 1-3 coins a day) | `src/analysis/explosive.js`, `src/intel/wallets.js` | TESTED, LIVE VERIFIED | Body-based peaks (method `body-v1`); 112 wallets measured |
| M8 | 7x+ discovery study: signals before vs too late | `src/analysis/history.js`, `src/intel/study.js` | TESTED, LIVE VERIFIED | 92 runners (26 launch spikes, 66 breakouts) on 1-minute candles |
| M9 | USD profit presentation labelled historical / simulated / live | `src/analysis/scenario.js`; tags in `public/` | TESTED, LIVE VERIFIED | $25 scenario with break-even rise (about 5.8%) |
| M10 | Run on the remote server and open in the owner's Chrome via KAYJAY | jinx-nyc `127.0.0.1:8899`, SSH tunnel | LIVE VERIFIED | Started by hand (pid in `data/server.pid`); not a system service, nothing restarts it after a reboot |

## R: first build (2026-10-20), with corrections

| # | Requirement | Status | Note |
|---|---|---|---|
| R1 | GMGN official API, CLI and skills | LIVE VERIFIED | gmgn-cli 1.6.7 `OpenApiClient` |
| R1a | Access and endpoint permissions | LIVE VERIFIED | **Corrected 2026-10-20:** the key is on the Plus plan (`x-ratelimit-limit: 20`), not Pro. Pacing for Pro caused GMGN's ban; TRADES now paces for Plus at 80%, research at 60%. 1-second candles are refused, so 1-minute pump.fun and 30-second/1-minute GMGN candles are used |
| R1b | Native copy tasks | VERIFIED ABSENT | gmgn-cli has no copy-task route; TRADES runs its own follower |
| R2-R2d | Wallet discovery across styles and periods | LIVE VERIFIED | Superseded in ranking by M7 and T3; 7-day and all-time GMGN totals still not shown (PARTIAL) |
| R3 | Opportunities by category | LIVE VERIFIED | Superseded by T6 / E3 / E4 |
| R3a | Social chatter | TESTED, WIRED | Grok X search on request (about $0.19 a search, 10-minute cache). Not part of any entry decision |
| R3b | Developer behaviour | TESTED | Creator selling is a filter line (E4); creator launch history is not scored |
| R5-R6 | Copy-profit simulator; copy settings in plain English | TESTED, LIVE VERIFIED | Kept |
| R7 | Copy desk / execution | TESTED, WIRED | Kept; see T7 and E2 |
| R8 | Plain-English assistant | TESTED, LIVE VERIFIED | **Changed by owner:** Grok (xAI) instead of Claude; key in the git-ignored `data/secrets.env` |
| R9 | Export for JINX later | TESTED | `data/exports/smart_wallets.json`; not wired into JINX, no JINX code or runtime touched |
| R10 | Responsive dashboard | LIVE VERIFIED | Breakpoints at 1440 px and 1000 px; checked in the owner's Chrome |

Proof ledger: `docs/agent-handoff/proof.json` (validated with `verify_proof.py`). Test run:
`docs/agent-handoff/evidence/test-suite.txt`.
