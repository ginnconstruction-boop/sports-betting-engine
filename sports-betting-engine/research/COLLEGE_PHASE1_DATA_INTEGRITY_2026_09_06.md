# College Football Phase 1 Data-Integrity Release

Date: 2026-09-06

Scope: data integrity only. No score coefficients, calibration artifacts, market thresholds, recommendation thresholds, totals permissions, Kelly logic, or real-money permissions changed.

## Confirmed defects fixed

1. The CFBD cache treated a fresh `talent.providerChecked` marker as proof that returning production, transfers, talent, and coaching were all usable. A later scan could therefore report success even when a team had no attached category fields.
2. CFBD registry aggregation checked whether any parsed row existed across the slate. Successful attachment for one team could hide an opponent-level attachment failure.
3. ESPN `lastFiveGames` entries were counted from dates and W/L-like data without requiring an explicit final event status.
4. The context safety path used a legacy hand-weighted completeness percentage. The percentage was not historically validated.

## Status semantics

Every resolved team context now exposes a programmatic `pipelineDiagnostics` object for each context category. Every object is evaluated at and includes the forecast timestamp.

- `SOURCE_SUCCESS`: the source request itself returned successfully.
- `NORMALIZATION_SUCCESS`: at least one non-diagnostic provider field was converted into a valid normalized record.
- `ENTITY_MATCH_SUCCESS`: normalized evidence was attached to the exact canonical team, or an explicit team-match failure is reported.
- `CONTEXT_ATTACHED`: required game/team context fields are attached; partial coverage remains partial.
- `FIELD_VALID`: required fields passed validation and point-in-time resolution.
- `FRESH_AT_FORECAST_TIME`: required fields were still inside the domain freshness window at the forecast timestamp.

Each stage is `PASS`, `PARTIAL`, `FAIL`, or `UNKNOWN`. Provider transport success is intentionally separate from usable context success.

The old `completeness` number remains as `Deprecated legacy weighted display value; never used by the decision engine.` New decisions use only deterministic category counts:

- Critical: starting QB, QB availability, verified roster, current-season sample, major injuries.
- High: returning production, transfers, talent/depth, coaching.
- Medium: weather.

No category weights or context point values were added.

## ESPN current-season completion rule

A prior event counts only when all of these are true at the forecast cutoff:

- `status.type.completed === true`
- `status.type.state === "post"`
- `status.type.name` is exactly `STATUS_FINAL` or `STATUS_FINAL_OVERTIME`
- the event timestamp is before both retrieval time and the upcoming kickoff
- the event is in the current season window and is not the target event

Explicit scheduled, in-progress, halftime, delayed, postponed, and canceled statuses do not count. A W/L marker without an explicit supported final status is unverified and cannot become a sample.

## Verification

- Focused college tests: 89 passed, 0 failed.
- Full regression tests: 199 passed, 0 failed (194 prior tests plus 5 new Phase 1 regressions).
- TypeScript typecheck: passed.
- ESLint: passed.
- Frozen chronological model audit: spread RMSE 17.1491 vs baseline 19.7054; total RMSE 15.9028 vs baseline 15.7168. These are unchanged because Phase 1 did not alter Model A.
- Qualified paper selections in the safety replay remain zero; missing context still fails closed.

## Remaining source ambiguity

- ESPN may omit `status.type` inside some `lastFiveGames` objects. Those rows now remain unverified instead of being inferred as complete. A separate point-in-time schedule/final archive is needed before such rows can contribute to exact current-season samples.
- A team absent from a successful CFBD response can mean either no record exists for that category or the provider uses an unknown alias. If no target team maps from a non-empty response, the result is `TEAM_MATCH_FAILED`. If one team maps and the opponent is absent, the opponent is `SOURCE_RETURNED_EMPTY`; it is never silently treated as zero.
- CFBD coaching data supplies head-coach history but not a complete coordinator/play-caller history. That category remains partial.
- ESPN game summaries are not an authoritative complete college injury or confirmed starting-QB source. Missing fields continue to reduce confidence and create no point adjustments.
