# jinxpersonalassistant

A personal GMGN trading desk for Solana meme coins, written for someone growing a small
account. It does the research GMGN spreads over dozens of screens and answers in plain
English, with every amount in US dollars.

- **Suggestions**: the 3-5 wallets that would have made *you* the most dollars over the last
  14 days, replayed trade by trade with your trade size, a copy delay, real GMGN candle
  prices and every fee. What the wallet made is shown separately from what you would have kept.
- **Ask box**: "Find the best trader who buys graduated coins", "What would I have made
  copying this wallet with $25?", "What is slippage?" and similar questions.
- **Wallet drawer**: plain-English profile, the copy simulator with a dollar line chart, and
  the GMGN copy-trade settings sheet with a reason for every setting.
- **Coins worth a look**: brand-new, about to graduate, just graduated, smart money buying and
  trending coins, scored with GMGN's own published checklist, including the rise your fees
  require before a trade makes a cent.
- **Copy desk**: follows wallets you pick and places your copies through GMGN's swap API.
- **JINX hand-off**: writes a `smart_wallets.json` in the format JINX already reads.

## Run it

Requires Node 22.13+ and a GMGN API key set up with GMGN's own tool (`gmgn-cli config`,
which stores the key in `~/.config/gmgn/.env`; nothing secret lives in this repository).

```bash
npm install
npm test
npm start
```

The server listens on `127.0.0.1:8899` only. From another computer, tunnel to it:

```bash
ssh -N -L 8899:127.0.0.1:8899 atlasops@jinx-nyc
```

then open `http://localhost:8899`.

`npm run discover -- 80` searches GMGN for new wallets from the terminal (the dashboard has
the same button).

## How the numbers are made

| What | Where it comes from |
|---|---|
| Dollar conversions | GMGN's live price (`gas-price` route), time shown in the footer |
| GMGN fee | 1% of every buy and every sell (docs.gmgn.ai, fees page) |
| Launch curve fee | 1% on Pump.fun's bonding curve; after graduation the venue fee GMGN recorded on real trades |
| Network fee | priority + tip per transaction, your setting (GMGN suggests 0.002-0.005 SOL total when speed is not critical) |
| Your copy prices | GMGN candles at the wallet's trade time plus your delay; "bad luck" buys the candle high and sells the low |
| Your cash | tracked in time order, so trades you could not afford are skipped and counted |
| Wallet styles | graduated = bought after the coin left the launch curve; early = on the curve after its first minute; sniping = first minute |

Missing data is shown as "unavailable", never as $0.

## Safety

- Nothing here can trade unless the copy desk is switched on. It starts **Off**.
- **Off** notes what it would have copied. **Ask me first** waits for your tap (45 seconds,
  then it expires). **Automatic** also needs the operator switch
  `GMGN_ALLOW_AUTOMATED_TRADES=1` in the server's environment, the same switch GMGN's own CLI uses.
- Limits in code: dollars per trade, per day, open copies, and a money check before buying.
- Every order gets a GMGN quote first and is sent with that quote's minimum output and anti-MEV.
- One wallet trade becomes at most one order. If GMGN never answers, the order is marked
  "unknown" and is never re-sent. Fills count only once GMGN reports them confirmed.
- Three failed orders in a row switch the desk Off.
- Sells of copies the desk opened always follow the wallet, even when the desk is Off.
- The AI assistant has read-only tools. No tool can buy, sell, approve or change the desk.
- Every POST needs a per-launch token from the page, and the server answers only requests
  addressed to `127.0.0.1` or `localhost`, so other websites cannot press buttons for you.

## Privacy

This repository is public. Your database, copy ledger, exports and logs live in `data/`,
which git ignores. API keys stay in GMGN's own config file or the git-ignored `data/secrets.env`.

## Built on

- [gmgn-cli](https://github.com/GMGNAI/gmgn-skills) 1.6.7 (MIT): the official GMGN OpenAPI client.
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) for the optional Claude assistant.

Past results are not a promise. Meme coins can go to zero, and fees hurt small accounts most.
