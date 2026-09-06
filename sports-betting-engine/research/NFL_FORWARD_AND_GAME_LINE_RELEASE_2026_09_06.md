# NFL forward evidence and full-game research — September 6, 2026

## Outcome

The website now reports a separate frozen forward-evidence gate for passing
yards, rushing yards, receiving yards and receptions. It also captures a unique
same-book, same-player, same-side line move near kickoff. Those observations are
still labeled as observations, not verified final closing lines.

No real-money betting or Kelly staking is enabled.

## Frozen prop gate

Each core prop must independently reach all of these conditions before it may
receive a separate calibration/model review:

- 100 settled forward paper picks across at least 50 distinct games;
- forward model MAE at least 5% lower than its stored simple-average baseline;
- non-push binary Brier score no higher than 0.245;
- no calibration-bucket gap above five percentage points, using only buckets
  with at least 20 observations;
- at least 70 verified closing observations;
- mean verified line CLV above zero and more than 50% positive line CLV;
- the lower bound of the game-clustered 95% ROI interval above zero.

These thresholds were declared before 2026 results were available in the paper
ledger. Passing them is not betting approval. It only permits a new review.

## Full-game spread research

Source: nflverse schedules, CC-BY-4.0. Sportsbook API credits used: zero.

Nine ridge/half-life configurations were declared. Configuration selection used
only the chronological 2024 evaluation. The lowest 2024 margin RMSE selected
ridge 3 and a 180-day half-life. That configuration was then evaluated once on
the untouched 2025 season.

2025 holdout (272 regular-season games):

| Measure | Research model | Simple scoring baseline | Closing market |
|---|---:|---:|---:|
| Margin MAE | 10.32 | 10.61 | 9.72 |
| Margin RMSE | 13.01 | 13.43 | 12.27 |

At the predeclared two-point model/market disagreement rule, the descriptive
ATS result was **55 wins, 72 losses and 1 push**. This used closing lines as an
evaluation benchmark, not archived actionable prices.

Decision: the score model improved on the simple baseline but did not beat the
market and performed poorly ATS. It remains research-only and is not connected
to recommendations, probability estimates or the paper-pick issuer.

## Remaining evidence blockers

- Live-format verification of the official game-day inactive source.
- Actual 2026 forward samples for all four core props.
- Verified, unattended closing observations; late manual observations do not
  satisfy that gate.
- Routes, red-zone opportunity and teammate interaction data.
- A new full-game model specification that survives a fresh chronological
  holdout; the failed model must not be rescued by tuning on 2025.
- Separate validation for totals, touchdowns, combined/longest props, quarters
  and halves.
