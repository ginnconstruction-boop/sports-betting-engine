# College football historical edge research — college-edge-research-v1

**DISCOVERY_SAMPLE_NOT_ACTIVATION_EVIDENCE**
Generated: 2026-09-07T04:35:00.000Z
Application version: 2.1.0

Evidence classes are not pooled. All percentages and units are descriptive historical outputs, not activation thresholds or betting advice.

## Dataset audit

| Evidence class | Rows | ATS eligible | Margin-error eligible | Model version(s) | Source label(s) |
|---|---:|---:|---:|---|---|
| ARCHIVED_LIVE_FORECAST | 0 | 0 | 0 | N/A | N/A |
| RECONSTRUCTED_FORECAST | 318 | 318 | 318 | college-score-ridge-v1 | six-date-2025-all-model-sides-consensus-adjacent-exact-quote |
| SYNTHETIC_DERIVED_RESEARCH | 1565 | 0 | 1565 | college-score-ridge-v1 | chronological-2025-score-replay |

Only exact archived prices contribute to units/ROI. Context, consensus/closing data, and movement remain unavailable when no timestamped record exists.

## RECONSTRUCTED_FORECAST

Inputs: 318; ATS eligible: 318; margin-error eligible: 318; exact duplicates excluded: 0.
Overall: 162W–151L–5P across 318 observations / 318 distinct games; ATS 51.8%.
Price-based units: -2.584289 on 318 exact-price observations; ROI -0.8%. No default price was assumed.
95% Wilson interval: 46.2%–57.2%; sample warning: LARGER_SAMPLE.

| Absolute edge bucket | N | W-L-P | ATS | Avg price | Units | ROI | 95% CI | Warning |
|---|---:|---:|---:|---:|---:|---:|---|---|
| 0–1.5 | 55 | 18-36-1 | 33.3% | -109.945455 | -19.549402 | -35.5% | 22.2%–46.6% | RESEARCH_SAMPLE |
| >1.5–3 | 45 | 24-19-2 | 55.8% | -105.266667 | 3.198485 | 7.1% | 41.1%–69.6% | RESEARCH_SAMPLE |
| >3–5 | 70 | 35-33-2 | 51.5% | -103.728571 | -0.931749 | -1.3% | 39.8%–62.9% | RESEARCH_SAMPLE |
| >5–7 | 44 | 31-13-0 | 70.5% | -105.204545 | 15.31308 | 34.8% | 55.8%–81.8% | RESEARCH_SAMPLE |
| >7–10 | 49 | 28-21-0 | 57.1% | -109.510204 | 4.664285 | 9.5% | 43.3%–70.0% | RESEARCH_SAMPLE |
| >10 | 55 | 26-29-0 | 47.3% | -109.836364 | -5.278988 | -9.6% | 34.7%–60.2% | RESEARCH_SAMPLE |

Monotonicity diagnostic: NOT_MONOTONIC. This is descriptive and not a threshold recommendation.

### Model projected margin error by edge bucket

| Absolute edge bucket | N | Bias | MAE | RMSE |
|---|---:|---:|---:|---:|
| 0–1.5 | 55 | -1.335799 | 11.832809 | 15.403754 |
| >1.5–3 | 45 | 3.398334 | 13.869569 | 17.206619 |
| >3–5 | 70 | -1.757246 | 12.048089 | 15.02892 |
| >5–7 | 44 | 1.722737 | 10.140629 | 14.353364 |
| >7–10 | 49 | -1.487416 | 13.330679 | 17.416988 |
| >10 | 55 | 7.456422 | 19.108704 | 24.017025 |

### Direction

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| MODEL_FAVORS_FAVORITE | 124 | 66-57-1 | 53.7% | 3.37525 | 2.7% | LARGER_SAMPLE |
| MODEL_FAVORS_UNDERDOG | 191 | 93-94-4 | 49.7% | -8.721117 | -4.6% | LARGER_SAMPLE |
| NO_MARKET_FAVORITE | 3 | 3-0-0 | 100.0% | 2.761578 | 92.1% | INSUFFICIENT_SAMPLE |

### Favorite comparison

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| MODEL_FLIPS_MARKET_FAVORITE | 37 | 22-15-0 | 59.5% | 5.047661 | 13.6% | RESEARCH_SAMPLE |
| MODEL_MAKES_FAVORITE_STRONGER | 124 | 66-57-1 | 53.7% | 3.37525 | 2.7% | LARGER_SAMPLE |
| MODEL_MAKES_FAVORITE_WEAKER | 154 | 71-79-4 | 47.3% | -13.768778 | -8.9% | LARGER_SAMPLE |
| PICK_EM | 3 | 3-0-0 | 100.0% | 2.761578 | 92.1% | INSUFFICIENT_SAMPLE |

