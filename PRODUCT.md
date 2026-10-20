# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One person: the owner. He trades Solana meme coins from a GMGN wallet and opens this
terminal in desktop Chrome through an SSH tunnel to the jinx-nyc server. He is not a
developer and does not want trading jargon; he wants to see what is moving, who caught it
first, and act.

## Product Purpose
A personal FOMO/GMGN-style trading terminal with an assistant built into every screen. Its
job is maximum realized profit from explosive moves: coins that go 7x, 10x, 19x or more
within minutes to hours. It finds those moves early, researches the wallets that keep
catching them, and lets the owner buy and sell from the same screen. Success is dollars
actually realized on positions of about $25, not a smooth weekly yield.

## Positioning
GMGN shows the market; this terminal explains it. Every coin, wallet, chart, button and
number can be explained in plain English from the app's own live data, and wallets are
judged by the multiples they actually captured and whether a follower could have copied
them in time, not by headline profit.

## Operating Context
- Data: GMGN OpenAPI (gmgn-cli 1.6.7) with the owner's key: launch feeds, near-graduation
  and graduated coins, trending, smart-money and KOL feeds, token info, security, holders,
  top traders, candles (1-second candles are refused for this key; 30-second and up work),
  wallet activity, stats and holdings.
- Orders: GMGN's swap API from the owner's GMGN wallet (quote first, then swap, then order
  status). The copy desk that follows chosen wallets already exists and ships Off.
- Assistant: built-in answers computed from app data, plus Grok (xAI, owner's key, chosen
  2026-10-20) for open questions and X/Twitter chatter, through read-only tools.
- The owner trades about 1-3 coins per active day at about $25 per entry.

## Capabilities and Constraints
- Every money amount is shown in US dollars. SOL and lamports never appear to the owner.
- Results are always labelled HISTORICAL (a wallet's real trades), SIMULATED (what the
  owner would have got copying them) or LIVE (the owner's own orders). Missing data is
  shown as unavailable, never as $0.
- A token's maximum multiple is always kept separate from what a trader actually captured.
- Live orders happen only when the owner presses Buy or Sell and confirms the quoted
  price. The assistant can never trade. Automatic copying needs the desk switched on plus
  the operator switch GMGN_ALLOW_AUTOMATED_TRADES=1.
- Separate from the JINX trading engine. Never touches JINX code or runtime.
- Repository is public: no keys, databases or wallet data are committed.
- Runs on Node 22 with no build step; served on 127.0.0.1:8899 only.

## Brand Commitments
- Name on screen: K TRADES. The owner's apps share a smoked graphite and gold identity.
- The owner asked for the usability and sophistication of GMGN and FOMO-style terminals.

## Evidence on Hand
- Live GMGN data through the owner's key, a local database of about 90 deep wallet
  profiles built 2026-10-20 (data/app.db, git-ignored), and the copy simulator.
- No real order has been placed through this app yet. No testimonials or performance
  claims exist and none may be invented.

## Product Principles
- Explosive capture over steady yield: rank by realizable big multiples, with copy delay
  and fees counted.
- Explain everything in place: the assistant knows what is on screen and what was clicked.
- Evidence or nothing: every claim names the live number behind it; unknown stays unknown.
- One tap to act, one confirm to spend: buying is fast, but never accidental.

## Accessibility & Inclusion
Plain English at a beginner's reading level. Keyboard-reachable controls, visible focus,
WCAG AA contrast on the dark terminal.
