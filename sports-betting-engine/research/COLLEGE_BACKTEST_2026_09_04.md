# College football September 4, 2026 outcome review

Reviewed September 5, 2026 (America/Chicago).

## Bottom line

Yesterday's two explicitly audited games produced **zero qualified PAPER BET or
PAPER LEAN recommendations**, so the honest official model-recommendation
record is **0–0**.

The one **WATCH / PAPER MONITOR** direction was Eastern Michigan -2.5. Eastern
Michigan lost 27–21, so the watch-only record was **0–1**. The other displayed
side, Stanford +24.5, was already blocked as **AVOID / MODEL WARNING**. Miami won
45–6, so that warning direction also lost. If both visible raw-model directions
are counted only as a hypothetical diagnostic exercise, the result was **0–2**.

No unit return is claimed because the frozen prompt retained the exact lines but
not both saved sportsbook prices. No real bets were recommended or placed.

## Exact frozen review

| Game | Pregame status | Frozen model side | Final | ATS outcome | Straight-up winner forecast |
|---|---|---:|---:|---:|---:|
| San Jose State at Eastern Michigan | WATCH / PAPER MONITOR | Eastern Michigan -2.5 | San Jose State 27–21 | Loss | Loss |
| Miami at Stanford | AVOID / MODEL WARNING | Stanford +24.5 | Miami 45–6 | Loss | Miami correct |

The score projections were Eastern Michigan 33.0–24.6 and Miami 29.9–15.5.
Absolute winning-margin error was about 14.4 points for San Jose
State–Eastern Michigan and 24.5 points for Miami–Stanford, a two-game mean of
about 19.5 points. Totals remain research-only: no total result is added to a
paper record.

## What is supported by the result

- Both games carried a pregame **MODEL/MARKET DIVERGENCE**. The line moved from
  Eastern Michigan -3.5 to -2.5 (toward San Jose State), while the raw model
  favored Eastern Michigan more strongly. Miami moved from -21.5 to -24.5,
  while the raw model pointed to Stanford against the spread. In both cases the
  market-movement direction was the correct side of the final result.
- This supports keeping the divergence warning visible and confidence low. It
  does **not** support turning two games into a new formula, an automatic
  market-following rule, or a new points adjustment.
- The Eastern Michigan miss is consistent with the need for opponent-adjusted
  current-season production: San Jose State's opening loss was to USC, while
  Eastern Michigan's opening win was over Sacramento State. A single result is
  not enough to estimate a coefficient.
- The Miami miss remains consistent with missing roster/talent/depth context.
  Those data are not reliably populated in production because
  `CFBD_API_KEY` is not configured and official injury/coordinator feeds are not
  connected.
- The September 3 evidence remains the broader warning: raw FBS/FCS directions
  were weak, and the safety gate already blocks unadjusted mismatch directions.

## Changes made after review

The model, spread thresholds, classifications, calibration and safety gates are
unchanged. Retuning them to two known results would be hindsight overfitting.

The website paper-history panel now begins with three plain, separate records:

1. **OFFICIAL MODEL PAPER RECOMMENDATIONS**
2. **WATCH-ONLY MODEL OBSERVATIONS** — not recommendations
3. **YOUR MANUAL PRACTICE PICKS** — not model recommendations

The existing detailed season/market/version buckets remain below those lines.
This is a presentation and bookkeeping improvement only; it does not rewrite a
pick, result or model output.

## Verification

- 164 automated tests passed.
- Server TypeScript build/typecheck passed.
- Lint passed.
- Production dependency audit reported zero vulnerabilities.
- The chronological replay stayed unchanged: spread RMSE 17.149 versus the
  19.705 baseline; totals RMSE 15.903 versus the 15.717 baseline; probability
  calibration remains unapproved.
- No odds request, production grading request, paper-record mutation, model
  coefficient change or safety-version change was made during this review.

## Sources and audit boundary

Final scores were checked against the
[CBS Sports September 4 schedule](https://fantasy-api.cbssports.com/college-football/schedule/).
San Jose State's 27–21 result and game statistics were also checked against
[San Jose State athletics](https://sjsuspartans.com/news/2026/09/5/spartans-rally-past-eastern-michigan)
and [Eastern Michigan athletics](https://emueagles.com/news/2026/9/4/football-eastern-drops-27-21-decision-to-visiting-san-jos-state).
Miami's opening/current line was cross-checked against
[VegasInsider's line-movement record](https://www.vegasinsider.com/college-football/matchups/miami-fl-vs-stanford/).

The exact grading uses only the two lines preserved before kickoff in the user's
September 4 diagnostic prompt. Other Friday games are not assigned retrospective
model sides when an immutable pregame selection was not recovered. A postgame
market line is not substituted for missing frozen evidence.
