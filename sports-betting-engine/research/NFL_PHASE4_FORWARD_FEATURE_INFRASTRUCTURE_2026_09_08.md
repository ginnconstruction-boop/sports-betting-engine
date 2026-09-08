# NFL Phase 4 — Forward Data Enrichment and Feature Infrastructure

Date: 2026-09-08

Protocol: `nfl-forward-feature-phase4-protocol-v1`
Protected forward cutoff: `2026-09-08T02:19:07.588Z`

The phase is data-only. Collection remains `MANUAL_ONLY`, scheduled collection remains `DISABLED_BY_CONFIGURATION`, and no production formula or recommendation behavior was changed.

## A. CURRENT DATA ARCHITECTURE

The Phase 2 archive remains the append-only, content-addressed system of record. A manual collector discovers eligible games, records canonical game/team/player identities, captures football evidence and separately namespaced market quotes, and persists immutable snapshots. Phase 4 adds typed pregame feature records, change events, coverage records, critical-health records, and separately appended postgame target records. Existing pre-Phase-4 snapshots remain valid and readable.

## B. PHASE 4 CHANGES

- Added versioned, forecast-time-bound feature records with source lineage, timestamps, normalization and feature versions, raw evidence references, quality/freshness states, and point-in-time classifications.
- Added actual capture-window classification: `>24H`, `6-24H`, `1-6H`, `<1H`, and `LAST_VERIFIED_PREGAME`.
- Added explicit unavailable records instead of synthesized values.
- Added immutable QB, depth, and role change events.
- Added per-run feature scorecards, deterministic critical-feature health, cost accounting, request deduplication/cache support, and deterministic game/player row building.
- Added separate postgame target records so eventual outcomes cannot overwrite pregame evidence.

## C. DATA SOURCES

| Source | Current use | Point-in-time qualification | Known gap |
|---|---|---|---|
| ESPN public football endpoints | Schedule/game identity, roster/depth/summary context, venue, current-season team/player counts when published | Retrieval time retained; source/effective time retained when available | Some source issuance times and advanced fields are not published |
| NFL.com official weekly injury report | Practice status and official game designation | Report retrieval and report week retained | Availability varies by publication time |
| NFL.com official game-day inactives | Verified active/inactive evidence near kickoff | Only a complete, verified official list can establish status | Before publication, status correctly remains `STATUS_PENDING` |
| The Odds API | Existing spread/total/moneyline/prop market archive | Quote timestamps and market namespace preserved | Existing paid request cost; no new paid source added |
| Existing archived/static metadata | Identity, venue, schedule, prior evidence | Original provenance preserved | Cannot create missing historical point-in-time evidence |

Source success does not equal usable feature success. All six integrity stages must be reported per feature.

## D. API COST AUDIT

No new paid provider was enabled. The final zero-write dry run discovered 10 eligible games and planned:

- ESPN roster/depth/summary: maximum 50 free requests, cached/shared within the run.
- NFL.com official game-day inactives: maximum 1 free shared request.
- NFL.com official weekly injury report: maximum 1 free request per distinct eligible week.
- The Odds API core game/prop markets: maximum 10 existing requests and an estimated 100 credits for this slate.

The dry run made two free discovery requests, consumed **0 paid credits**, and wrote no archive records. Actual provider usage, cache hits, retries, failures, deferrals, and paid credits are reported separately from estimates.

## E. TEAM VOLUME COVERAGE

Current-season pass attempts, rush attempts, total plays, and recent sample size are captured when the pregame source publishes them, including raw denominators. Drives, seconds per play, neutral-situation pace, and unsupported recent-volume fields remain explicitly unavailable. Coverage is therefore expected to be partial, especially before teams have played in 2026.

## F. PASS/RUN COVERAGE

Pass attempts, rush attempts, pass rate, and rush rate are supported when point-in-time team totals exist. Numerators and denominators are retained. Early-down and neutral-situation rates are not synthesized and remain unavailable without a legitimate source.

## G. OFFENSIVE EFFICIENCY COVERAGE

