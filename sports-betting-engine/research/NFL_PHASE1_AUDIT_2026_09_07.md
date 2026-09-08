# NFL Phase 1 — model, data, settlement, and research audit

Date: 2026-09-07
Scope: NFL spreads, NFL game totals, and NFL player props
Decision: **No NFL model is approved for real-money recommendations. Kelly, staking, parlays, and SGP optimization remain disabled.**

## Executive conclusion

The repository has considerably more NFL safety infrastructure than its older generic scanner suggests. Exact current quotes, conservative player/game identity checks, immutable paper openings, content-addressed evidence, deterministic grading, replay, corrections, risk-one-unit accounting, and per-core-prop forward gates are implemented and tested. Those components should be preserved.

The predictive evidence is not sufficient. The independent full-game score model improves on a simple margin baseline but loses to the closing market; its descriptive 2025 ATS disagreement result is 55-72-1. Its total projection does not beat its simple baseline on RMSE and also loses to the closing market. The four core player-prop forecasts have only a small, selected-player retrospective diagnostic with mixed performance, no league-wide locked test, no approved probability calibration, no verified closing-line archive, and no 2026 forward sample in this workspace.

The highest-priority next phase is therefore **NFL point-in-time data integrity plus durable forward collection**, not threshold tuning or more recommendation labels.

## A. NFL repository map

| Area | Primary implementation | Status |
|---|---|---|
| Odds ingestion and quota/cache | `src/api/oddsApiClient.ts` | Current Odds API client; five-minute in-memory cache, quota headers, bounded retries |
| Market inventory | `src/config/nflMarkets.ts` | Broad quote inventory; quote support is correctly separate from model support |
| Current NFL board | `src/services/nflMarketBoard.ts` | Exact event/category requests, quote identity, timestamps, stale/started-game guards |
| Schedules/game identity | `src/services/nflResearch.ts`, `src/services/nflGameLineResearch.ts` | ESPN live identity plus nflverse historical schedules |
| Team/roster/depth/context | `src/services/nflContextIngestion.ts`, `src/services/nflContextSources.ts`, `src/services/nflResearch.ts` | Current diagnostic context; not a point-in-time historical feature store |
| Official weekly injury report | `src/services/nflOfficialReports.ts` | Implemented; not game-day inactive proof |
| Team/opponent advanced diagnostics | `src/services/nflFreeResearchData.ts` | nflverse weekly team statistics; no active model coefficient |
| Snap diagnostics | `src/services/nflSnapResearch.ts` | nflverse snap counts; cross-provider mapping is exact-name and fail-closed |
| Player game logs/workload evidence | `src/services/nflResearch.ts`, `src/services/nflWorkloadContext.ts` | ESPN game logs and verified team opportunity reconciliation |
| Player forecast | `src/services/nflForecast.ts` | Four core markets; experimental, paper-only, uncalibrated |
| Recommendation orchestration | `src/services/nflRecommendations.ts` | Server-held quote, forecast guards, evidence first, durable save before issuance |
| Independent full-game research | `src/services/nflGameLineResearch.ts`, `src/dev/nflGameLineAudit.ts`, shared `src/services/collegeScoreModel.ts` | Research-only ridge score model; no production recommendation connection |
| Market benchmark | `src/services/footballMarketBaseline.ts` | Exact-line, other-book, timestamp/period validation |
| Probability/qualification safety | `src/services/nflForecast.ts`, `src/services/nflForwardGate.ts`, `src/services/footballGuardrail.ts`, `src/services/probabilityEngine.ts` | Prop empirical estimates explicitly uncalibrated; generic football probabilities cleared |
| Immutable paper ledger/settlement | `src/services/nflPaper.ts`, `src/services/footballSettlement.ts`, `src/services/nflEvidence.ts` | Implemented with conservative result semantics and replay |
| CLV | `src/services/nflForwardGate.ts`, `src/services/nflPaper.ts` | Later quote observations implemented; verified unattended close missing |
| Daily workflow | `src/services/nflDailyRun.ts` | Authenticated manual current-day context + bounded grading; no odds request |
| API/UI | `server.ts`, `public/index.html`, `public/nfl-markets.js` | Guarded board and paper controls plus older generic NFL scan |
| Readiness | `src/services/nflReadiness.ts` | Honest 15-item server-held checklist |
| Legacy generic scanner | `src/commands/runSportScan.ts`, `src/services/topTenBets.ts` | Market-signal ranker, not an independent NFL model; prop path disabled |
| Scheduled jobs | `.github/workflows/college-forward-collector.yml` | College only; no NFL scheduler |
| Deployment storage | `render.yaml` | `SNAPSHOT_DIR=/var/data/snapshots`, but no persistent disk is declared |

