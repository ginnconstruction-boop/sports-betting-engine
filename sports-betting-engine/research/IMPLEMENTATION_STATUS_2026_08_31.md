# Football foundation release — implementation and remaining gates

August 31, 2026. Release marker: football-foundation-2.
Website: https://sports-betting-engine-1.onrender.com/

The owner authorized the 13-item competitor checklist in staged groups. The first
correctness gate passed (71 tests); subsequent safety/tracking work passed 83
tests. This is a partial implementation of the full roadmap, not completion of
all 13 items or approval to bet. Source availability and out-of-sample evidence
cannot be substituted with passing software tests.

## Actual status of all 13 items

| Item | Implemented | Still required |
|---|---|---|
| 1 — Spread value | Fixed posted-home-spread direction, both signs/favorites/underdogs; side-specific power bonus, then removed all unvalidated football power bonuses. | Validate any future power model before restoring influence. |
| 2 — ATS | New idempotent selected-pick view, exact event/side/line deduplication, conflicting result exclusion, current football season, true historical home-underdog filtering only with known nonneutral venue. Snapshot tracker now records source/as-of and rejects post-kickoff snapshots. | Full all-game identity/neutral-site/closing-line coverage and reviewed legacy-store migration. Selected-pick history is not complete team ATS. Legacy ats_database.json and picks remain untouched. |
| 3 — Probability | Removed legacy score-to-probability/derived edges and football Kelly stakes. Missing probability cannot be converted to zero by risk handling or promoted by labels. Price break-even math retained. | A separately calibrated football probability model; no rank-to-win shortcut. |
| 4 — Weather | Exact Unix/UTC kickoff-hour matching, unit checks, no missing-to-calm substitution, roof-state gating, gusts/precipitation, explicit source/fetch time vs unknown provider issue time. No football weather score weight. | Verified actual stadium coordinates and event roof feed, pregame forecast archive, historical weather-effect testing. Existing callers lack verified venues and now return explicit unknowns rather than city guesses. |
| 5 — Identity/availability | Exact ESPN identities retained; immutable source/forecast attempts with time-scoped team membership. New game-specific active-status gate; roster active is insufficient. | Cross-provider IDs, historical membership/transactions, dated practice/injury and verified game active feeds. No production adapter supplies the new active-status evidence yet. |
| 6 — Workload | Original attempts/targets × efficiency baseline preserved; missing richer inputs displayed. | Snap/route/target-share/red-zone/teammate/QB/line/coaching data, team-to-player opportunity allocation and incremental validation. No new untested coefficients added. |
| 7 — Opponent strength | Generic football scoring/Pythagorean proxy disabled; no substitute values invented. | Football-specific opponent-adjusted EPA, success, pressure, neutral pace/game script and validation. |
| 8 — Market baseline | Exact event/participant/period/line two-sided no-vig reference, excludes target book, rejects stale/future/asynchronous/duplicate pairs, requires 3 other books. Connected to board and forecast evidence/UI. | Benchmark/reference weighting and sportsbook-rule comparability validation. This is equal-weight conditional-no-push probability, not independent model EV. |
| 9 — Evaluation | Separate paper probability Brier/log loss, non-push calibration bins, exact-price ROI, same-game-grouped drawdown, distinct-game counts and approximate game-cluster interval. | Frozen chronological train/calibration/test cohort, paired baselines/feature ablation and sufficient unseen data. Paper metrics are descriptive, NOT completed holdout calibration. |
| 10 — Tracking | Original quote/model retained; bounded 14-day stat rechecks, source hashes and append-only grading audit; source outages do not overturn settled results. Exact-book/line final-five-minute observations plus missed counts. | Unattended final closing capture, source snapshots for settlement replay, sportsbook-specific participation/rules and remaining Tipton reviews. Explicit refresh observations are not verified final closing lines. |
| 11 — College | Separate quote board retained; no NFL coefficients transferred or new college probabilities issued. | College supplier access/license/freshness assessment, IDs/neutral venues/returning production/transfers/QB/coaching and independent model validation. |
| 12 — Specialty | Legacy TD, SGP, alternate-parlay and teaser commands/aliases blocked in API and CLI. Quotes and supported manual period-paper grading remain. | Period/tail/dependence models and sportsbook settlement validation before enabling recommendations. |
| 13 — Cleanup | Unsupported football hot/cold/H2H/inferred-money/duplicate/context bonuses removed; generic learned-weight/efficiency influence bypassed. Visible 13-item readiness checklist and disabled specialty controls. | Future feature inclusion must pass paired holdout tests; historical evidence was not deleted. |

