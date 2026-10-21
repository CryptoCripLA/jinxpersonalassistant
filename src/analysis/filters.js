// The filters profitable Pump.fun traders actually use (owner guidance 2026-10-21): mint and
// freeze authority revoked, the creator not dumping right away, holder concentration not insane,
// real socials, and enough liquidity and volume that you are not the only buyer. Each is a plain
// pass / fail / unknown with the number behind it. Hard fails take a coin off the recommendation
// list; soft fails are shown as warnings.
import { usdShort, pct } from '../money/usd.js';
import { duration } from '../text/plain.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const flag = (v) => (v === true || v === 1 || v === '1' ? true : v === false || v === 0 || v === '0' ? false : null);

export function safetyChecks(t, { now = Math.floor(Date.now() / 1000) } = {}) {
  const checks = [];
  const add = (key, ok, text, hard = false) => checks.push({ key, ok, text, hard: hard && ok === false });
  const mint = flag(t.renounced_mint);
  add('mint', mint, mint == null ? 'Mint authority: unknown.' : mint ? 'Mint authority revoked: nobody can print more coins.' : 'Mint authority active: the team can still print more coins.', true);
  const freeze = flag(t.renounced_freeze_account);
  add('freeze', freeze, freeze == null ? 'Freeze authority: unknown.' : freeze ? 'Freeze authority revoked: nobody can lock your coins.' : 'Freeze authority active: your coins could be locked so you cannot sell.', true);
  const created = num(t.created_timestamp ?? t.creation_timestamp ?? t.open_timestamp);
  const ageSec = created != null ? now - created : null;
  const devHold = num(t.dev_team_hold_rate);
  if (t.creator_token_status === 'creator_close' && ageSec != null && ageSec < 600) add('dev', false, `The creator sold within ${duration(ageSec)} of launch.`);
  else if (devHold != null && devHold > 0.1) add('dev', false, `The creator's team still holds ${pct(devHold, 0)} and could dump it.`);
  else if (t.creator_token_status === 'creator_close') add('dev', true, 'The creator already sold, so no creator bag is waiting.');
  else if (devHold != null) add('dev', true, `The creator's team holds only ${pct(devHold, 0)}.`);
  else add('dev', null, 'Creator holdings: unknown.');
  const top10 = num(t.top_10_holder_rate);
  add('holders', top10 == null ? null : top10 <= 0.3, top10 == null ? 'Holder concentration: unknown.' : `The 10 biggest holders own ${pct(top10, 0)}${top10 > 0.5 ? ': a few wallets control it' : top10 > 0.3 ? ': on the high side' : ''}.`, top10 != null && top10 > 0.5);
  const social = [t.twitter, t.twitter_username, t.website, t.telegram].some((s) => typeof s === 'string' && s.trim());
  const dup = Number(t.twitter_dup) > 0 || Number(t.website_dup) > 0;
  add('socials', social && !dup, !social ? 'No social links.' : dup ? 'Social links reused from other coins (often bot spam).' : 'Has its own social links.');
  const liq = num(t.liquidity);
  const vol = num(t.volume_24h ?? t.volume);
  const okLiq = liq != null && liq >= 10_000 && (vol == null || vol >= 10_000);
  add('liquidity', liq == null ? null : okLiq, liq == null ? 'Liquidity: unknown.' : `${usdShort(liq)} in the pool${vol != null ? ` and ${usdShort(vol)} traded today` : ''}${okLiq ? '' : ': thin, your own sale could move the price'}.`);
  return { pass: !checks.some((c) => c.hard), passed: checks.filter((c) => c.ok === true).length, checks };
}