## B. Current data sources

| Source | Data | Timing/cache | Historical/point-in-time classification | Identity/production dependency |
|---|---|---|---|---|
| The Odds API | Events; exact book/market/participant/side/line/price/update time | On demand; default five-minute process cache; account quota headers captured | `VERIFIED_POINT_IN_TIME` only when the returned quote is archived before kickoff. Later retrieval cannot reconstruct an earlier line. | Provider event ID retained; exact game validation before paper use. Required for current quote board, not for the independent score model. |
| ESPN public NFL feeds | Team directory, scoreboard, summary, roster, depth chart, injury/news, player game logs, final box score | Adapter caches range from one minute to six hours; fetches are bounded | Live captures can be point-in-time evidence when archived. Retrospective logs are `RECONSTRUCTED_WITHOUT_FUTURE_INFO` for chronological stat values but may include later corrections and incomplete appearances. Current roster/depth/injury data is `UNSAFE_FUTURE_LEAKAGE` for historical forecasts and is not used as historical availability. | ESPN numeric team/player/event IDs are the primary canonical IDs. Public feed, not a contracted SLA. |
| NFL.com weekly injury report | Practice status and game designation | Fifteen-minute cache in game week | Current archived report is point-in-time evidence; current page is not by itself an immutable historical archive | Official source and team/player labels; no complete verified game-day inactive adapter. |
| nflverse GitHub releases | Historical schedules, weekly team stats, snap counts | Six-hour adapter caches for team/snap research; historical evaluation downloads directly | `RECONSTRUCTED_WITHOUT_FUTURE_INFO` when chronological cutoffs are enforced. Release files are revised datasets, not original pregame snapshots. | Team abbreviations and PFR player IDs; player crosswalk currently requires a unique exact normalized name. |
| ESPN summary weather/venue fields | Temperature, wind/gust/precipitation where present, indoor flag where present | Summary cache; missing fields stay null | Current context only unless archived pregame; no historical weather model input is approved | Attached only after exact game match. No point/yards adjustment enabled. |
| Local evidence/ledger | Forecast inputs, quotes, openings, later observations, settlement payloads | Written at action time | `ARCHIVED LIVE` when the underlying storage survives deployment | Content-addressed or opening-hashed. Deployment durability is not yet proven because Render persistent storage is not configured in the blueprint. |

Provider-wide published quotas for ESPN, NFL.com, and GitHub are not encoded and were not assumed. The Odds API account reports its remaining/used quota in response headers; request cost depends on the selected market group. There is no hidden NFL polling loop.

## C. Data-integrity failures

The current NFL context layer persists provider-level results such as `SUCCESS`, `PARTIAL_SUCCESS`, `TEAM_MATCH_FAILED`, and source errors. It does **not** yet persist the requested six independent stages—source retrieval, normalization, entity matching, context attachment, field validity, and forecast-time freshness—as `PASS/PARTIAL/FAIL/UNKNOWN` for each game/team/category.

Important consequences:

- An HTTP/provider success cannot yet be audited independently from normalization and per-team attachment through a unified NFL diagnostic record.
- `sourceRegistry` is aggregate by provider/category. Per-team fields preserve many failures, but there is no uniform stage artifact tied to each forecast timestamp.
- `completeness` is a nine-boolean display percentage. It is not used by the guarded NFL decision engine, but it is an arbitrary diagnostic score and should be deprecated in favor of transparent category counts.
- Raw preflight payloads are content-addressed, while `nfl_context/latest.json` is intentionally replaceable. The latter is a convenience view, not the immutable authority.

Status: **FAILS the requested six-stage standard; fail-closed behavior exists in the forecast/ledger path, but observability is incomplete.**

## D. Game identity status

Strengths:

- The Odds event must match exactly one ESPN event by normalized home team, away team, kickoff within two hours, regular-season type, and numeric ESPN event/team IDs.
- Reversed home/away, ambiguous matches, missing IDs, started games, duplicate paper selections, and wrong sport fail closed.
- Neutral-site state is retained when ESPN supplies a boolean.

Gaps:

