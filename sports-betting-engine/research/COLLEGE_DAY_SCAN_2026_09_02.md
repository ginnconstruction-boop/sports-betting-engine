# College full-day scan release — September 2, 2026

Website: https://sports-betting-engine-1.onrender.com/
Release marker: `college-day-scan-4`.

## Root cause and scope

The dropdown sent an event ID only to `/api/college/markets`. The old separate
college button invoked `ncaaf` without an event ID. It therefore was not limited
to that selected game, but its scorer allowed only 1–24 hours until kickoff,
not a selected calendar day. Empty, out-of-window, sparse-data and rejected
candidate cases could collapse into an ambiguous "No qualifying plays" message.

The new primary college UI accepts a date only. It checks all provider games on
that Central date, independently reconciles the ESPN schedule, and explains
each skip. Lists/details are collapsed by default. No single-game selection
influences the scan. The legacy `ncaaf` command now uses the same full-day service.
Other multi-sport commands are not converted by this release.

## Implemented safeguards and reusable foundation

- Free schedule discovery; one US bulk spreads/totals call, maximum 2 credits,
  no paid retry or per-event fan-out. Five-minute cache reused across dates.
- Busy guard, explicit calendar validation, kickoff recheck, duplicate event
  handling, strict same-team/source-ID/season/kickoff verification.
- Exact-line two-sided comparison against at least three OTHER fresh books.
  Configured target books are FanDuel/BetMGM. At most one research selection per
  market/game above a fixed 2-percentage-point conditional price threshold.
- No validated college prediction model is enabled. Conditional no-push market
  references are not independent forecasts, unconditional EV or proven edges.
  No automatic W/L entry, real wager, model promotion or bankroll advice.
- Separate college manual ledger, full-game spreads/totals including OT,
  pushes, missing-data REVIEW, exact frozen team IDs and neutral-site flag.
- Shared NFL persistence/audit/export lifecycle uses a league-specific profile.
  College cannot issue NFL-model picks or mix ledger/source files. Original
  quotes remain immutable; corrected finals add audit evidence.
- Scan reports/source payloads are saved under `college_day_scans`, not picks.
- Targeted `qs` override to 6.16.0 addresses the September 2 advisory. No Express
  major-version migration. [Maintainer advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g).

## Verification before deployment

- 115 tests pass; server-inclusive TypeScript build and frontend JS syntax pass.
- `npm audit --omit=dev`: zero reported vulnerabilities after the patch.
- Synthetic tests cover a complete 68-game slate, date/DST boundaries, same-day
  near-kickoff inclusion, started-game exclusions, one bulk request, cross-date
  cache, concurrent request blocking, absent/failed/stale/malformed sources,
  exact-book comparisons, distinct recommendation/research labels, API body
  scope, and college paper save/dedup/grade/correction/replay/export isolation.
- Local authenticated route smoke: success reads; anonymous 401; invalid
  scan/paper bodies 400; missing replay 404; no picks created.
- Browser: main college entry, hidden optional dropdown, date-only request,
  today empty with next-day button, next-day full scan, free repeat, Saturday
  full scan with cross-date cache and per-game reasons all verified.
- September 2 browser scan: zero provider and independent games, zero credits.
- September 3 source snapshot: 10 provider games. After one reviewed name alias,
  all ten have fresh odds; nine no price candidate, one insufficient exact-line
  comparison. Rutgers–UMass independently scheduled but absent from provider.
  [Rutgers game notice](https://scarletknights.com/news/2026/8/30/game-1-football-vs-umass)
  confirms September 3 at 6 PM Eastern (5 PM Central).
- September 5: 68 provider games; eight reviewed ID-bound naming aliases repaired
  using the archived independent feed. Same-source offline verification then
  yields 66 with fresh odds, 49 no price candidate, 16 insufficient comparison,
  one no configured book and two blocked kickoff conflicts: Miami (OH)–Pitt and
  Western Michigan–Michigan (30-minute differences). No tolerance widening.
- No research candidates in either checked slate snapshot. No results/outcomes
  were fetched, no historical win-rate claim, no model coefficients changed.
- Local paid testing used 2 credits total; repeat and Saturday calls reused the
  same bulk response. The previously proposed 20-credit historical test was
  deferred when the user prioritized this scan issue; it was never requested.
- The initial September 2 provider quota check showed 6 used / 19,994 remaining;
  this differs from the August balance and is not a price/reset-date assumption.

## Production preservation and owner action

Predeployment checks on Render: official ledger 0, NFL/college paper files absent,
ATS 58 keys, intentional reset backup 329 records. Fingerprints:

- Official: `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`
- ATS: `a88d1eb14b104a7be04baf9efe8274b98239d9fab8b3b123c2b650662c89f8a3`
- Backup: `c252ce69b46dadfac7c7894c50c3892a3f97bcaeceefd7f3ddb67a2eb6703bbd`

Render displays "Payment failed" and warns of possible service access loss.
The owner must update billing; credentials, payment details and subscriptions
were not changed. Deployment/live verification is recorded below when complete.

## Remaining next steps

1. Owner: resolve Render billing warning.
2. Use the full-day scan for September 3 and later dates; inspect coverage gaps.
3. Resolve source kickoff disagreements and provider omissions without guessing.
4. Finish independent college model development/validation before calling these
   outputs recommendations. Keep NFL availability and model work separate.
5. Collect actual pregame paper selections, then grade after finals; keep manual,
   model, research and historical results separate. No automated background run
   has been enabled by this release.