## Model and data implications

The point forecast/stat equations are unchanged. The new version is
`nfl-workload-residual-v2-availability` because issuance now requires fresh,
exact-game/player/team official active evidence. No current production feed
supplies it. The app therefore shows diagnostics but blocks new automatic model
paper selections. Manual paper selection and grading still work. Existing saved
forecasts remain readable and unchanged. The frozen 2025 pilot is not rerun or
relabelled as the v2 policy; its original inputs/results/hashes remain intact.

Forecast evidence is content-addressed under `nfl_forecast_evidence/` on the
configured durable snapshot disk, including blocked attempts once an input
snapshot is assembled and failure records for earlier data errors. This is not
an exhaustive all-game/player cohort: only requested forecasts are archived.
Correlated/selected requests cannot establish unbiased performance.

ATS writes go only to the derived `ats_selected_v2.json`. No old ATS aggregate,
official pick, reset backup or historical pilot is reset/restored/migrated.
New fields in the paper ledger are additive; original quote/model/rules stay
unchanged. Grading is explicit, max ten games per action; rechecks rotate by
oldest check and cover settled games within 14 days.

## Data-source research and decisions still needed

- nflverse documents cross-provider GSIS/ESPN/PFR IDs: [players](https://nflreadr.nflverse.com/reference/load_players.html).
  Its code license does not automatically license every upstream NFL dataset:
  [terms](https://nflverse.nflverse.com/).
- Its current [availability schedule](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
  says the injury source ended after 2024 with no 2025 feed, and 2023-onward
  participation arrives after the postseason, not live. It is not a sufficient
  current availability/route feed for this release.
- [Snap counts](https://nflreadr.nflverse.com/reference/load_snap_counts.html)
  are a useful historical candidate. [Participation](https://nflreadr.nflverse.com/reference/load_participation.html)
  has attribution/share-alike requirements and delayed availability. Neither has
  been downloaded or connected in this release; no fabricated completeness claim.
- [Open-Meteo documentation](https://open-meteo.com/en/docs) supports explicit
  units and Unix UTC timestamps. Its standard forecast response is not proof of
  an archived forecast issue time. Commercial use needs appropriate access.
- [CollegeFootballData](https://collegefootballdata.com/) advertises a free key
  and paid tiers. No account was opened, key retrieved, subscription bought or
  college feature feed connected. Assess its applicable terms/tier before use.
- Tipton's participation is not safely inferred from a missing receiving row.
  The [official Buccaneers recap](https://www.buccaneers.com/news/bucs-lose-new-orleans-saints-week-14-score-24-20)
  confirms a kickoff return on December 7, 2025, but this alone does not verify
  offensive-snap eligibility or settle the two sportsbook receiving props.
  They remain REVIEW; frozen pilot totals were not changed.

Next decision: choose/authorize the missing NFL injury/availability and
participation source and any recurring data budget. No subscription purchase,
unbounded historical-odds run, real wager or background odds polling occurred.

## Verification

- 83 automated tests pass, including market baselines, availability gates,
  immutable evidence, statistical metrics, correction history, close-window
  boundaries, aliases, UI controls and all existing football/pilot tests.
- Build now includes server.ts via tsconfig.server.json; server and source
  type-check. Browser JavaScript syntax check passes.
- Production dependency audit: zero reported vulnerabilities.
- Isolated local server: login 200; NFL schedule 200/15 games; college schedule
  200/96 games; empty paper record/metrics 200; recheck 200; invalid forecast 400;
  anonymous recheck 401; four legacy specialty actions 403.
- Browser verified the 13-item checklist, NFL/college entry points, paused
  specialty controls, paper audit table and new stat-correction action.
- No paid odds requests were made for this release's checks so far.
- Deployment verification will be appended after publishing.