- The persisted NFL verified-event object does not fully preserve venue, week, and season-type provenance even though some of it is observed upstream.
- There is no durable provider-to-canonical game registry or reschedule lineage containing original and updated kickoff.
- International/neutral games are not separately validated beyond the general event match.
- A two-hour kickoff tolerance is safe only while the matchup is unique; it is not a full reschedule policy.

Status: **Strong fail-closed matching, incomplete canonical provenance.**

## E. Player identity status

Current props use an ESPN numeric player ID after a unique exact normalized full-name match across the two current rosters. Suffixes and punctuation are normalized. Stats and depth rows must match the numeric ID, team, season, and name. Ambiguous/missing players fail closed; first-initial guesses are prohibited.

Missing capabilities are a durable cross-provider player registry, official mappings to the Odds provider/PFR, transaction history, new-team/rookie flags, practice-squad elevation history, name-change history, and position-change history. Exact-name PFR matching for snap data is conservative but incomplete.

Status: **Safe for matched current roster players; insufficient for comprehensive prop coverage and historical role transitions.**

## F. Current spread model formula

The independent research model is a chronological ridge score model. For each side:

`expected points = league intercept + team offense coefficient + opponent defense coefficient ± learned home-field half-effect`

It trains on completed regular-season games from the current and previous season before the target calendar day. Current-season games have base weight 1.0, prior-season games 0.65, then both decay exponentially. Nine ridge/half-life candidates were declared; 2024 selected ridge `3` and half-life `180 days`. Each team needs at least six historical games.

The sportsbook spread is not a feature. It is attached after prediction strictly as an evaluation benchmark. The model is therefore independent of the market, although it reuses the transparent score-model implementation originally built for college research.

The simple margin baseline averages each team's scoring and opponent points allowed, with a fixed three-point home-margin effect.

## G. Spread historical performance

Untouched chronological 2025 regular-season holdout, N=272:

| Measure | Independent model | Simple baseline |
|---|---:|---:|
| MAE | 10.3217 | 10.6136 |
| RMSE | 13.0105 | 13.4304 |
| Bias (actual minus prediction) | -0.1128 | -0.7972 |

The model modestly improves the simple baseline, but this is not sufficient for recommendation approval.

At the frozen descriptive rule of at least two points of model/closing-market disagreement: 128 selections, **55 wins, 72 losses, 1 push**. These are closing-line research comparisons, not archived actionable-price returns.

Research gate: **FAILS / research-only.**

## H. Market spread benchmark

Closing market on the same 272 games:

- MAE: 9.7224
- RMSE: 12.2712
- Bias: +0.5717 actual home-margin points

The closing market beats both the independent model and simple baseline. The market is not used to fit the independent model.

## I. Current total model formula

There is no separately designed NFL totals model. The score model's home and away expected points are summed:

`projected total = projected home points + projected away points`

The implementation has no validated total-specific pace, play-volume, pass rate, rush rate, red-zone, explosive-play, quarterback, offensive-line, defensive-injury, roof, or weather coefficients. Current weather and nflverse team/opponent data are diagnostic only.

## J. Total historical performance

The audit now exposes total metrics on the same chronological 2025 holdout, N=272:

| Measure | Score-sum model | Simple score baseline |
|---|---:|---:|
| MAE | 10.6525 | 10.6617 |
| RMSE | 13.4530 | 13.4228 |
| Bias (actual minus prediction) | -0.1312 | +0.0616 |

The score-sum model is essentially tied on MAE and slightly worse on RMSE. It has no approved OU probability or selection gate.

Research gate: **FAILS / totals remain disabled.**

## K. Market total benchmark

Closing market total on the same 272 games:

- MAE: 10.3934
- RMSE: 13.1864
- Bias: +1.1507 actual points

The closing market again beats the research model and simple baseline.

## L. Current player-prop architecture

The guarded prop model is not market-derived. For the last 20 eligible same-team games:

- Workload = `60% × mean opportunity over last 5 + 40% × mean opportunity over last 20`.
- Efficiency = `40% × pooled last-5 value/opportunity + 60% × pooled last-20 value/opportunity`.
- Point forecast = `workload × efficiency`.
- Baseline = mean stat value over the same last-20 window.
- Minimum training games = 8; minimum rolling forecast errors = 8.
- The model must beat its trailing-average baseline on the player's rolling diagnostic.
- A recent/long workload ratio outside 0.65–1.35 blocks issuance.

Passing opportunity is attempts, rushing opportunity is attempts, and receiving opportunity is targets. Verified team opportunity is used for descriptive share reconciliation. Snap counts are diagnostic only. The exact posted line and price are not used in the point projection.

