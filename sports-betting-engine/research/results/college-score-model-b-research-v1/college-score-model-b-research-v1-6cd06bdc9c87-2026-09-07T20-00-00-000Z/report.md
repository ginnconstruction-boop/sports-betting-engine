# College Score Model B research — college-score-model-b-research-v1

**RESEARCH_ONLY_NOT_PRODUCTION**
Generated: 2026-09-07T20:00:00.000Z

## A. Data availability audit

- **Final scores / identities / dates / neutral site** — SAFE_HISTORICAL_SNAPSHOT; 4,574 games; 2023–2025; required fields complete in accepted parser output; ACCEPTED. Archived ESPN regular-season FINAL/FINAL_OVERTIME snapshots; forecast fits exclude same-day and future outcomes.
- **Opponent-adjusted margin and offense/defense ratings** — RECONSTRUCTED_WITHOUT_FUTURE_INFO; Derived for teams with prior/current score history at each forecast timestamp; ACCEPTED. Uses only earlier final scores, ridge shrinkage, team IDs, and venue.
- **Previous-season score strength** — RECONSTRUCTED_WITHOUT_FUTURE_INFO; 2023 prior for 2024 selection; 2024 prior for 2025 evaluation; ACCEPTED. Chronologically prior and used in an empirically selected games-played transition.
- **Conference / FBS-FCS metadata** — SAFE_HISTORICAL_SNAPSHOT; Archived ESPN schedule metadata; unknown classifications stay unknown; EVALUATION_ONLY. Used for error segmentation, not as a fitted point adjustment.
- **Roster/QB/returning production/transfers/talent/coaching/weather** — UNAVAILABLE; Historical modeling coverage 0/4,574; current evidence has 296 records for 6 teams and 3 games, all 2026; REJECTED. No dated 2023–2025 archive; backfilling now could leak later knowledge.
- **EPA, success rate, drives, yards/play, pass/rush splits, pace, travel, altitude, rest** — UNAVAILABLE; No versioned point-in-time 2023–2025 store in repository; REJECTED. Not safely reconstructable from the preserved sources.
- **Sportsbook market** — VERIFIED_POINT_IN_TIME; 318 reconstructed forecast-time observations on six 2025 dates; EXTERNAL_BENCHMARK_ONLY. Never enters Model B fit, features, or candidate selection.

## B. Features accepted / rejected

- **Prior/current final scores** — ACCEPT: Point-in-time safe and reproducible.
- **Ridge opponent adjustment** — ACCEPT: Transparent schedule-strength adjustment with shrinkage.
- **Separate offense and defense** — ACCEPT IN B2/B3: Produces matchup-aware expected scores.
- **Games-played prior transition** — ACCEPT IN B2/B3: Transition selected only on 2024.
- **Recency decay** — CANDIDATE IN B1: Compared chronologically; not assumed useful.
- **Nonlinear mismatch compression** — CANDIDATE IN B3: Triggered only by independent projection, never a spread.
- **Rich context families** — REJECT: No safe historical coverage; no invented neutral values.
- **Market variables** — REJECT FROM MODEL: External benchmark only.

## C–G. Primary chronological results

| Candidate | N | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| Model A (2025) | 1565 | 13.381 | 17.149 | -1.261 |
| B1_OPPONENT_ADJUSTED_MARGIN | 1611 | 15.709 | 20.021 | -0.889 |
| B2_PRESEASON_CURRENT_BLEND | 1611 | 16.300 | 20.675 | -0.916 |
| B3_NONLINEAR_MISMATCH | 1611 | 16.353 | 20.710 | -1.520 |
| Selected Model B (common sample) | 1565 | 15.485 | 19.691 | -1.458 |
| Model A (same common sample) | 1565 | 13.381 | 17.149 | -1.261 |
| Market only (318 reconstructed rows) | 318 | 12.426 | 15.728 | 1.951 |
| Model B (same market rows) | 318 | 15.975 | 20.607 | 2.262 |

Selected on 2024 only: **B1_OPPONENT_ADJUSTED_MARGIN:e911d017e7** with {"ridge":20,"previousSeasonWeight":1,"halfLifeDays":null}.

## H–I. Early-season and FBS/FCS

Weeks 0–2: Model A 246 | 16.640 | 21.346 | 5.955; Model B 246 | 18.962 | 24.098 | 8.158.
FBS/FCS: Model A 126 | 20.305 | 24.266 | 17.957; Model B 126 | 26.091 | 30.137 | 24.638.
No validated FBS/FCS methodology emerged. Future FBS/FCS disposition: MODEL_UNAVAILABLE rather than an arbitrary point patch.

