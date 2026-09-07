# College market-prior ensemble research — college-market-prior-v1

**DISCOVERY_SAMPLE_NOT_PRODUCTION**
Generated: 2026-09-07T05:15:00.000Z

## Dataset / point-in-time audit

Eligible: 318/318; excluded: 0. Evidence: RECONSTRUCTED_FORECAST.
Forecast-before-kickoff: true; market-at/before-forecast: true; model-inputs-at/before-forecast: true; final margins present: true.
Independent score model: true. Score Model A accepts dated final scores, team IDs, venue, as-of time, and fixed ridge configuration; no market line or quote enters its fit or predict functions. Last-five-minute proxy used: false.

## Chronological design

Six archived dates: first 3 TRAIN; fourth VALIDATION for architecture/lambda selection; final 2 locked TEST. No shuffle.
TRAIN 174; VALIDATION 45; TEST 99.
The TEST rows are untouched by Phase 4 fitting and selection, but their outcomes were inspected in Phase 3; this is not a new external holdout.

## Primary performance

| Sample / predictor | N | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| All 318 — model only | 318 | 13.423 | 17.540 | 1.162 |
| All 318 — market only | 318 | 12.426 | 15.728 | 1.951 |
| Locked test — model only | 99 | 12.080 | 15.279 | -1.014 |
| Locked test — market only | 99 | 11.530 | 14.496 | 0.742 |
| Locked test — ensemble | 99 | 11.681 | 14.570 | -1.713 |

## Candidate selection

Selected on validation RMSE, then MAE: **RIDGE_1000**.
Locked parameters: intercept 2.203028, model coefficient 0.056022, market coefficient 0.970216, model share 0.0546.

| Candidate | Validation N | MAE | RMSE | Model coefficient | Market coefficient |
|---|---:|---:|---:|---:|---:|
| RIDGE_1000 | 45 | 11.350 | 14.010 | 0.0486 | 0.9834 |
| RIDGE_100 | 45 | 11.421 | 14.035 | -0.0109 | 1.0389 |
| RIDGE_10 | 45 | 11.429 | 14.038 | -0.0180 | 1.0453 |
| RIDGE_1 | 45 | 11.430 | 14.038 | -0.0187 | 1.0459 |
| RIDGE_0.1 | 45 | 11.430 | 14.038 | -0.0188 | 1.0460 |
| CONVEX_BLEND | 45 | 12.022 | 14.306 | 0.0000 | 1.0000 |

## All-sample matchup baselines

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| FBS vs FBS | 279 | 16.081 | 15.520 | N/A | 12.423 | 12.167 | N/A |
| FBS vs FCS | 39 | 25.665 | 17.145 | N/A | 20.580 | 14.282 | N/A |

## All-sample season-stage baselines

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| WEEK_0_TO_2 | 70 | 21.467 | 16.405 | N/A | 15.975 | 13.336 | N/A |
| WEEK_3_TO_5 | 57 | 18.331 | 16.388 | N/A | 14.451 | 12.114 | N/A |
| WEEK_6_PLUS | 191 | 15.591 | 15.267 | N/A | 12.182 | 12.186 | N/A |

## All-sample market-spread baselines

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| >14–21 | 35 | 17.904 | 16.182 | N/A | 14.041 | 12.971 | N/A |
| >21–30 | 33 | 19.328 | 15.151 | N/A | 14.394 | 11.833 | N/A |
| >3–7 | 70 | 15.723 | 15.210 | N/A | 12.193 | 11.871 | N/A |
| >30–40 | 24 | 22.528 | 18.806 | N/A | 17.736 | 15.438 | N/A |
| >40 | 15 | 20.818 | 13.297 | N/A | 15.215 | 10.967 | N/A |
| >7–14 | 83 | 17.159 | 15.899 | N/A | 13.508 | 12.410 | N/A |
| 0–3 | 58 | 15.462 | 15.318 | N/A | 11.615 | 12.259 | N/A |

## Locked-test disagreement analysis

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| >1.5–3 | 18 | 18.144 | 18.889 | 18.268 | 14.633 | 14.833 | 14.701 |
| >10 | 3 | 25.595 | 12.021 | 12.508 | 23.758 | 10.333 | 11.631 |
| >3–5 | 30 | 14.444 | 14.344 | 13.978 | 12.231 | 11.867 | 11.610 |
| >5–7 | 12 | 10.993 | 11.284 | 9.564 | 6.617 | 8.083 | 6.711 |
| >7–10 | 15 | 14.253 | 11.314 | 12.754 | 11.034 | 9.667 | 10.742 |
| 0–1.5 | 21 | 14.580 | 14.355 | 15.648 | 11.878 | 11.690 | 12.710 |