The projected mean becomes over/under/push frequencies by applying the most recent 20 rolling forecast residuals, rounding to the integer stat, and adding one pseudocount per possible outcome. This empirical distribution is explicitly uncalibrated and is not assumed normal.

## M. Supported prop families

Model-supported core markets:

- passing yards
- rushing yards
- receiving yards
- receptions

Quote/manual-paper only: passing TDs/attempts/completions/interceptions/longest, rushing attempts/longest/TDs, receiving longest/TDs, combined yardage, TD scorer markets, kicking, defense, quarters/halves, team totals, and alternate lines.

There are no approved QB/RB/WR/TE family gates beyond the four market-key gates. TDs, longest plays, low-volume defense/kicking, and alternate markets correctly remain unmodeled.

## N. Player opportunity data status

Available: pass attempts, rush attempts, targets, reconciled team opportunity, and historical offensive snap counts.

Unavailable or not model-ready: dropbacks, designed rushes versus scrambles, routes, route participation, carry/target/air-yard share as immutable pregame features, goal-line/red-zone share, committee classification, teammate redistribution, offensive-line starters, and validated opponent adjustments.

The present architecture correctly separates workload from efficiency, but its opportunity estimate is too shallow for trustworthy Week 1 roles, rookies, traded players, or committee backfields.

## O. Injury/depth-chart status

Current rosters and expected depth-chart order are available. The official NFL weekly report supplies practice and game-status text. The model treats expected depth position as provisional and blocks on stale/unknown depth, roster injury flags, weekly injury listings, or absent exact game-day availability.

No verified live game-day inactive adapter exists. `ACTIVE` is therefore not inferred from roster membership or absence from an injury feed. DNP/LIMITED/FULL and OUT/DOUBTFUL/QUESTIONABLE can be preserved where the official report supplies them, but complete historical point-in-time coverage has not been established.

## P. Historical prop sample sizes

- Fixed 2025 forecast cohort: 96 player-market forecasts across a selected group of players/markets; not league-wide and not betting records.
- Separate workload-share shadow artifact: 77 correlated forecasts across 33 distinct games; candidate never promoted.
- Frozen December 7 retrospective odds pilot: 68 quoted player/market pairs, 9 conditional selections across 2 games, 7 settled and 2 unresolved legacy `REVIEW` cases.
- Pilot result: 3-4-0 on settled selections, -1.3214 risk-one-unit returns, -18.88% settled-stake ROI. This is far too small and correlated for inference.
- New immutable NFL paper ledger in this workspace: no file, therefore N=0 locally.
- Legacy `picks_log.json`: 329 records, none classified as NFL.

## Q. Prop projection performance by market

Fixed 2025 selected-player diagnostic:

| Player/market | N | Model MAE | Model RMSE | Model bias | Baseline MAE | Baseline RMSE |
|---|---:|---:|---:|---:|---:|---:|
| Drake Maye passing yards | 17 | 57.92 | 68.46 | +37.08 | 63.63 | 71.74 |
| Patrick Mahomes passing yards | 14 | 41.77 | 53.00 | +0.08 | 41.49 | 52.12 |
| Drake Maye rushing yards | 17 | 15.25 | 17.84 | -2.07 | 14.76 | 17.38 |
| Patrick Mahomes rushing yards | 14 | 20.60 | 25.13 | +4.38 | 19.79 | 24.00 |
| Jaxon Smith-Njigba receiving yards | 17 | 30.99 | 40.26 | +13.61 | 33.48 | 43.03 |
| Jaxon Smith-Njigba receptions | 17 | 1.78 | 2.09 | +0.44 | 1.85 | 2.10 |
| Travis Kelce receiving yards/receptions | 0 | unavailable | unavailable | unavailable | unavailable | unavailable |

Positive bias means actual exceeded projection. Results are mixed: three displayed player/markets improve MAE, three fail or have no sample. Selection of players is illustrative, not representative. No model-level profitability or calibration conclusion is valid.

## R. Current probability/calibration status

- Full-game spread probability: unavailable.
- Full-game total probability: unavailable.
- Core prop probability: smoothed empirical residual frequency, explicitly `uncalibrated`.
- Market reference probability: no-vig exact-line price comparison from other books; it is a market benchmark, not the independent model probability.
- Generic football scanner probability: stripped/undefined before decisions.
- Market-specific Brier, log loss, calibration slope/intercept, and reliability curves: no adequate locked sample yet.
- Kelly/probability-derived staking: disabled.