No trustworthy pregame source currently supplies the full required efficiency package through this collector. Yards/play, points/drive, EPA/play, success rate, explosive-play rate, and related fields are explicitly unavailable. This category is not allowed to pass by provider-request success alone.

## H. DEFENSIVE EFFICIENCY COVERAGE

Corresponding defensive efficiency fields are explicitly unavailable for the same reason. Offensive and defensive namespaces remain separate, and neither receives a neutral placeholder value.

## I. QB COVERAGE

The pipeline records projected starter, backup, rookie status, new-team status, injury designation, inactive evidence, and changes from earlier snapshots. Depth-chart order may support `projected starter`; it does not claim `confirmed starter`. Confirmation remains unresolved until trustworthy evidence supports it. QB change events include starter changes, status upgrades/downgrades, verified inactivity, and unresolved-starter transitions.

## J. INJURY COVERAGE

Official weekly NFL injury reports and game-day inactive reports are shared across games and attached per player/team. Practice status, official game designation, source, retrieval time, and inactive state are preserved. Position groups are QB, OL, WR, TE, RB, DL, EDGE, LB, CB, and S, with no point values. Missing or not-yet-published official data remains pending/unavailable rather than inferred.

## K. DEPTH-CHART COVERAGE

Current published depth order is captured for QB/RB/WR/TE and other roster positions where the source supports it. Starter/backup and position rank are retained. Slot/outside and specialized role labels remain unknown unless directly evidenced. Depth-order changes are append-only events.

## L. SNAP COVERAGE

Available current-season offensive snaps and snap share are captured with their denominator. Snap share is never treated as route participation. Before a current-season sample exists, the record is explicitly unavailable.

## M. ROUTE COVERAGE

`ROUTE_DATA_UNAVAILABLE` is the current truthful status. No reliable free point-in-time source has been integrated for routes run, route participation, or routes per dropback. Targets are never used to synthesize routes.

## N. TARGET/CARRY COVERAGE

Targets, target share, carries, and carry share are captured when pregame-known current-season counts exist. Team pass/rush denominators and raw player numerators are retained. Role states support QB1/QB2/unresolved; RB1/RB2/RB3/committee/passing-down/goal-line/unknown; WR1/WR2/WR3/slot/outside/rotational/unknown; and TE1/TE2/rotational/blocking-heavy/unknown. Prop-line size is not used to infer roles. Red-zone and goal-line opportunity remains explicitly unavailable when unsupported.

## O. WEATHER COVERAGE

The collector can retain pre-kickoff forecast context from ESPN summaries, including source/retrieval timing and indoor/roof context where available. When the forecast issuance time is unknown, integrity is `PARTIAL`; observed final weather is never relabeled as pregame evidence. Wind, gust, precipitation, temperature, and humidity remain unavailable when not published by the source.

## P. REST/SCHEDULE COVERAGE

Days rest, short week, bye, Thursday scheduling, previous overtime, and related deterministic schedule facts are derived only from games explicitly completed before forecast time. International/neutral venue context is retained. Missing prior 2026 games produce an explicit incomplete-current-season state rather than fabricated rest history.

## Q. COACHING COVERAGE

Coach, coordinator, play-caller, and continuity fields remain explicitly unavailable because no trustworthy point-in-time source has been integrated. No coaching philosophy or adjustment is inferred.

## R. MARKET SEPARATION

Spread, total, moneyline, and prop quotes remain in the existing market archive with book, line, price, and timestamp. Football features reject market-derived evidence. Market contamination tests remain active. Existing supported prop families and collection bounds are unchanged.

## S. SIX-STAGE DIAGNOSTICS

Every feature record exposes `SOURCE_RETRIEVAL`, `NORMALIZATION`, `ENTITY_MATCHING`, `CONTEXT_ATTACHMENT`, `FIELD_VALIDITY`, and `FRESHNESS`, each as `PASS`, `PARTIAL`, `FAIL`, or `UNKNOWN`. These are programmatic archive data tied to the forecast timestamp, not UI-only labels. Critical health uses transparent category requirements and counts; it has no weighted completeness score.

