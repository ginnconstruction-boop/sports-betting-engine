# College current-context ingestion repair — September 5, 2026

## Outcome

The current-football-context pipeline now completes the real source-backed
`SOURCE -> FETCH -> PARSE -> NORMALIZE -> TEAM MATCH -> VALIDATE TIMESTAMP ->
STORE -> LOAD -> CONTEXT AGGREGATION` path. The September 5 source audit stored
6,802 normalized records for 136 teams with zero rejected records. A separate
production-like scan matched all 68 provider games to all 68 independent
schedule games and produced 66 pregame projections without creating paper
picks.

This release does **not** change the score model, probability model, selection
thresholds, safety classifications, totals gate, Kelly logic or staking. Context
point adjustments remain unavailable because their coefficients have not been
validated.

## 1–9. Root cause and architecture findings

1. Exact root cause: `CollegeContextIngestion.refresh()` successfully fetched
   and parsed ESPN event summaries and rosters, but
   `appendCollegeContextRecords()` in `collegeContextEvidence.ts` rejected the
   slate with `Expected at most 5000 context records`. The September 5 slate
   produced more than 5,000 legitimate normalized field records.
2. The upstream caller was `CollegePredictions.scan()`. Its catch used to hide
   the specific exception, attempted an empty/cached store, and therefore made
   nearly every field resolve as `NO_SOURCE_ATTEMPTED` even though network calls
   had occurred.
3. The failure aborted context aggregation for the whole slate. It did not abort
   the separate schedule, odds or raw score-model path.
4. Existing adapters before this repair: ESPN game summaries, ESPN team rosters,
   optional CollegeFootballData imports, and the internal schedule/team identity
   layer. ESPN summary and roster adapters were being called. CFBD was not called
   because `CFBD_API_KEY` is absent.
5. Network access was enabled and working. This was application logic, not a
   Render networking restriction. The local production-like scan also verified
   the Odds API credential and left 19,842 credits after one 2-credit bulk call.
6. The append-only store was not a database transaction problem; it was an
   overly small validation ceiling. The ceiling is now 50,000 and every incoming
   record is validated independently. A store failure is reported as
   `STORE_FAILED`, while valid retrieved records remain available in memory for
   the current scan.
7. Parsing issue found: the old coaching path did not use the head-coach record
   available in the ESPN roster response. Head coach parsing now uses that
   response. Missing coordinator and play-caller fields remain explicitly
   unavailable rather than invented.
8. Team identity was not the cause of this failure. Context records use canonical
   ESPN team IDs plus season and event ID. The live audit matched 68/68 games.
   Unresolved mappings still report `TEAM_MATCH_FAILED` and are never guessed.
9. Verified internal FBS/FCS classification is now normalized into the same
   context store instead of being redundantly fetched or mislabeled as not
   attempted.

## Source registry and precise status behavior

The persistent source registry records source name/type/tier, enablement,
configuration, credential requirements/presence, refresh interval, last attempt,
last success, last failure, reason and result for every category.

| Category | Source | September 5 result |
|---|---|---|
| QB | ESPN game summary | `PARTIAL_SUCCESS` — 34/66 event targets |
| Current season | ESPN game summary | `PARTIAL_SUCCESS` — 38/66 event targets |
| Injuries | ESPN game summary | `SOURCE_RETURNED_EMPTY` |
| Weather | ESPN game summary | `PARTIAL_SUCCESS` |
| Roster | ESPN current-season roster | `SUCCESS` — 132/132 teams |
| Coaching | ESPN current-season roster | `PARTIAL_SUCCESS` — 131/132 teams |
| Classification | Verified internal schedule identity | `SUCCESS` — 132/132 teams |
| Transfers | CollegeFootballData | `NO_PROVIDER_CONFIGURED` |
| Returning production | CollegeFootballData | `NO_PROVIDER_CONFIGURED` |
| Talent/depth | CollegeFootballData | `NO_PROVIDER_CONFIGURED` |