The forward gate is separate for each of the four core market keys and requires at least 100 settled picks, 50 games, model improvement, Brier ≤0.245, calibration gaps ≤5 points in sufficiently populated buckets, 70 verified closes, positive CLV, and positive game-clustered ROI lower bound. Passing permits review, never betting approval.

## S. Settlement/grading status

New outcomes are `PENDING`, `VOID`, `UNABLE_TO_GRADE`, `WIN`, `LOSS`, and `PUSH`; `REVIEW` is retained only for legacy records.

- Only explicit `STATUS_FINAL` or `STATUS_FINAL_OVERTIME` with completed=true and state=post grades.
- Canceled/cancelled/abandoned void; scheduled/in-progress/halftime/delayed/postponed remain pending; unknown/inconsistent status is unable to grade.
- Full-game markets include overtime; quarter/half markets validate regulation linescores and exclude overtime.
- Props require the exact saved ESPN player ID, name, team, category, and numeric stat. A missing player row is unable to grade, never an assumed zero or loss. A genuine numeric zero row grades normally.
- Player participation is not independently archived, so sportsbook-specific inactive/zero-snap house rules are not asserted.
- Result evidence is stored before ledger mutation; rechecks and stat corrections append audit entries.

## T. Immutable archive status

Opening selections preserve exact line, price, book, quote timestamp, event/player identity, model/data/rule versions, projection, safety context, and an opening hash. Forecast attempts, settlement payloads, and later line observations are content-addressed. Replay and deterministic export are implemented.

The archive is only operationally durable if `SNAPSHOT_DIR` is durable. `render.yaml` declares `/var/data/snapshots` but no persistent disk, and there is no repository-backed NFL forward archive. Therefore restart/deploy survival is **not proven** and production durability is **incomplete**.

## U. 2026 forward-collection status

Not active as a complete protocol. The authenticated daily button discovers today's remaining games, refreshes context, and grades eligible old paper records without purchasing odds. It does not universally archive pregame model/market snapshots, it has no protected NFL forward cutoff, and it is not scheduled at 7 AM/2 PM Central.

`PROP_NOT_POSTED` is represented functionally by the board's `not_posted` state, but the forward research universe does not yet preserve the requested chain of game eligible → market available → player eligible → model available → recommendation qualified.

## V. UI status

The guarded NFL dashboard prominently states paper-only, uncalibrated, no Kelly/stake, and missing availability. It shows exact quotes, core forecast diagnostics, paper history, forward gates, replay/export, context summaries, and the readiness checklist.

Gaps: no unified six-stage data-quality display, incomplete canonical provenance display, no independent spread/total model panel, incomplete role/injury/participation presentation, and no automated forward-collection health panel.

The older **NFL Game Lines** route remains a generic market-signal scan rather than the audited independent model. During Phase 1 its output was corrected so football rows say `SIDE UNDER REVIEW`, omit grade/confidence wording, state no stake, and do not print a 0% Kelly recommendation. Ranking logic and production eligibility were unchanged.

## W. Test results

- Focused NFL/football/prop suite: **107 passed, 0 failed**.
- Full regression suite: **319 passed, 0 failed**.
- TypeScript: passed.
- Configured ESLint suite: passed.
- `git diff --check`: passed.
- Live read-only nflverse 2025 score evaluation: reproduced all 272 holdout games and the metrics in G–K.
- Live read-only ESPN fixed prop cohort: reproduced the metrics in Q.

Added coverage verifies that spread and total model/baseline/market bias are reported and that the legacy NFL output cannot present research rows as a bet, confidence grade, or Kelly stake.

## X. Production safety issues