## T. API DEDUPLICATION

A request deduplicator coalesces concurrent requests and shares team, injury, inactive, weather/summary, and market-supporting payloads where possible. Weekly injury reports are fetched once per distinct eligible week. Provider usage is not multiplied by downstream research families.

## U. CACHE STRATEGY

The cache supports source-appropriate expiry and explicit cache-hit reporting. Stable metadata can be reused more broadly; time-sensitive injury, inactive, depth, and weather evidence must satisfy freshness checks. Cache reuse cannot change the original source, retrieval, or forecast timestamps.

## V. FORWARD ARCHIVE INTEGRITY

Archive verification passes with the two existing snapshots unchanged and zero postgame target records. Old snapshots contain no Phase 4 features by design; retroactive feature creation would violate the protected cutoff and point-in-time rules. New snapshots add separate content-addressed components for features, events, coverage, and critical health. Corrections append a new record linked to prior evidence.

## W. DATASET ROW BUILDER

The deterministic builder currently produces 2 game-level rows and 28 player-game rows from the existing archive. Two consecutive builds produced the same hash:

`119f079bb836fba94cd82eb2489f5b2a6822359ac5fe9be669b108d8f3cdd15c`

Rows retain snapshot identity, forecast timestamp, kickoff, canonical identities, separately named market references, pregame features, and separate target slots. The existing rows correctly have empty Phase 4 feature arrays because they predate this implementation.

## X. NEXT-MODEL DATA GATES

No model fitting is authorized in Phase 4. Predeclared future gates are:

- Game models: at least 200 settled game forecasts, starting-QB coverage at least 90%, critical team-feature coverage at least 85%, market identity at least 95%, and zero leakage violations.
- Player opportunity: at least 200 settled player-game rows, meaningful QB/RB/WR/TE representation, trustworthy routes or a predeclared route-unavailable strategy, availability coverage at least 90%, identity coverage at least 98%, and zero leakage violations.
- Labels: under 50 = `EARLY COLLECTION`; 50–199 = `PRELIMINARY`; 200+ = `RESEARCH-EVALUABLE`. None proves profitability.

## Y. TEST / TYPECHECK / LINT RESULTS

- Full regression: **454/454 passed**.
- Focused Phase 4/forward integrity/official-report suite: **82/82 passed**.
- TypeScript: **PASS**.
- Lint: **PASS**.
- Archive verification: **PASS** (2 existing snapshots; 0 target records).
- Dry run: **PASS** (10 eligible, 10 `WOULD_CAPTURE`, 0 writes, 0 paid credits, 0 discovery/provider failures).
- Determinism: **PASS** (identical row counts and hash across consecutive builds).
- `git diff --check`: **PASS** (line-ending notices only; no whitespace error).

Coverage tests include six-stage diagnostics, QB/status transitions, injury classifications, depth/role changes, snaps, target/carry shares, explicit route unavailability, weather timing, rest, market separation, leakage rejection, canonical joins, immutability/corrections, request deduplication/cache behavior, manual-only policy, dry run, scorecards, deterministic rows, and target separation.

The frozen research verdicts remain unchanged:

- `NFL SPREAD MODEL B FAILS RESEARCH GATE`
- `NFL TOTAL MODEL B FAILS RESEARCH GATE`
- `PLAYER OPPORTUNITY ENGINE BLOCKED BY DATA QUALITY`

No spread, total, or prop formula; ranking; recommendation threshold; probability; calibration; Kelly; staking; parlay; or SGP logic changed.

## Z. FINAL DECISION

**NFL FORWARD FEATURE PIPELINE PARTIAL — COLLECT WITH KNOWN GAPS**

The infrastructure is ready for the user's next manual collection. The known blockers are trustworthy point-in-time routes, full offensive/defensive efficiency, red-zone/goal-line opportunity, coaching/play-caller continuity, complete advanced weather issuance metadata, and naturally sparse current-season usage before games are played. A paid live collection was intentionally not run to finish this phase.