`NO_SOURCE_ATTEMPTED` now means no configured adapter was actually invoked.
Once a request occurs, missing values resolve to a more precise result such as
`SOURCE_RETURNED_EMPTY`, `SOURCE_FIELD_UNAVAILABLE`, `SOURCE_HTTP_ERROR`,
`SOURCE_RATE_LIMITED`, `SOURCE_AUTH_FAILED`, `PARSER_FAILED`,
`TEAM_MATCH_FAILED`, `VALIDATION_FAILED`, `STALE_SOURCE`,
`CONFLICTING_SOURCES`, `STORE_FAILED` or `LOAD_FAILED`.

Requests have a 20-second timeout, at most one retry with bounded backoff,
authentication/rate-limit classification, concurrency capped at eight, event and
team deduplication, and cache reuse (15 minutes for event summaries; seven days
for roster/coaching data). Provider and team failures are isolated.

## 10–19. Coverage and completeness

The full 136-team source audit produced the following actual coverage:

- Current-season game count/status was populated for 43 teams; detailed offense
  was available for 41 and detailed defense for 7. Teams that had not completed
  a 2026 game before the forecast timestamp correctly remain at zero/no prior
  game.
- Expected primary QB was populated for 38 teams. ESPN evidence is labeled
  `EXPECTED`, never upgraded to `CONFIRMED`.
- Current roster presence was populated for 136/136 teams.
- Head coach was populated for 135/136 teams. Coordinator change and play-caller
  continuity remain unavailable.
- Temperature, gust, precipitation probability and indoor/outdoor status were
  populated or partially populated for the slate. ESPN did not return sustained
  wind for these events, so it is `SOURCE_FIELD_UNAVAILABLE`; it is not inferred
  from gusts.
- FBS/FCS classification was populated for 136/136 teams from verified internal
  identity data.
- Team injury listings were unavailable for 136/136 teams because the configured
  source returned no team injury data.
- Transfers, returning production and numeric talent/depth metrics were
  unavailable for 136/136 teams because CFBD is not configured. Classification
  alone does not fabricate a talent composite or FCS quality tier.

Delivered context before the repair was 0% average / 0% median for the failed
September 5 scan: the >5,000-record exception caused all successfully retrieved
records to be discarded before aggregation. After the repair:

| Metric | Result |
|---|---:|
| Teams | 136 |
| Average completeness | 19.24% |
| Median completeness | 13.40% |
| Minimum | 12.60% |
| Maximum | 35.10% |
| 0–19% | 99 |
| 20–39% | 37 |
| 40–59% | 0 |
| 60–79% | 0 |
| 80%+ | 0 |

The 80% gate was not lowered. Increased completeness did not promote any game.

## 20. Representative before/after audit

For every team below, **before** was 0% with the slate-level refresh/store error.
After statuses use only data available before the prediction timestamp.

| Game/team | After context | Completeness / reliability |
|---|---|---:|
| Ohio @ Nebraska (both) | QB unknown; no prior 2026 game; roster and head coach available; weather partial; FBS known; injuries/transfers/returning production/talent metrics unavailable | 13.4% / MEDIUM each |
| Coastal Carolina @ West Virginia (both) | QB unknown; no prior 2026 game; roster and head coach available; weather partial; FBS known; remaining advanced categories unavailable | 13.4% / MEDIUM each |
| Oregon State @ Houston (both) | QB unknown; no prior 2026 game; roster and head coach available; weather partial; FBS known; remaining advanced categories unavailable | 13.4% / MEDIUM each |
| Arkansas State | QB unknown; no prior 2026 game; roster/head coach/weather/classification available or partial | 13.4% / MEDIUM |
| Memphis | One completed game and basic current-season production available; QB still unknown; roster/head coach/weather/FBS available or partial | 14.7% / MEDIUM |
| Clemson @ LSU (both) | QB unknown; no prior 2026 game; roster and head coach available; weather partial; FBS known; remaining advanced categories unavailable | 13.4% / MEDIUM each |
| UNLV | Jackson Arnold `EXPECTED`; one completed game and current production available; roster/head coach/weather/FBS available or partial | 35.1% / MEDIUM |
| Hawaii | Micah Alejado `EXPECTED`; one completed game and current production available; roster/head coach/weather/FBS available or partial | 35.1% / MEDIUM |
| Bryant | Brennan Myer `EXPECTED`; one completed game and current production available; roster/head coach/weather; FCS known | 34.7% / MEDIUM |
| Army | QB unknown; no prior 2026 game; roster/head coach/weather; FBS known | 13.4% / MEDIUM |