1. **HIGH — no durable NFL forward authority.** Render disk survival is not configured/proven, and no NFL Git-backed collector exists.
2. **HIGH — no complete six-stage persisted diagnostics.** Provider success, attachment, validity, and forecast-time freshness cannot yet be audited uniformly per team/category.
3. **HIGH — no verified game-day inactive source.** Automatic core prop issuance correctly blocks, but useful coverage will remain extremely limited.
4. **HIGH — incomplete canonical game provenance.** Venue/week/season type and reschedule lineage are not fully sealed in NFL openings.
5. **HIGH — incomplete canonical player crosswalk/role history.** Rookies, trades, elevations, and new-team roles cannot be modeled safely.
6. **HIGH — no NFL scheduled collection/automatic morning grading.** The one-click workflow is manual only.
7. **HIGH — totals have no independent design or passing gate.** They must remain research-only.
8. **HIGH — prop opportunity inputs are incomplete.** Routes, red zone, role changes, teammate effects, and offensive-line context are missing.
9. **HIGH — verified closing capture is absent.** Last observed quotes are correctly not called closing lines.
10. **MEDIUM — arbitrary context completeness percentage.** It is display-only, not a decision input, but should be deprecated for transparent counts.
11. **MEDIUM — revised historical sources and missing appearances.** They can bias retrospective player diagnostics and cannot prove live feasibility.
12. **MEDIUM — sportsbook-specific prop settlement rules are unverified.** Internal paper settlement is reproducible but not claimed as book settlement.
13. **MEDIUM — forward gates are market-key based, not QB/RB/WR/TE role-family gates.**
14. **MEDIUM — no validated early-season transition model.** Current behavior mainly warns/blocks; coaching, scheme, roster, QB, and line changes are not modeled.
15. **LOW — legacy naming/configuration residue.** `PAPER_APPLICATION_RELEASE` is college-named and `BANKROLL` remains configured even though football staking is disabled.

No confirmed active CRITICAL corruption, future leakage, wrong settlement, market contamination of the independent score model, or retroactive opening mutation was found. The former misleading legacy football presentation was a HIGH safety defect and was fixed during the audit.

## Y. Prioritized defect list

| Priority | Defect | Required response |
|---|---|---|
| CRITICAL | None confirmed in active guarded NFL path | Keep tests and fail-closed checks |
| HIGH | Durable forward archive absent | Build repository-backed or verified persistent authority before claiming live-forward evidence |
| HIGH | Six-stage per-team/category diagnostics absent | Implement programmatic immutable diagnostics tied to forecast time |
| HIGH | Game-day inactives absent | Add and live-verify official adapter; preserve UNKNOWN |
| HIGH | Game/player provenance incomplete | Seal canonical registries, venue/week/type/reschedule and transaction/role lineage |
| HIGH | No scheduled NFL collector/grader | Add 7 AM/2 PM Central workflow after archive is safe |
| HIGH | Spread/total/prop evidence fails or is insufficient | Do not tune thresholds; collect and run new locked research protocols |
| HIGH | Verified close absent | Add unattended same-book close capture with an explicit definition |
| MEDIUM | Context percentage/display semantics | Deprecate percentage; show unweighted category/stage counts |
| MEDIUM | Historical player coverage bias | Build complete participation-aware samples and quantify exclusions |
| MEDIUM | Book-specific settlement context | Add rule version/evidence before claiming sportsbook-equivalent settlement |
| LOW | Names/config residue | Clean in a later compatibility-safe pass |

## Z. Recommended NFL Phase 2

**Phase 2 should be NFL Forward Integrity and Collection, in this order:**

1. Define canonical NFL game and player registries with provider IDs, venue, season, week, season type, original/latest kickoff, reschedule status, team at forecast time, position, rookie/new-team/transaction flags, and fail-closed ambiguity semantics.
2. Implement and immutably persist the six-stage `PASS/PARTIAL/FAIL/UNKNOWN` diagnostics per game, team, player, and category at the forecast timestamp. Deprecate the display percentage; do not replace it with an invented weighted score.
3. Establish durable NFL forward storage and a protected 2026 cutoff. Verify restart/deploy survival before calling any record `LIVE FORWARD`.
4. Add the 7 AM and 2 PM America/Chicago collector using the same manual/scheduled authority. Preserve actual capture time and `PROP_NOT_POSTED`; never backfill missed pregame captures.
5. Live-verify an official game-day inactive/participation source. Keep automatic prop issuance blocked when status is UNKNOWN.
6. Collect the entire eligible game/prop universe independently of whether the model likes a side. Add verified same-book close capture without overwriting openings.
7. Make ordinary grading part of the scheduled workflow and retain existing deterministic settlement/evidence/replay logic.
8. Only after sufficient clean forward evidence, preregister separate research protocols for spread, total, QB pass, QB rush, RB rush/receiving, WR receiving, and TE receiving. Add opportunity features before efficiency complexity.
9. Evaluate chronological locked tests against simple and market baselines. Calibrate each market/family separately only after adequate N. Kelly, staking, parlays, and premium labels remain disabled unless a later explicit approval phase passes.

The immediate production posture remains: **paper research only; NO RELIABLE EDGE is a valid result.**
