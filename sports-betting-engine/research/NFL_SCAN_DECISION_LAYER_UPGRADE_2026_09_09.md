# NFL Scan Output / Decision-Layer Upgrade

Generated: 2026-09-09

## A. OLD OUTPUT PROBLEM

The NFL Game Line Scan centered sportsbook dispersion, legacy scores, probability enrichment, and Kelly-oriented machinery. Daily Preflight centered provider status and diagnostic completeness. Neither consistently led with what the independent football forecast expected to happen.

## B. NEW OUTPUT ARCHITECTURE

The NFL path now has two explicit layers:

1. **Independent football forecast:** locked Phase 3A/3B model outputs only; no market input.
2. **Market-aware decision support:** direction, transparent 0–100 evidence grade, tier, best captured line/price, concise reasoning, and risks.

The grade is expressly not a win probability, calibrated probability, stake signal, or guarantee.

Files changed for this phase:

- `src/services/nflPredictiveBoard.ts` — independent forecast, grading, market comparison, combinations, archive adapters, and console output
- `src/dev/nflPredictiveBoardReport.ts` — read-only archived-board report
- `src/commands/runSportScan.ts` — NFL scan integration that bypasses the legacy probability/Kelly path
- `server.ts` — authenticated read endpoint and Daily Preflight integration
- `public/nfl-markets.js` and `public/index.html` — ranked board and plain-language display
- `src/tests/nflPredictiveBoard.test.ts` and `src/tests/nflForecastUi.test.ts` — decision-layer and UI regression coverage
- `research/NFL_PREDICTIVE_BOARD_POLICY_2026_09_09.json` — versioned grading/display policy
- `package.json` and `eslint.config.mjs` — report command and lint scope

## C. FOOTBALL FORECAST LAYER

The board reuses the locked `nfl-spread-phase3a-v1` and `nfl-total-phase3b-v1` models and the archived nflverse source through the 2025 season. It does not refit or tune either model. Both failed their research gates, and that failure is retained in the displayed version and the decision grade.

Forecasts require a resolvable NFL team identity, regular-season game, and sufficient prior team history. Missing prerequisites return `FORECAST_UNAVAILABLE`.

## D. SCORE RECONCILIATION METHOD

For independent home-margin `M` and independent total `T`:

- home points = `(T + M) / 2`
- away points = `(T - M) / 2`

Team scores are rounded to half-points. The displayed total and displayed margin are then re-derived exactly from those two displayed scores. Raw component outputs remain present for diagnostics; disagreements caused by display rounding are not hidden.

## E. 0–100 GRADE FORMULA

The deterministic component maximums total 100:

| Component | Maximum |
|---|---:|
| Model/market disagreement | 22 |
| Historical reliability | 18 |
| Data quality | 15 |
| Availability | 10 |
| Role certainty | 5 |
| Projection stability | 8 |
| Market consensus/dispersion | 8 |
| Price | 6 |
| Matchup support | 5 |
| Current-season sample | 4 |
| Timestamp-safe movement | 2 |
| Dependency integrity | 2 |

These are transparent decision-support weights, not historically calibrated probabilities. Extreme disagreement with an unpassed model is capped at 69; failed data or verified inactivity is capped at 49; data-quality-blocked research is capped at 77.

## F. GRADE TIER DEFINITIONS

- 90–100: ELITE
- 85–89: STRONG
- 78–84: PLAYABLE
- 70–77: LEAN
- 60–69: WEAK / INFORMATIONAL
- Below 60: retained internally/game detail, excluded from ranked recommendations

## G. HISTORICAL RELIABILITY ADJUSTMENT

Reliability earns 18 points only after a passed research gate. Unknown earns 9, failed earns 6, and blocked earns 4. Therefore Phase 3A spread, Phase 3B total, and Phase 3C prop limitations materially lower grades even when projection/market disagreement is large.

## H. DATA QUALITY ADJUSTMENT

PASS/PARTIAL/UNKNOWN/FAIL earn 15/9/5/0 points. `FAIL` also caps the final grade below 60. The current two snapshots predate the Phase 4 feature schema, so their quality is `UNKNOWN`; no completeness percentage is used in a decision.

## I. SPREAD GRADING

The board converts captured team spreads into a consensus home-margin expectation, compares it with the independent home-margin forecast, detects crossings of NFL key numbers 3 and 7, selects the most favorable captured line and then price, and applies the failed Phase 3A reliability treatment.

## J. MONEYLINE GRADING

Projected-winner strength and moneyline value grade are separate. Expensive prices receive less evidence credit. No calibrated win probability is inferred.

## K. TOTAL GRADING

The reconciled displayed score total is compared with consensus. Over and Under are graded independently from spread and moneyline, with the failed Phase 3B reliability treatment.

## L. TEAM TOTAL GRADING

When captured team-total markets exist, each is compared directly with the corresponding displayed home/away projected points. No team-total line is invented when absent.

