# NFL workload forecast v1 — experimental paper release

Specification and first audit: August 30, 2026. Version: `nfl-workload-residual-v1`.

## What is available

Passing yards, rushing yards, receiving yards and receptions have a dedicated NFL workload forecast. **Forecast + track** evaluates both sides of the selected player/market using already-loaded quotes at configured accessible books (currently FanDuel and BetMGM). No additional Odds API request is made by forecasting. A qualifying selection is saved atomically before it is displayed. This is experimental paper testing, not a validated edge or a wager.

At most one model selection is issued per game/player/market/version, across sides, lines and books. Repeating the action returns the original selection. **View original forecast** in the paper record reopens the saved evidence without requiring new odds. Manual **Save paper** selections remain separately labeled and reported.

## Fixed specification

- Inputs: named ESPN NFL regular-season stats, current uniquely matched team/player identity, recorded attempts or targets, roster injury flags and provisional depth-chart order.
- Training uses only same-team numeric games strictly before the request/kickoff cutoff, within 732 days. Missing data is excluded, never filled with zero. Game rows without attempts/targets cannot train the model.
- Point estimate = forecast opportunities × forecast production per opportunity. Opportunities = 60% last-five average + 40% last-twenty average. Efficiency = 40% last-five pooled rate + 60% last-twenty pooled rate. Receptions use catches per target. The trailing twenty-game mean of the stat is the comparison baseline.
- At least eight training games and eight rolling forecast errors are required. The last usable game must be within 400 days. Recent/longer-term workload ratio outside 0.65–1.35 blocks issuance.
- Each historical target is forecast with strictly earlier games, up to twenty. The workload model must have lower mean absolute error than the baseline over that player's eligible rolling diagnostic. This gate is not independent validation of the selected recommendations.
- Experimental probabilities use up to twenty recent rolling errors added to the current projection, rounded to integer outcomes, with one pseudocount for each possible outcome. Half lines cannot push. This residual adjustment can shift the distribution away from the raw point estimate. Probabilities are **uncalibrated**.
- Paper issuance requires estimated non-push win probability at least 55% and estimated profit at least 0.05 units per one unit risk. Expected profit includes push probability and the exact American price. Among eligible loaded quotes, select the highest estimated profit. These fixed research thresholds are not evidence of profitability.
- Block issuance for any roster injury flag, non-active/unknown roster status, stale roster, missing/stale depth timestamp or no first-listed depth-chart role. A clean feed is not confirmation of game-day availability. Quotes need verified timestamps within fifteen minutes and a still-valid five-minute board selection; inputs must remain within five minutes. Recheck expiry and kickoff after data/event verification.

## Historical diagnostic — all initial cohort results

Read-only audit uses 2024 for warmup and chronological 2025 targets. Fixed illustrative cohort: Drake Maye and Patrick Mahomes for passing/rushing; Travis Kelce and Jaxon Smith-Njigba for receiving/receptions. No cohort member with missing data is silently replaced. Parameters were not tuned against these results, but this small illustrative cohort is not a pre-registered or independent league-wide validation set.

| Player | Market | Target forecasts | Workload MAE | Average baseline MAE | Finding |
|---|---|---:|---:|---:|---|
| Drake Maye | Passing yards | 17 | 57.92 | 63.63 | Lower error |
| Patrick Mahomes | Passing yards | 14 | 41.77 | 41.49 | Baseline better |
| Drake Maye | Rushing yards | 17 | 15.25 | 14.76 | Baseline better |
| Patrick Mahomes | Rushing yards | 14 | 20.60 | 19.79 | Baseline better |
| Travis Kelce | Receiving yards | 0 | — | — | Insufficient source data |
| Travis Kelce | Receptions | 0 | — | — | Insufficient source data |
| Jaxon Smith-Njigba | Receiving yards | 17 | 30.99 | 33.48 | Lower error |
| Jaxon Smith-Njigba | Receptions | 17 | 1.78 | 1.85 | Lower error |

Three of six evaluable player/market pairs improved; three did not; two lacked usable source data. The 96 stat forecasts are correlated across players/markets/games: **they are not 96 independent games or bets, and there is no historical betting win rate or ROI here**. MAE units differ by market and must not be pooled into one score. This 2025-only audit differs from the live card's rolling diagnostic across all eligible source years.

Run `node --require ts-node/register/transpile-only src/dev/nflForecastAudit.ts --out snapshots/nfl_forecast_audit.json` to regenerate the ignored local artifact with source URLs, source observations and every target forecast. Public feeds may change or later correct stats, so reruns can differ. The live paper ledger locks the observations and forecast actually used at issuance.

Rolling-origin evaluation follows the earlier-observations-only principle described in [Forecasting: Principles and Practice — time series cross-validation](https://otexts.com/fpp3/tscv.html). Our historical feeds are revised public game logs, not archived point-in-time snapshots. The audit does not replay historical roster/injury/depth gates, historical odds, quote availability, selection thresholds, costs, or sportsbook rules. It therefore evaluates stat prediction only, not the complete recommendation policy.

## Tracking and grading

The existing persistent `nfl_paper_picks.json` stores original quote, exact event/player IDs, input/source timestamps, full source observations, forecast version/fingerprint, rolling errors, probability estimates, selection rationale and fixed research rules. A failed write means no issued recommendation. The official `picks_log.json` is separate.

After games finish and at least four hours pass from kickoff, **Grade completed paper picks** checks up to ten games per click. Outcomes are W/L/push, pending or review; missing data never becomes an assumed loss. Reports separate model/manual origin, exact market, season and version, using fixed one-unit risk. Pushes do not count in win percentage but do count as settled stakes for ROI. Grading is on demand, not an unattended scheduled service. Paper settlement may differ from the sportsbook.

## Readiness limits and next validation

Missing source rows can omit zero-opportunity appearances and bias the sample. Participation completeness, snap exposure, opponent strength, weather, role transitions, game-day inactives and dependable injury feeds remain unresolved. Early-season forecasts rely heavily on prior seasons. Depth timestamps can describe a feed refresh rather than confirmed team decisions. Residuals are small, dependent samples; selecting the highest estimated EV creates selection bias. No probability calibration or independent odds-aware holdout has passed.

Next: collect a prospective paper sample without rewriting issued picks; establish participation completeness; add and independently test role/opponent inputs; capture verified closing quotes; measure calibration and odds-aware results on separate holdouts; then consider deliberate promotion. College models and remaining NFL specialty markets require separate validation. No automatic BET-label unlock is added.

Software QA: 47 automated tests passed, including formula/baseline, future-data isolation, all four markets, safety gates, persistence-before-issuance, duplicate/concurrent saves, expired inputs, source failures and the isolated recommendation → grading → report path. TypeScript build and browser-JavaScript syntax checks passed; production dependency audit reported zero vulnerabilities. Local browser QA used temporary storage and did not write production picks.
