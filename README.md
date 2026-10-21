# TRADES

A personal AI trading expert for Solana meme coins: research analyst, wallet finder, opportunity
hunter, copy-trading assistant and execution desk in one private web app. It opens already
researched and answers in plain English, with every amount in US dollars.

- **Today**: your GMGN account (cash, available to trade, copy desk, GMGN status), today's dollar
  target and what each trade has to do with your real money, the traders I recommend for your
  style, the strongest opportunities and fresh migrations, and the high earners I skipped and why.
- **Traders**: wallets that keep catching big moves, typed (sniper, early-entry hunter,
  pre-graduation, graduated-coin, momentum, bot), fitted to your style, with their exit habits
  and what your exact copies would have made (copy delay, slippage, every fee, losses included).
- **Live coins**: GMGN-style board (New, About to graduate, Graduated, Explosive now) with
  measured buying speed, smart money and your traders' buys, live from GMGN and pump.fun.
- **Coin page**: chart, why it is moving, exact first buyers (pump.fun trade list), live trades,
  holders, the filter checklist, and Buy/Sell with a mechanical exit plan.
- **History**: real coins that ran 7x+ within hours, which signals came before the breakout and
  which came too late, and what a follower actually captured.
- **Your analyst**: briefs every screen as you arrive, alerts you when a recommended trader buys,
  explains any button or number (Explain mode, or Alt+click), and answers open questions with
  Grok through read-only tools.

## What the research found (live data, 2026-10-21)

- Of 92 coins that ran 7x+, 26 were launch spikes: most of the run happened in the first
  minutes, when only snipers and bundled launch wallets were in.
- A follower entering 30 seconds after a signal that came in time and selling after a 30% drop
  from the high made a median **1.4x**; 2 of 139 such entries reached 10x and 47 lost money,
  although every coin ran. TRADES therefore shows a realistic follower return next to the
  theoretical 10x, never the 10x alone.
- Buying right after graduation was the steadiest signal: a median 1.5x for the follower over
  89 graduations, which is why migration plays rank above launch snipes.
- The top headline copy results (+$724, +$584, +$575) came from wallets flipping coins within
  seconds and buying 18-131 coins a day: not copyable by a person, so they are listed as
  skipped, with the reason.

## Trading rules built in

- Copy proven wallets that take profit; new ones start on **Watch first** (no money) for a week
  or two. Then **Ask me first** (each copy waits for your tap) or **Automatic** (also needs the
  operator switch `GMGN_ALLOW_AUTOMATED_TRADES=1` on the server).
- Migration plays (just graduated) over block-0 launch snipes.
- Hard filters: mint and freeze authority revoked, creator not dumping, holder concentration,
  real socials, liquidity and volume. A hard fail is never offered as an opportunity.
- Mechanical exits ride on every buy as GMGN condition orders: by default 30% at 2x, 30% at 3x,
  20% at 5x, the rest on a 30% trailing stop once it reaches 2x, and a hard stop at -40%.
  Editable under Today > Your style. Copies the desk makes carry the hard stop and still follow
  the trader's sells.
- Normal or Fast tip per buy. Every Buy shows a live GMGN quote first and sends exactly that
  quote within 30 seconds; the order is recorded before it is sent and never sent twice.

## Run it

Requires Node 22.13+ and a GMGN API key set up with GMGN's tool (`gmgn-cli config`, stored in
`~/.config/gmgn/.env`). Grok answers need `XAI_API_KEY` in the git-ignored `data/secrets.env`.

```bash
npm install
npm test
npm start
```

The server listens on `127.0.0.1:8899` only. From your PC, tunnel to it:

```bash
ssh -N -L 8899:127.0.0.1:8899 atlasops@jinx-nyc
```

then open `http://localhost:8899`.

## Data and limits

| Source | Used for |
|---|---|
| GMGN OpenAPI (gmgn-cli 1.6.7) | launch lists, trending, token info and security, holders, top traders, candles, wallet activity and stats, your holdings, quotes, swaps, condition orders |
| pump.fun swap API (unofficial) | every trade on a coin (exact first buyers), 1-minute USD candles |
| PumpPortal stream | new coins, graduations, trades by followed wallets and on the open coin |
| xAI Grok | open questions (read-only tools) and X chatter on request (about $0.19 a search) |

GMGN reports this key as the Plus plan (20 units a second). TRADES uses one budget at 80% of it;
background research may fill only 60%, so your clicks and trades always find room. GMGN pauses
are waited out, never retried in a burst. pump.fun's API is unofficial and may change; GMGN is
the fallback everywhere.

## Built on

- [gmgn-cli](https://github.com/GMGNAI/gmgn-skills) 1.6.7 (MIT), the official GMGN client.
- [lightweight-charts](https://github.com/tradingview/lightweight-charts) 5.2.1 (Apache-2.0), the
  chart engine fomo-terminal and solbeam also use.
- Copyability (edge kept after copy delay) and the bot / distributor wallet flags are adapted
  from [Kelows/million](https://github.com/Kelows/million) (MIT).
- [Rajeev02/fomo-terminal](https://github.com/Rajeev02/fomo-terminal),
  [CodeMuscle/solbeam](https://github.com/CodeMuscle/solbeam) (README says MIT, no license file)
  and [0xilbiscione/gmgnAgent](https://github.com/0xilbiscione/gmgnAgent) (no license) were
  studied as references only; no code was copied from them.
- Interface designed with the [Impeccable](https://github.com/pbakaus/impeccable) skill
  (Apache-2.0); see `PRODUCT.md` and `DESIGN.md`.

## Privacy

This repository is public. Your database, copy ledger, orders, exports, logs and keys live in
`data/`, which git ignores.

Past results are not a promise. Meme coins can go to zero, and fees hurt small accounts most.
