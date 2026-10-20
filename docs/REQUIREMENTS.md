# Requirement ledger

Owner order 2026-10-20 ("Build My Personal GMGN Trading Intelligence System"), plus the
follow-ups in the same session: Suggestions with 3-5 wallets, USD only (no SOL anywhere).
Status words: NOT STARTED, PARTIAL, IMPLEMENTED, TESTED, WIRED, LIVE VERIFIED.
"Live verified" means run against the real GMGN API with the owner's key on jinx-nyc.

| # | Requirement | Where | Status | Evidence / gap |
|---|---|---|---|---|
| R1 | Use GMGN's official API, CLI and skills | `src/gmgn/client.js` wraps gmgn-cli 1.6.7 `OpenApiClient` | LIVE VERIFIED | 0 errors over 3 discovery runs (5,000+ calls incl. cache). Route weights and plan buckets from the official skill docs |
| R1a | Confirm access requirements and endpoint permissions | `src/gmgn/weights.js`, `limiter.js` | LIVE VERIFIED | Key accepted; follow-wallet (weight 10) and quote work; **1-second candles refused with PRO_PLAN_REQUIRED** for this key even after the Pro upgrade, so 30-second candles are used and 1s switches on automatically once GMGN allows it |
| R1b | Verify native copy-task creation | full route list of gmgn-cli 1.6.7 | VERIFIED ABSENT | No copy-task route exists (swap, multi-swap, strategy orders only), so the app has its own wallet follower (R7) |
| R2 | Automated wallet discovery across styles | `src/discovery/discover.js` | LIVE VERIFIED | Sources: GMGN smart-money and KOL feeds, top earners and smart-money traders on graduated and trending coins; insiders, bundlers, pools and bots dropped; 740 candidates -> 90 deep profiles in one run |
| R2a | 7-day, 30-day and longer periods | `walletStats 30d`, `walletProfits 30d`, up to 300 trades of history | PARTIAL | 30-day GMGN stats and up to 300 trades (hundreds of days for selective wallets). 7-day and all-time GMGN totals are fetchable but not shown yet |
| R2b | Profits, losses, frequency, win rate, hold time, entry timing, selling, stage, costs | `src/analysis/trades.js`, `profile.js` | TESTED, LIVE VERIFIED | Round trips from live activity rows; GMGN's recorded venue fee per trade (`dex_usd`) used for costs |
| R2c | Prefer 1-3 coins per active day, holds generally under 2 hours | `preferenceFit`, Suggestions "match" / "close match" | TESTED, LIVE VERIFIED | Close matches are labelled with the exact difference |
| R2d | Separate rankings: graduated, early momentum, sniping | `src/analysis/rank.js` | TESTED, LIVE VERIFIED | Dashboard "More wallets by style" |
| R3 | Opportunity discovery by category with reasons and entry timing | `src/analysis/opportunities.js`, `Service.opportunities` | TESTED, LIVE VERIFIED | New, about to graduate, just graduated, smart money buying, trending; GMGN checklist and lifecycle stage wording; fee break-even |
| R3a | Social chatter, narratives, KOL attention | opportunities | PARTIAL | KOL holder counts and your own wallets' buys are shown. X/Twitter chatter (e.g. via Grok search) NOT STARTED: needs the owner's OK to use the xAI key |
| R3b | Developer behaviour | opportunities | PARTIAL | Creator sold/holds is scored; creator launch history (GMGN created-tokens) is fetched for profiles but not yet scored for coins |
| R4 | USD-only experience, real conversion rate | `src/money/usd.js`, all UI copy | TESTED, LIVE VERIFIED | Tests assert no SOL or lamports in settings, suggestions and glossary text; GMGN's own SOL price feeds conversions |
| R5 | Copy-profit simulator: delay, entry/exit prices, slippage, platform and network fees, frequency; wallet vs you | `src/analysis/simulate.js`, `simprofile.js` | TESTED, LIVE VERIFIED | Real candle replays; typical and bad-luck results; cash tracked in time order; per-trade table; equity line |
| R6 | Copy settings per wallet in elementary English | `src/analysis/settings.js` | TESTED, LIVE VERIFIED | GMGN's official setting names; SOL kept only for the "copy for GMGN" button |
| R7 | Direct Copy Wallet workflow / own follower and execution | `src/copy/desk.js`, server routes, dashboard | TESTED, WIRED | Quote then swap with minimum output, limits, one order per wallet trade, compare-and-set claims, unknown sends never re-sent, TP/SL condition orders when chosen. **No real order has been placed**: that needs an explicit owner order; desk ships Off |
| R8 | Plain-English assistant for the six example questions and more | `src/assistant/router.js`, `llm.js` | Built-in: TESTED, LIVE VERIFIED. Claude: TESTED (fake client), not live | Claude layer needs an Anthropic key in the app's `data/secrets.env` (owner decision) |
| R9 | Standalone, able to feed JINX later; preserve JINX modes | `src/jinx/export.js` | TESTED | Writes `data/exports/smart_wallets.json` in the format JINX's `read_auto_wallets` accepts, max 30 wallets. Not wired into JINX; no JINX code or runtime touched |
| R10 | Responsive dashboard | `public/` | IMPLEMENTED, WIRED | All API routes smoke-tested live. Not checked in a real browser by Claude (no browser on jinx-nyc, disk at 91%) |
| R11 | Suggestions: 3-5 wallets by dollars you could make (owner follow-up) | `src/analysis/suggest.js` | TESTED, LIVE VERIFIED | 5 picks built from live candles in 19 seconds |

Running state on 2026-10-20: started by hand on jinx-nyc (`127.0.0.1:8899`, pid in
`data/server.pid`). It is not a system service and nothing restarts it after a reboot.
