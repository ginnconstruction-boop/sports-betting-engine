# NFL regular-season prop pilot — December 7, 2025

Completed August 31, 2026. **Conditional stat/price research: 3 wins, 4 losses, 0 pushes, 2 REVIEW; −1.3214 units on 7 settled one-unit-risk selections (−18.88% settled-stake ROI).** Nine selections across only two games are highly correlated. This is not evidence of profitability, and it is not the live recommendation record.

Full live-policy replay remains **UNVERIFIED**: archived injuries, pregame roster status and depth charts were unavailable. We did not manufacture active/starter snapshots, bypass the production gates, issue production recommendations or place real bets. The diagnostic uses the existing stat equations/thresholds, but does not represent what the complete live system would necessarily have selected.

## Fixed sample and coverage

The [frozen policy](REGULAR_SEASON_PROP_PILOT_POLICY.md) selected the first two December 7 games by kickoff then provider ID, before retrieving this pilot's outcomes: Saints at Buccaneers and Colts at Jaguars. Cutoff was 10 AM Central, two hours before both kickoffs. Archived snapshots were 15:55:37 UTC; individual selected quotes were timestamped before the 16:00 UTC cutoff. No game was swapped after inspecting prices or results.

| Game | Target-book quotes | Quoted players | Player/market pairs | Identity unavailable | Conditional selections |
|---|---:|---:|---:|---:|---:|
| New Orleans at Tampa Bay | 134 | 18 | 35 | 11 | 6 |
| Indianapolis at Jacksonville | 116 | 15 | 33 | 11 | 3 |
| Total | 250 | 33 | 68 | 22 | 9 |

All four requested markets appeared in the archive. Passing yards produced no qualifying conditional selection; that is not a passing-model win/loss result. Of 68 quoted player/market pairs, 22 could not be matched uniquely to the retrieved season roster and remained excluded. Others failed sample-size, workload, baseline or price checks. Counts overlap: 17 insufficient rolling-error samples, 15 failed baseline comparisons, 4 workload-change flags and 4 insufficient training samples among unselected pairs.

Historical season rosters are incomplete for this purpose; even a season-tagged roster retrieved today does not establish who was available at the decision time. Missing names included Devin Neal, Evan Hull, Foster Moreau, Rachaad White, Sterling Shepard, Taysom Hill, Austin Trammell, Johnny Mundt, Michael Pittman, Tim Patrick and Travis Etienne. These exclusions can bias results and must not be hidden.

## All nine locked conditional selections

Flat one-unit risk per selection. Full-game player statistics include overtime. No sportsbook-specific participation, early-injury or promotional rules are inferred.

| Game | Player / market | Selection | Book / odds | Final statistic | Result | Units |
|---|---|---|---|---:|---|---:|
| NO at TB | Bucky Irving receiving yards | Over 17.5 | FanDuel −112 | 26 | WIN | +0.8929 |
| NO at TB | Bucky Irving receptions | Over 2.5 | FanDuel +116 | 2 | LOSS | −1.0000 |
| NO at TB | Chris Godwin Jr. receptions | Under 3.5 | FanDuel +112 | 5 | LOSS | −1.0000 |
| NO at TB | Chris Olave receiving yards | Over 64.5 | FanDuel −112 | 30 | LOSS | −1.0000 |
| NO at TB | Mason Tipton receiving yards | Under 16.5 | FanDuel −112 | Unverified | REVIEW | — |
| NO at TB | Mason Tipton receptions | Under 1.5 | BetMGM +115 | Unverified | REVIEW | — |
| IND at JAX | Alec Pierce receiving yards | Over 51.5 | FanDuel −112 | 80 | WIN | +0.8929 |
| IND at JAX | Brenton Strange receiving yards | Over 38.5 | FanDuel −112 | 27 | LOSS | −1.0000 |
| IND at JAX | Trevor Lawrence rushing yards | Over 15.5 | FanDuel −112 | 16 | WIN | +0.8929 |

Mason Tipton has no uniquely matching receiving row in the retrieved final box score. Neither selection is counted as a win, loss, push or zero statistic. Participation and settlement need a separate evidence-backed review; no replacement picks were chosen. Seven graded selections have a 42.86% win rate. The two REVIEW stakes are unresolved, so the reported profit and ROI are not a final return for all nine selections.

By market: rushing yards 1–0 (+0.8929 units); receiving yards 2–2 plus 1 REVIEW (−0.2143); receptions 0–2 plus 1 REVIEW (−2.0000); passing yards no selection. These tiny correlated samples do not support market rankings.

Final named statistics and game identities were checked using [ESPN Saints–Buccaneers summary](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401772792) and [ESPN Colts–Jaguars summary](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401772793).

## What the test does and does not establish

- Archived real lines/prices, strict pre-cutoff stat filtering, immutable selection locking and exact-ID conservative grading work for this sample. Production and manual paper logs were not touched.
- The fixed workload model was not retuned. Historical probability/EV estimates remain uncalibrated; very large estimated edges in this run are warning signs, not proven opportunities.
- Earlier project work had already inspected some 2025 outcomes. This retrospective pilot is development research, not an independent preregistered holdout. Revised game logs may contain later corrections; missing appearances are not zero-filled and can bias estimates.
- Two games cannot establish predictive skill. The losing result should guide investigation, not an immediate threshold change to make this sample profitable.

## Next work, in order

1. Build trustworthy historical player/team identity and point-in-time availability/role inputs; quantify missing coverage before expanding the sample.
2. Add participation-aware result review for missing player rows, including the two Tipton selections. Preserve original outcomes/audit trails and do not assume DNP or zero.
3. Specify a larger untouched evaluation window and calibration split in advance; evaluate actual-price returns, baselines and distinct-game uncertainty without optimizing on this pilot.
4. Collect prospective 2026 paper forecasts with their original evidence and verified pre-kickoff prices. Keep historical, manual and model records separate.
5. College spreads/totals now have a usable quote board; college model validation and recommendation tracking remain separate work.

## Reproducibility / cost

Research artifacts only: `snapshots/backtests/2025-12-07-core-props/`. Includes frozen policy/code hashes, archived schedule and odds, cached public-source payloads, `locked-selections.json` and `graded-report.json`. Paid-request markers prevent accidental retries. Files are exclusive-write and raw archives remain ignored by Git. Selection hash: `20a00a5356b77473b7370589d227dce1d52ac9cafa7618e0b5f87b41571f8c89`.

The pilot used **81 Odds API credits**: one discovery plus two four-market historical pulls. Remaining immediately afterward: 19,857. College local browser QA and live deployment QA subsequently used two credits each; repeats used the cache. Total task usage: 85 credits; remaining at final odds verification: 19,853. Historical market access and charging are described in the [provider documentation](https://the-odds-api.com/historical-odds-data/).
