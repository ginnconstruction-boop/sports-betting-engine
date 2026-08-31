# NFL research and paper audit release

August 31, 2026. Release marker: `football-research-3`.

## Outcome

This release improves research and verifiable practice tracking. It does **not**
complete the football recommendation roadmap. No paid subscriptions, wagers,
historical-odds purchases or automatic model promotion were made.

- The website has a plain-language "Where we stand — and what to do next" panel.
- Core forecasts request at most five recent listed game box scores, two at a
  time, and display verified shares of team attempts/targets. Individual IDs,
  names, game/season/opponent identity, final status, stat values and team totals
  must reconcile. Missing/conflicting context stays missing. This is not snap
  share, routes, a complete appearances cohort, or an opponent adjustment.
- The existing live point forecast and its availability/role/quote gates stay
  unchanged. The new descriptive context does not approve a selection.
- New grading retains immutable full source snapshots before updating results.
  "Verify saved grading" replays every available audit entry without making
  provider requests or changing a pick. Corrupt/missing/legacy sources are
  reported rather than reconstructed. A source outage cannot reverse a settled
  result. This remains paper-rule settlement, not a sportsbook-rules guarantee.
- "Export NFL paper record" includes picks, original forecasts/quotes and up to
  25 MiB of source evidence. Omitted and missing evidence hashes are explicit;
  server-disk backups remain necessary for a complete large archive. It does not
  restore the separate 329-pick reset backup.

## Separate fixed-cohort shadow test

[Protocol](NFL_SHADOW_PROTOCOL_2026_08_31.json) was written and fingerprinted
before this cohort's outcomes were fetched/evaluated. It fixes four players and
seven player/market combinations, 2024 warm-up, chronological 2025 regular-season
testing, and three predeclared formulas. Only earlier games enter each target's
predictors. No coefficient search or result-based cohort replacement occurred.

The existing workload formula and new team-share candidate use identical
complete-source training windows and targets. Target-game team volume is never
an input to that target's prediction. Earlier test outcomes may enter later
training windows: this is **prequential stat evaluation**, not a once-frozen
trained model or an odds-aware holdout/calibration study.

Results: **77 correlated forecasts, 33 distinct games, five evaluable combinations**.
Two other combinations retained as insufficient data, with 32 excluded targets.
All errors below are mean absolute stat errors; lower is better. Yards and
receptions must not be combined into one overall MAE.

| Player / market | Tests | Simple mean | Existing workload | Shadow team-share |
|---|---:|---:|---:|---:|
| Lamar Jackson passing yards | 13 | 50.82 | 47.11 | 47.13 |
| Lamar Jackson rushing yards | 13 | 21.21 | 17.72 | 17.72 |
| Derrick Henry rushing yards | 17 | 41.90 | 42.60 | 42.58 |
| Amon-Ra St. Brown receiving yards | 17 | 33.56 | 35.36 | 35.32 |
| Amon-Ra St. Brown receptions | 17 | 2.56 | 2.66 | 2.66 |
| Ja'Marr Chase receiving yards | 0 | unavailable | unavailable | unavailable |
| Ja'Marr Chase receptions | 0 | unavailable | unavailable | unavailable |

The candidate was slightly better than existing workload on two of five
combinations and slightly worse on three; the simple mean beat both on three.
There is no demonstrated reason to promote the candidate. These are **not wins,
losses, probabilities, profit or a live-policy replay**. There are no archived
game-time injury inputs or odds in this test, and the public stats can be revised.
The cohort is illustrative and not league-representative.

Chase exclusions were not network failures or absent player IDs. Two supplied
team target totals disagreed with summed player targets: ESPN game `401671836`
returned 92 vs 46; `401772934` returned 52 vs 31. The fixed complete-window rule
therefore excluded affected targets instead of guessing a corrected denominator.
The original frozen result is retained. A future alternate-source study must
have a separately registered protocol and must not overwrite this report.

The audit used **103 public ESPN requests and zero Odds API credits**. Protocol,
report and observations are committed. The 104 content-addressed source/registration
artifacts (~48.7 MB) are preserved locally in
`research/nfl-share-shadow-2026-08-31/sources/`, ignored by Git to avoid bundling
full provider payloads into deployment. [Frozen report](nfl-share-shadow-2026-08-31/report.json).
Automated tests reproduce the report exactly without network calls.

## Availability remains unresolved, for specific reasons

- ESPN current roster/injury/depth fields are useful warnings but not verified
  game-specific active evidence. A sampled December 14, 2025 game summary
  contained August 31, 2026 injury dates. These fields are deliberately excluded
  from historical predictors; a historical page is not an as-of injury archive.
- The [nflverse availability schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
  still reports the injury-source discontinuation and end-of-season participation
  timing. Those feeds do not solve current game-time availability.
- [NFL official inactives](https://www.nfl.com/news/nfl-week-14-inactives-players-ruled-out-for-sunday-s-12-games)
  are useful manual evidence, but omission is not sufficient proof of active eligibility.
- No trusted automated complete active-status adapter was established in this
  release. Do not fabricate a publication timestamp, mark roster-active as
  game-active, or weaken the gate to make the button issue a pick. Such evidence
  may only be available near kickoff, not during early-week research.
- No new budget is needed just to continue research. Evaluate exact source
  coverage/terms first; present an actual price/capability before any purchase.

## Verification

- 96 automated tests pass; includes existing recommendation/save/grade workflow,
  unavailable sources, corrections, immutable quotes/forecasts, replay/export,
  missing/duplicate workload data and target/future-data leakage checks.
- Server-inclusive TypeScript build and browser JavaScript syntax pass.
- Production dependency audit: zero reported vulnerabilities.
- Local authenticated smoke: health, NFL 15 games, college 96 games, empty paper
  and export all 200; anonymous export/replay 401, missing replay 404, invalid
  forecast 400. No paid odds calls or test picks.
- Local browser: plain-language panel, NFL/college entry points, paper controls
  and export button visibly present. Browser skill used for actual UI verification.
- Live public-source context check returned five verified historical workload
  rows for Lamar Jackson. That was a player-data check using a synthetic event
  wrapper, not verification of a scheduled matchup or an issued forecast/pick.

Deployment and production verification are recorded after the release below.

## Next recommendations, in order

1. Establish a verified exact-game active/participation source and historical
   identity/role coverage; no automatic recommendations until it passes checks.
2. Add independently verified snap/route/opportunity and opponent data, then
   compare fixed candidate models with simple and market baselines. Keep failures.
3. Run a larger predetermined odds-aware evaluation with historical availability,
   separate calibration/test periods, settlement rules and no future-data leakage.
4. Collect prospective 2026 paper selections before kickoff, grade/recheck them,
   export records, and review uncertainty by market and distinct game.
5. Add bounded unattended grading/closing capture only with an explicit operating
   schedule and credit limits. Current grading is on demand; no guaranteed close.
6. Validate college and specialty NFL recommendations separately after the core
   NFL workflow. College remains quote-only; specialty model restrictions stay.
