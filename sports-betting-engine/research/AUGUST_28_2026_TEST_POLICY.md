# August 28, 2026 NFL preseason — frozen retrospective test policy

Written before retrieving the test's archived prices or printing/grading game outcomes. This policy was chosen retrospectively on August 30, not actually issued on August 28; no claim of a pre-registered prospective trial is made. The NFL/ESPN schedule identifies ten Friday games, all preseason. The existing regular-season workload model cannot issue supported preseason recommendations. Production code, its gates and both live pick ledgers stay unchanged.

## Separate exploratory pricing experiment

- Date: August 28, 2026 in America/Chicago. Include every scheduled NFL game on that date, whether or not an eligible quote is available.
- Decision cutoff: August 28 at 21:00 UTC (4 PM Central), before the first scheduled kickoff. Request the closest historical snapshot at or before that time; require it to be no more than ten minutes earlier. This is a fixed pregame snapshot, not a closing-line claim.
- Provider sport key: `americanfootball_nfl_preseason`. One US-region historical request for `h2h,spreads,totals`, maximum 30 credits. Two initial discovery queries under regular NFL cost two additional credits; no preseason prop queries are needed because the provider documents no coverage. No automatic retries or bulk fallback queries.
- Candidate books: FanDuel and BetMGM only, matching current user configuration. Reference books: DraftKings, Caesars (`williamhill_us`), BetRivers, Bovada and BetOnline.ag. At least three distinct reference book keys must supply matching two-way markets. These books are correlated; distinct books do not imply independent evidence.
- Require verified market timestamps no later than the decision cutoff (no future-clock tolerance) and no more than fifteen minutes old at cutoff. Require a matching event/team orientation and kickoff within fifteen minutes. Reject malformed, missing, ambiguous and duplicate market/outcome data.
- Compare each target quote only with the exact same market and signed spread/total line. Each reference book's two American odds are converted to implied probabilities, then normalized to remove the two-way overround. Use the median normalized probability across the reference books. This is a market-consensus estimate conditional on no push/tie, not a calibrated win probability.
- Conditional expected return per unit = consensus probability × quoted win payout − (1 − consensus probability). Require at least +0.05 units. This conditional measure omits the unknown push frequency; it is not an unconditional EV claim.
- At most one recommendation per game: highest conditional estimated return, breaking ties by market key, side and book key. Save the entire candidate audit, explicit no-recommendation reasons, and selected quotes before fetching final box scores. Do not change the threshold to create picks after inspecting results.
- Baseline, reported separately: choose the shortest-priced moneyline side at FanDuel, falling back to BetMGM only if FanDuel has no valid fresh two-way moneyline. A tied price gets no favorite baseline. This is a market-favorite benchmark, not a recommendation. One unit risk per game.

## Grading and evidence

Only after selections are written, fetch ESPN final summaries. Require exact ESPN game ID, NFL league, 2026 preseason, team orientation, matching kickoff and normal final status. Compare with the scoreboard's scores; disagreements stay REVIEW. These are two feeds from ESPN, not independent providers. Use full-game final scores. Moneyline ties and spread/total equality push under explicit research rules; book settlement can differ. Win payout uses the actual American price; losses cost one unit; pushes return the stake. Report W/L/P, review, units, settled-stake ROI and games with no recommendation. Never present favorite-benchmark performance as our prop model's accuracy.

Collect source timestamps, sanitized request paths, response quota headers, frozen-policy hash, locked-selection hash, final source IDs and raw responses in a separate local research directory. Do not store API keys, current login credentials or session tokens. Output writes use exclusive creation to preserve previous evidence; this test never writes `picks_log.json` or `nfl_paper_picks.json`.

Limitations: this does not reconstruct historical injury/depth charts, player availability, snaps, or the full live model. Missing preseason prop coverage prevents a core-prop betting backtest. Consensus pricing contains bookmaker margin, shared information and possible stale-price/limit artifacts. A ten-game, post hoc experiment cannot establish an edge. Do not tune and validate on these same outcomes; repeat a frozen policy on separate dates and prospective data.

Sources: [provider preseason coverage](https://the-odds-api.com/sports/nfl-preseason-odds.html), [historical API documentation](https://the-odds-api.com/liveapi/guides/v4/), ESPN NFL scoreboard/summary APIs.
