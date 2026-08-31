# August 28, 2026 NFL preseason test — completed

Prepared August 30, 2026. All ten Friday games were examined. This is a separate retrospective research exercise, not a live betting record or a validation of the deployed regular-season prop model.

## Bottom line

- **Regular-season prop model:** unsupported on all ten preseason games. No supported player-prop recommendations were generated or graded.
- **Separate preseason pricing experiment:** zero qualifying recommendations across ten games. No recommendation win percentage or ROI can be calculated from zero picks.
- **Market-favorite moneyline benchmark, not recommendations:** 4 wins, 3 losses, 0 pushes; three evenly priced games skipped. Net **−0.6878 units**, or **−9.83% ROI** on seven units risked. Winning 57.14% of these seven bets still lost money because the favorites paid less than even money.
- No live picks were added, erased, restored or regraded. The old 329-pick backup was not accessed or modified. No website deployment or unattended job was created for this exercise.

## What data was recovered

ESPN's schedule verified ten NFL games dated August 28 in America/Chicago, all 2026 preseason. Each has a final summary and player box-score rows; all ten final scores agree between ESPN's summary and scoreboard feeds. Those two feeds are from the same provider, not independent providers. Selected results were also checked against official team recaps after grading: [Cincinnati–Philadelphia](https://www.philadelphiaeagles.com/news/game-recap-bengals-vs-eagles-2026-preseason-week-3), [Seattle–Kansas City](https://www.seahawks.com/news/2026-preseason-week-3-rapid-reactions-seahawks-tie-chiefs-9-9-in-their-preseason-finale), and [Minnesota–Denver](https://www.vikings.com/news/broncos-2026-preseason-game-observations).

Historical access works with the existing Odds API account. NFL preseason uses the separate `americanfootball_nfl_preseason` key. Initial discovery under `americanfootball_nfl` returned regular-season games, so the historical query was corrected using the provider's documented preseason key; no September game was substituted into this test. The provider explicitly does not cover additional preseason markets such as player props. Actual player box scores without the corresponding historical betting lines/prices are insufficient for a prop betting backtest. [Provider preseason coverage](https://the-odds-api.com/sports/nfl-preseason-odds.html)

One US-region request recovered archived moneylines, spreads and totals for all ten target games, plus two other-date games that were excluded. Requested cutoff: **August 28, 4:00 PM Central**. Returned snapshot: **3:55:39 PM Central** (`2026-08-28T20:55:39Z`), before every target kickoff. These are pregame snapshot prices, not verified closing odds. The historical data request cost 30 credits; two initial discovery calls cost two more, for **32 credits total**. Last remaining-credit header: **19,938**, not a guarantee of the current balance after other activity. [Historical endpoint documentation](https://the-odds-api.com/liveapi/guides/v4/)

## The experiment and its exclusions

The [written policy](AUGUST_28_2026_TEST_POLICY.md) was fixed before retrieving archived prices or grading outcomes. The test compared both sides of moneylines, spreads and totals at FanDuel and BetMGM. Reference prices came from the specified other book keys, not from the target book itself. Each reference required a fresh two-way price at the exact same line; its implied probabilities were normalized to remove the quoted overround, then combined by median. This estimates market consensus conditional on no push/tie; it does not forecast teams, quarterbacks or player workload.

The minimum requirement was three matching reference books and an estimated return of at least +5% per decisive bet. At most one highest-estimated-return recommendation could be selected per game. Missing/ambiguous/out-of-time data was excluded. All selection decisions were saved at `2026-08-31T02:44:03.973Z`; the grader completed at `2026-08-31T02:44:21.508Z`. The saved-selection hash matches the one recorded by the grader. The games had already happened in real life: this is outcome-isolated program flow, not proof of prospective prediction or an independent holdout.

- 120 target-book quotes assessed: 10 games × 2 books × 3 markets × 2 sides.
- 86 quotes had at least three fresh reference books at the exact line.
- 34 lacked enough matching references and were not scored as eligible.
- None of the 86 had a positive consensus-based conditional-return estimate. Values ranged from approximately **−7.89% to −0.27%**.
- Consequently every game was **NO RECOMMENDATION**. The result is not merely a 5% threshold rejecting slightly positive prices; no adequately supported positive estimate appeared in this snapshot. This does not prove that no other time, book or model could identify an edge.

## Every game and the separate favorite benchmark

**All ten games: no qualifying pricing recommendation.** The table below is only the predeclared “back the FanDuel moneyline favorite” benchmark. It is not the output or accuracy of our regular-season player-prop model. One unit is risked per benchmark bet. At tied moneyline prices, the policy abstains instead of choosing a team arbitrarily.

| Matchup | Final score | Benchmark side and price | Benchmark result | Net units |
|---|---|---|---|---:|
| Washington at Baltimore | Baltimore 41–3 | Baltimore −154 | Win | +0.6494 |
| Atlanta at Miami | Atlanta 17–12 | Atlanta −194 | Win | +0.5155 |
| Houston at Carolina | Carolina 16–13 | None; both −108 | Skipped | — |
| NY Giants at NY Jets | Giants 23–6 | Giants −164 | Win | +0.6098 |
| Tampa Bay at Jacksonville | Jacksonville 19–0 | Tampa Bay −142 | Loss | −1.0000 |
| New Orleans at Dallas | New Orleans 27–24 | Dallas −142 | Loss | −1.0000 |
| Arizona at Green Bay | Green Bay 42–38 | None; both −108 | Skipped | — |
| Seattle at Kansas City | Tied 9–9 | None; both −108 | Skipped | — |
| Cincinnati at Philadelphia | Cincinnati 30–13 | Philadelphia −138 | Loss | −1.0000 |
| Minnesota at Denver | Denver 34–6 | Denver −186 | Win | +0.5376 |
| **Benchmark total** | | **7 one-unit risks** | **4W–3L–0P** | **−0.6878** |

Totals use unrounded payouts: `100 / abs(American odds)` for these negative-priced winners and −1 for losses. For example, a purely illustrative $100 risk per benchmark bet would have risked $700 and lost $68.78. No money was actually wagered. Research pushes/ties can differ from sportsbook settlement rules; none of the seven selected benchmark bets pushed.

## Evidence files and reproducibility

All raw data and calculations are local and separate from production:

- [Frozen policy and hash](../snapshots/backtests/2026-08-28-preseason/policy.json)
- [Archived odds, timestamp and quota headers](../snapshots/backtests/2026-08-28-preseason/odds-archive.json)
- [Locked decisions and all 120 candidate checks](../snapshots/backtests/2026-08-28-preseason/locked-selections.json)
- [Graded report](../snapshots/backtests/2026-08-28-preseason/graded-report.json)
- [ESPN final scoreboard](../snapshots/backtests/2026-08-28-preseason/final-scoreboard.json)

Per-game raw final summaries are in that same directory. Their source links are:

| Matchup | ESPN final summary |
|---|---|
| Washington–Baltimore | [401873302](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873302) |
| Atlanta–Miami | [401873304](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873304) |
| Houston–Carolina | [401873307](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873307) |
| NY Giants–NY Jets | [401873303](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873303) |
| Tampa Bay–Jacksonville | [401873306](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873306) |
| New Orleans–Dallas | [401874048](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401874048) |
| Arizona–Green Bay | [401874102](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401874102) |
| Seattle–Kansas City | [401873305](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873305) |
| Cincinnati–Philadelphia | [401873301](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873301) |
| Minnesota–Denver | [401873614](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873614) |

The utility is `src/dev/runAugust28Audit.ts` with separate `prepare` and `grade` phases. It refuses to overwrite existing evidence or grade after the selection-logic hash changes. Tests cover reference-count requirements, no future/stale quotes, event identity, exact-line matching, no result-data inputs to the pricing function, signed lines, actual-price payouts, pushes and review exclusions. **55 tests and the TypeScript build passed.** Raw snapshot files are intentionally ignored by Git; preserve/export the research directory if moving machines. This run did not enable preseason in production.

## What we can build from this

1. Historical access, exact event mapping, timestamped prices, frozen selection files and final-score grading now have a working isolated example.
2. The most important limitation is still model/data scope: this experiment does not validate core-prop forecasts. A 2025 regular-season test needs historical prop prices plus defensible pregame participation and roster context, with unavailable inputs explicitly excluded.
3. Do not reinterpret the seven favorites as our recommended card or tune the 5% threshold on these results. Keep this day as completed exploratory research, freeze any subsequent policy and evaluate different dates plus prospective paper results.
4. A no-pick outcome is not evidence of profitable prediction. Ten games and one snapshot are far too little to establish a dependable betting edge.