### Market spread

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| >14–21 | 35 | 17-17-1 | 50.0% | -1.590391 | -4.5% | RESEARCH_SAMPLE |
| >21–30 | 33 | 14-18-1 | 43.8% | -5.239057 | -15.9% | RESEARCH_SAMPLE |
| >3–7 | 70 | 38-30-2 | 55.9% | 4.763644 | 6.8% | RESEARCH_SAMPLE |
| >30–40 | 24 | 10-14-0 | 41.7% | -4.893333 | -20.4% | LOW_SAMPLE |
| >40 | 15 | 9-6-0 | 60.0% | 2.345994 | 15.6% | LOW_SAMPLE |
| >7–14 | 83 | 41-42-0 | 49.4% | -4.137469 | -5.0% | RESEARCH_SAMPLE |
| 0–3 | 58 | 33-24-1 | 57.9% | 6.166323 | 10.6% | RESEARCH_SAMPLE |

### Week regime

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| WEEK_0_TO_2 | 70 | 33-35-2 | 48.5% | -4.761235 | -6.8% | RESEARCH_SAMPLE |
| WEEK_3_TO_5 | 57 | 25-32-0 | 43.9% | -9.304029 | -16.3% | RESEARCH_SAMPLE |
| WEEK_6_PLUS | 191 | 104-84-3 | 55.3% | 11.480975 | 6.0% | LARGER_SAMPLE |

### Matchup class

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| FBS vs FBS | 279 | 148-126-5 | 54.0% | 9.649767 | 3.5% | LARGER_SAMPLE |
| FBS vs FCS | 39 | 14-25-0 | 35.9% | -12.234056 | -31.4% | RESEARCH_SAMPLE |

### Context completeness

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| UNKNOWN | 318 | 162-151-5 | 51.8% | -2.584289 | -0.8% | LARGER_SAMPLE |

### Line movement

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|
| MOVEMENT_UNKNOWN | 318 | 162-151-5 | 51.8% | -2.584289 | -0.8% | LARGER_SAMPLE |

### Baselines

- All eligible model sides: 51.8% ATS.
- Random directional reference: 50.0%.
- Market/no-edge directional reference: 50.0%; Symmetric direction reference only; no selectable price or ROI is inferred.

### Hypotheses worth testing later

- Preregister an untouched forward comparison of the >5–7 disagreement bucket; its discovery ATS rate was 70.5% across 44 non-push results.

### Results that argue against the model

- Larger model-market disagreement did not improve ATS results monotonically.
- The all-model-sides ATS rate was below the average archived-price break-even rate.

## SYNTHETIC_DERIVED_RESEARCH

Inputs: 1565; ATS eligible: 0; margin-error eligible: 1565; exact duplicates excluded: 0.
Overall: 0W–0L–0P across 0 observations / 0 distinct games; ATS N/A.
Price-based units: N/A on 0 exact-price observations; ROI N/A. No default price was assumed.
95% Wilson interval: N/A; sample warning: INSUFFICIENT_SAMPLE.

| Absolute edge bucket | N | W-L-P | ATS | Avg price | Units | ROI | 95% CI | Warning |
|---|---:|---:|---:|---:|---:|---:|---|---|
| 0–1.5 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |
| >1.5–3 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |
| >3–5 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |
| >5–7 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |
| >7–10 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |
| >10 | 0 | 0-0-0 | N/A | N/A | N/A | N/A | N/A | INSUFFICIENT_SAMPLE |

Monotonicity diagnostic: INSUFFICIENT. This is descriptive and not a threshold recommendation.

### Model projected margin error by edge bucket

| Absolute edge bucket | N | Bias | MAE | RMSE |
|---|---:|---:|---:|---:|
| 0–1.5 | 0 | N/A | N/A | N/A |
| >1.5–3 | 0 | N/A | N/A | N/A |
| >3–5 | 0 | N/A | N/A | N/A |
| >5–7 | 0 | N/A | N/A | N/A |
| >7–10 | 0 | N/A | N/A | N/A |
| >10 | 0 | N/A | N/A | N/A |

### Direction

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Favorite comparison

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Market spread

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Week regime

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Matchup class

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Context completeness

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Line movement

| Segment | N | W-L-P | ATS | Units | ROI | Warning |
|---|---:|---:|---:|---:|---:|---|

### Baselines

- All eligible model sides: N/A ATS.
- Random directional reference: 50.0%.
- Market/no-edge directional reference: 50.0%; Symmetric direction reference only; no selectable price or ROI is inferred.

### Hypotheses worth testing later

- None supported by a minimally sized discovery segment.

### Results that argue against the model

- No additional result beyond the displayed uncertainty and limitations.

## Limitations

- This is exploratory historical research, not validation or activation evidence.
- Historical selection effects and repeated games across model versions can create dependence.
- Context and line-movement segments are unavailable unless timestamped fields were archived.
- No price, closing line, context field, or result is imputed.

- Many exploratory subgroup comparisons are reported without multiplicity correction. Apparent winners require preregistered untouched forward confirmation.

No live score weights, recommendation gates, probability calibration, Kelly logic, totals status, or UI behavior were changed.