## Locked-test matchup analysis

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| FBS vs FBS | 94 | 15.139 | 14.723 | 14.790 | 12.060 | 11.734 | 11.856 |
| FBS vs FCS | 5 | 17.701 | 9.244 | 9.544 | 12.470 | 7.700 | 8.387 |

## Locked-test season-stage analysis

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| WEEK_6_PLUS | 99 | 15.279 | 14.496 | 14.570 | 12.080 | 11.530 | 11.681 |

## Locked-test market-spread analysis

| Segment | N | Model RMSE | Market RMSE | Ensemble RMSE | Model MAE | Market MAE | Ensemble MAE |
|---|---:|---:|---:|---:|---:|---:|---:|
| >14–21 | 10 | 15.411 | 15.232 | 16.202 | 13.786 | 13.450 | 14.260 |
| >21–30 | 9 | 16.147 | 12.010 | 11.736 | 12.454 | 9.500 | 9.728 |
| >3–7 | 28 | 15.958 | 15.104 | 15.073 | 12.964 | 11.464 | 11.746 |
| >30–40 | 2 | 23.198 | 18.792 | 16.772 | 16.417 | 14.250 | 12.411 |
| >40 | 5 | 8.373 | 7.117 | 9.258 | 7.148 | 6.500 | 8.210 |
| >7–14 | 27 | 14.890 | 14.255 | 14.370 | 12.221 | 12.093 | 12.021 |
| 0–3 | 18 | 14.619 | 15.547 | 15.320 | 10.248 | 11.833 | 11.494 |

## Residual analysis

Correlation(actual − model, model − market): -0.452842.
Linear residual slope on signed disagreement: -1.033044. A negative slope indicates market information systematically pulls Model A toward the result.

### Model residual groups

| Segment family | Segment | N | Bias | MAE | RMSE |
|---|---|---:|---:|---:|---:|
| Disagreement | >1.5–3 | 45 | 3.398 | 13.870 | 17.207 |
| Disagreement | >10 | 55 | 7.456 | 19.109 | 24.017 |
| Disagreement | >3–5 | 70 | -1.757 | 12.048 | 15.029 |
| Disagreement | >5–7 | 44 | 1.723 | 10.141 | 14.353 |
| Disagreement | >7–10 | 49 | -1.487 | 13.331 | 17.417 |
| Disagreement | 0–1.5 | 55 | -1.336 | 11.833 | 15.404 |
| Direction | MODEL_FAVORS_FAVORITE | 124 | -2.506 | 11.606 | 14.929 |
| Direction | MODEL_FAVORS_UNDERDOG | 191 | 3.496 | 14.745 | 19.149 |
| Direction | PICK_EM | 3 | 4.174 | 4.415 | 7.404 |
| Season stage | WEEK_0_TO_2 | 70 | 8.196 | 15.975 | 21.467 |
| Season stage | WEEK_3_TO_5 | 57 | 0.244 | 14.451 | 18.331 |
| Season stage | WEEK_6_PLUS | 191 | -1.142 | 12.182 | 15.591 |
| Matchup | FBS vs FBS | 279 | -1.279 | 12.423 | 16.081 |
| Matchup | FBS vs FCS | 39 | 18.622 | 20.580 | 25.665 |
| Home/away edge | MODEL_EDGE_AWAY | 118 | 9.258 | 14.912 | 19.704 |
| Home/away edge | MODEL_EDGE_HOME | 200 | -3.615 | 12.545 | 16.128 |

No chronological out-of-sample ensemble estimate exists for Weeks 0–2 or 3–5: those regimes occur before the validation/test windows. Their model-versus-market comparisons are reported, but an ensemble score is not fabricated.

## ATS/ROI secondary diagnostics

Model side on test: 53W–45L–1P; ROI 3.9% on 99 exact-price observations.
Ensemble side on test: 52W–46L–1P; ROI 5.3% on 74 exact-price observations; 25 opposite-side prices unavailable.

## Decision

**ENSEMBLE FAILS RESEARCH GATE**
- Locked test RMSE improvement versus best primary baseline: -0.074265 points (-0.512%).
- Locked test MAE improvement versus best primary baseline: -0.150274 points.
- Locked ensemble did not beat the best baseline on either RMSE or MAE.

## Limitations

- All rows are reconstructed discovery evidence from one season and six dates.
- The locked test was not used for Phase 4 fitting, but was previously inspected in Phase 3.
- The market prior is a contemporaneous consensus-adjacent exact book line, not a verified close.
- Subgroup results are descriptive and sparse; no multiple-comparison winner becomes a rule.
- ATS and ROI are secondary diagnostics and never select candidates.

Production behavior remains unchanged.