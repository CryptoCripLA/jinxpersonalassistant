// Rate-limit weight of each GMGN OpenAPI route, as published in the official
// gmgn-skills docs (gmgn-portfolio / gmgn-track / gmgn-market / gmgn-token / gmgn-swap
// SKILL.md "Rate Limit Handling" tables, gmgn-cli 1.6.7).
export const ROUTE_WEIGHTS = {
  tokenInfo: 1,
  tokenSecurity: 1,
  tokenPool: 1,
  tokenHolders: 5,
  tokenTraders: 5,
  kline: 2,
  kline1s: 3, // Pro only
  trending: 3,
  trenches: 2,
  signal: 1,
  hotSearches: 3,
  search: 1,
  userInfo: 2,
  walletHoldings: 2,
  walletActivity: 3,
  walletStats: 3,
  walletProfits: 3,
  walletTokenBalance: 2,
  createdTokens: 2,
  followWallet: 10,
  kol: 1,
  smartMoney: 1,
  calloutRecord: 1,
  calloutGlobal: 1,
  quote: 10,
  swap: 10,
  queryOrder: 5,
  gasPrice: 1,
};