Fresh-line safety examples from the separate production-like scan:

| Game | Model home margin | Market home line | Disagreement | Final safety label |
|---|---:|---:|---:|---|
| Ohio @ Nebraska | Nebraska 10.89 | Nebraska -24 | 13.11 | `MODEL WARNING` |
| Coastal Carolina @ West Virginia | West Virginia 14.42 | West Virginia -21 | 6.58 | `PAPER MONITOR` |
| Oregon State @ Houston | Houston 21.33 | Houston -21 | 0.33 | `PAPER PASS` |
| Arkansas State @ Memphis | Memphis 19.85 | Memphis -11 | 8.85 | `PAPER MONITOR` |
| Clemson @ LSU | LSU 6.84 | LSU -10 | 3.16 | `PAPER MONITOR` |
| UNLV @ Hawaii | Hawaii 1.47 | Hawaii +3 | 4.47 | `PAPER MONITOR` |
| Bryant @ Army (FCS/FBS) | Army 16.83 | Army -37 | 20.17 | `MODEL WARNING` |

There were 39 extreme-disagreement games and all 39 remained `MODEL WARNING`.
The regression diagnostic found 23 huge FCS underdogs favored by the raw model;
none became a recommendation. The production-like audit used `trackPaper=false`,
so it wrote zero picks and has no win/loss record to claim.

## 21. Verification

- College tests: 81 passed, 0 failed.
- Full suite: 170 passed, 0 failed.
- ESLint: passed.
- Server TypeScript build: passed.
- September 5 context source audit: 6,802 records stored, zero rejected.
- Production-like schedule/odds/model audit: 68 provider games, 68 independent
  games, 66 upcoming projections, one 2-credit bulk odds call, zero paper picks.
- Frozen chronological model evaluation: unchanged spread RMSE 17.1491 vs
  baseline 19.7054; unchanged totals RMSE 15.9028 vs baseline 15.7168. Totals
  remain disabled. The old reconstructed raw ATS result remains 113–93, but the
  stricter qualified v2 paper sample remains 0 and is not a profitability claim.

Tests explicitly cover configured invocation, attempt/success timestamps,
successful storage/load, parser/auth/rate-limit/HTTP/store/load failures,
category and team isolation, stale and future rejection, static cache reuse,
completed-game recognition, FBS/FCS reuse, canonical aliases, team-match failure,
empty-source status, and the 5,001-record regression that caused this incident.

## 22–23. Remaining limitations and recommended next step

The ingestion plumbing is now working, but verified coverage is still too thin
for qualified recommendations. The largest gaps are injuries, returning
production, transfer impact, talent/depth, coordinator continuity and confirmed
starting QBs. ESPN supplies only partial weather and current-season fields.

Recommended next development step: connect and validate one lawful structured
provider for transfers, returning production and talent (the existing CFBD
adapter is ready but unconfigured), then add an official/reputable injury and QB
verification adapter. Collect the resulting context prospectively without point
adjustments. Only after enough forward outcomes exist should individual context
features be evaluated chronologically and coefficients considered.

Until then, `NO RELIABLE EDGE` is the correct result for incomplete or extreme
cases.