## M. PROP GRADING

Existing supported projections remain visible even below 60. Direction, projection, difference, grade, availability, role, best captured price, and risk are displayed. Phase 3C's blocked status, pending availability, missing route data, and unknown point-in-time role evidence lower grades. Verified inactive players cannot generate normal Over recommendations.

## N. SGP CONSTRUCTION

Only 2- and 3-leg candidates are considered. Each leg must independently be recommendable and grade at least 70. An SGP is omitted unless its separate final grade is at least 60.

## O. SGP CORRELATION HANDLING

Logical correlations can add limited support, but do not create value by themselves. Contradictory volume/scoring theses are rejected. Shared game-script and shared model-family risk are penalized. SGP grade is not the average of leg grades.

## P. PARLAY CONSTRUCTION

Cross-game parlays use 2–3 independently eligible legs, at most one per game. Their separate grade penalizes leg count and model-family concentration. No current parlay qualified.

## Q. CROSS-MARKET CONSISTENCY

Displayed spread margin and total must equal the reconciled score. Contradictory total/game-script or dependency states are flagged and block combination support.

## R. PREDICTED GAME SCRIPT

The board describes a close/moderate/clear lead expectation and low/mid/high scoring environment from the independent reconciled score—not sportsbook movement.

## S. DAILY PREFLIGHT BOARD

Daily Preflight now renders, in order: Top 5 (60+ only), best market categories, game predictions, score, best angle, independent market grades, props, SGP, reasons, risks, then provider/research diagnostics. It reads the immutable archive and buys no odds.

## T. GAME LINE SCAN

The live NFL Game Line Scan reuses its existing game-line pull, prints the predictive board, and exits before the legacy probability/Kelly decision path. No additional provider request was added.

## U. BELOW-60 FILTER

Below-60 grades never enter Top Overall, best-category rankings, SGPs, or cross-game parlays. They remain visible inside game detail so the user can see the model's view without mistaking it for a recommendation.

## V. TRUE FAILURE STATES

`IDENTITY_UNRESOLVED`, `MARKET_UNAVAILABLE`, `PLAYER_INACTIVE`, `FORECAST_UNAVAILABLE`, `LEAKAGE_VIOLATION`, `DATA_INVALID`, and `STARTED_GAME` remain explicit. First-half and first-quarter outputs remain unavailable because no separately validated derivative model exists.

## W. API IMPACT

- Decision layer: **0 new provider calls / 0 paid credits**
- Daily Preflight board: **0 odds calls**
- Live Game Line Scan: reuses its existing game-line request; no incremental request
- No scheduled or background collection added

## X. TESTS / REGRESSION

- Focused predictive/UI/daily suite: **43/43 passed**
- Full regression: **503/503 passed**
- TypeScript: **PASS**
- Lint: **PASS**
- Archive verification: **PASS** — 2 snapshots, 0 settlement records

Added coverage for score reconciliation, margin/total consistency, independent market grades, grade-not-probability semantics, threshold tiers, research/data/availability penalties, extreme disagreement, key numbers, price, props, team totals, SGP/parlay construction, negative correlation, cross-market consistency, game scripts, true failure states, started games, and manual-only/zero-paid-call preservation.

## CURRENT CAPTURED-DATA VALIDATION

Two protected snapshots were read without mutation:

| Matchup | Predicted score | Margin | Total | Best model view | Grade |
|---|---|---:|---:|---|---:|
| New England @ Seattle | Seattle 25.5–23.5 | Seattle +2.0 | 49.0 | Hunter Henry Over 33.5 receiving yards | 54 |
| San Francisco @ Los Angeles Rams | Rams 26.5–23.0 | Rams +3.5 | 49.5 | Rams moneyline | 40 |

Six existing prop projections were displayed. Twelve total opportunities were graded; all were below 60. No SGP or parlay was manufactured. Captured September 8 prices were stale at validation time, availability/role evidence was incomplete, and the underlying research gates had not passed. Predicted scores remained prominent despite zero recommendations.

## Y. PRODUCTION SAFETY / COLLECTION MODE

- Collection remains `MANUAL_ONLY`
- Scheduled collection remains `DISABLED_BY_CONFIGURATION`
- Protected cutoff remains `2026-09-08T02:19:07.588Z`
- Immutable evidence was not rewritten
- No model was fitted, tuned, or promoted
- No calibrated probability, Kelly, staking, real-money execution, large parlay, or synthetic derivative/alternate line was introduced
- Existing paper settlement/storage semantics are unchanged

## Z. FINAL DECISION

**NFL PREDICTIVE BOARD READY WITH KNOWN RESEARCH LIMITATIONS**

The output is materially more useful, but the low current grades are intentional. Stronger recommendation tiers require fresh market evidence, verified availability/role context, more forward snapshots, and research results that improve on the market.