## J. Feature ablation

| Ablation | N | MAE | RMSE | Bias | Interpretation |
|---|---:|---:|---:|---:|---|
| Selected model (reference) | 1611 | 15.709 | 20.021 | -0.889 | Locked 2025 reference. |
| Remove home-field | 1611 | 16.233 | 21.065 | 6.612 | Forces every target venue neutral; training remains chronological. |
| Remove preseason prior | 0 | N/A | N/A | N/A | Not applicable to selected B1; it uses a combined prior/current strength fit. |
| Remove opponent adjustment | 1565 | 15.300 | 19.705 | 3.219 | Model A raw for/against score-average baseline. |
| Returning production / talent / QB / matchup splits | 0 | N/A | N/A | N/A | Not ablated because these feature families were rejected as historically unavailable rather than silently imputed. |

## K. Residual / bias analysis

- week: WEEK_0_TO_2 N=246, B RMSE=24.098, B bias=8.158; WEEK_3_TO_5 N=320, B RMSE=20.151, B bias=0.944; WEEK_6_PLUS N=999, B RMSE=18.285, B bias=-4.595
- matchup: FBS/FBS N=757, B RMSE=18.169, B bias=-2.878; FBS/FCS N=126, B RMSE=30.137, B bias=24.638; FCS/FCS N=679, B RMSE=18.830, B bias=-4.827; UNKNOWN N=3, B RMSE=23.909, B bias=23.560
- venue: HOME N=1537, B RMSE=19.735, B bias=-1.529; NEUTRAL N=28, B RMSE=17.091, B bias=2.443
- projectedSide: PROJECTED_AWAY_STRONGER N=143, B RMSE=21.554, B bias=-11.931; PROJECTED_HOME_STRONGER N=1422, B RMSE=19.493, B bias=-0.405
- projectedMismatch: 0_TO_7 N=651, B RMSE=20.141, B bias=-5.784; GT_14_TO_21 N=222, B RMSE=18.614, B bias=5.640; GT_21_TO_30 N=28, B RMSE=22.529, B bias=10.826; GT_7_TO_14 N=664, B RMSE=19.465, B bias=-0.108
- conference: CONFERENCE N=1044, B RMSE=17.905, B bias=-5.370; NONCONFERENCE_OR_UNKNOWN N=521, B RMSE=22.853, B bias=6.382
- dataQuality: ADEQUATE_SCORE_HISTORY N=1565, B RMSE=19.691, B bias=-1.458

## L. Incremental information beyond market

Locked Phase-4-style diagnostic: Model B coefficient -0.1029, market coefficient 1.0282, model share 0.0910.
Locked test ensemble RMSE 14.607 versus market 14.496. Diagnostic only; not deployed.

## M. Sample limitations

- Only final-score/team/venue history is safe across 2023–2025; no play-level efficiency or roster-era covariates are available.
- The 2025 season and six-date market sample were inspected in earlier phases and are discovery evidence.
- New/low-history teams can be MODEL_UNAVAILABLE; coverage is reported rather than silently imputed.
- FBS/FCS sample size is limited and must remain a separate forward gate.
- Market snapshots are not verified closing lines.

## N. 2026 forward holdout protocol

- Archive Model A and locked Model B projections before kickoff.
- Archive every football feature/context value with as-of timestamp and provenance; reject any value after forecast time.
- Keep forecast-time market spread in a separate external benchmark object and never in Model B features.
- Write forecast.json and settlement.json immutably; corrections require a new version, never overwrite.
- Do not refit, select, or alter the locked 2026 candidate using forward results until a separately declared review boundary.
- Grade actual margin only after verified final; report RMSE, MAE, bias, coverage and market comparison before ATS/ROI.

## O. Full test results

Verification: 253/253_PASS. Typecheck: PASS. Lint: PASS. Tests: 253 passed; 0 failed.

## P. Research decision

**MODEL B FAILS RESEARCH GATE**
- PASS — minimumGames
- PASS — coverage
- FAIL — rmseGain
- FAIL — mae
- FAIL — earlyBias
- FAIL — fbsFcsBias
- FAIL — fbsFbsNotWorse
- PASS — noLeakage
- PASS — reproducible
- Model B did not beat market-only on the 318-row reconstructed benchmark.

No probability calibration, recommendation-threshold tuning, production ensemble, or deployment was performed.