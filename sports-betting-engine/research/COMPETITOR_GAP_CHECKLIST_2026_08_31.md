# Competitor research and football-engine checklist

Implementation follow-up: [football foundation release status](IMPLEMENTATION_STATUS_2026_08_31.md). The original research below is retained as the pre-change audit; its unchecked boxes are not the current implementation report.

Reviewed August 31, 2026. Scope: NFL first, college football spreads/totals second. This is a research/code review, not an implementation or deployment. No production records or model rules were changed. Competitor statements below describe their public documentation, not independently verified profitability or access to proprietary models. Subscription prices and procurement were not evaluated.

## Bottom line

The project is on a reasonable path as a research and paper-tracking application: explicit sportsbook quotes, four workload-based NFL prop forecasts, immutable paper selections, conservative result grading and separate historical/live records. It is not yet a validated recommendation engine. Several older game-scan components require correctness repairs before more inputs should influence their scores.

Having a weather, ATS or power-rating module in the repository does not mean it is accurate, complete, connected to the new NFL prop model, or useful in predicting future results. The newer `nflForecast.ts` explicitly excludes opponent strength, weather, snap share and confirmed game-day availability from its model.

## What comparable products publicly disclose

| Product | Documented approach | Relevant lesson, not a profitability endorsement |
|---|---|---|
| nfelo | NFL-specific Elo framework with QB, home field, rest, weather, historical results and market information; open-source code/data links. | Benchmark football forecasts against market prices; account for QB/team context. [Methodology overview](https://www.nfeloapp.com/about/). |
| PFF | Public prop analysis combines projected statistics and cover probabilities with prices, changing snap usage, teammate roles and defensive matchups. | Attempts/targets alone do not describe future opportunity; add participation and role context. This article illustrates analysis, not a complete reproducible model. [Prop analysis example](https://www.pff.com/news/bet-week-6-player-props-pff-betting-tool). |
| Unabated | Its prop simulator converts projections and historical data into outcome distributions and fair prices, using 10,000 simulations. | Model the chance of exceeding each exact line, not just a mean. A larger simulation count does not validate its assumptions. [Simulator description](https://www.unabated.com/tools/core/props-simulator). |
| OddsJam | Price-comparison/estimated-positive-EV workflow identifies a sportsbook, market and price; also provides tracking. | Market-based value detection is a distinct method from forecasting a team's or player's performance. Marketing claims do not establish guaranteed returns. [Current product page](https://oddsjam.com/betting-tools/positive-ev). |
| RotoGrinders | NFL weather page presents venue/game-time conditions, wind, precipitation and indoor-game indicators. | Weather should be venue- and time-specific, with roof/indoor context, before considering adjustments. Do not treat another site's venue label as independently verified roof status. [Weather page](https://rotogrinders.com/weather/nfl). |
| Pikkit | Bet tracking, sportsbook comparison and portfolio analysis by league/player/bet type, including displayed CLV functionality. | Judge actual-price returns and record quality, not just wins or a social feed of picks. Tracking is not itself a pregame prediction model. [Product description](https://pikkit.com/). |
| Action Network | NFL prop page compares projections to prices. Its separate 2026 college season model describes opponent-adjusted offense/defense, preseason priors and simulated outcomes. | Keep projections, price and uncertainty distinct; college needs its own team-strength model. A season simulator is not automatically an ATS betting model. [NFL props](https://www.actionnetwork.com/nfl/prop-projections), [college methodology](https://www.actionnetwork.com/ncaaf/college-football-supercomputer-2026). |

Props.cash's public page returned a JavaScript-only shell in this review, so its current underlying prediction methodology was not established. No claim about its private model is made. No subscriptions, account connections or competitor data scraping were performed.

## Priority 0 — repair before trusting older game recommendations

- [ ] **1. Correct the legacy spread-value direction.** A read-only call to `compareToLine` with a model home spread of −7 and posted home spread −3 returned `recommendation: away`. Relative to that model, home −3 is the favorable side. Source: `src/services/powerRatings.ts:242`, especially lines 265/268. Morning and sport scans call this helper. Add both-side, favorite/underdog and sign-boundary regression tests. Also audit whether downstream bonuses are applied to the selected side rather than merely to any large discrepancy. This test does not establish how many historical recommendations were affected.

- [ ] **2. Repair ATS accounting and establish one authoritative dataset.** An in-memory test supplied one unique winning spread pick: first update counted one game, second update counted two. `updateATSFromPicks` loads accumulated records and loops over every old pick without a processed-ID guard (`src/services/atsDatabase.ts:68`). This is selected-pick history, not every team's complete ATS season. Its home-underdog display also uses a general home record, not an actual historical underdog filter. The separate live ATS tracker uses morning-scan snapshots, not verified closing spreads (`src/services/atsTracker.ts:163`), and its nominal season window is rolling days. Unify identities, season boundaries, exact spread source/time, neutral-site flags and push rules; retain backups and original records. Do not rebuild/reset production data without a reviewed migration.

- [ ] **3. Retire unvalidated score-to-probability labels in legacy scans.** `src/services/probabilityEngine.ts:101` maps score 0–100 linearly into 50–65% win probability: score 80 becomes 62% regardless of learned probability calibration. Those outputs feed the old weighted-edge workflow. Keep a score as a ranking score, or replace it with a validated market-specific probability. This is separate from the new NFL residual model, whose estimates are also explicitly uncalibrated, but are not produced by this linear mapping.

- [ ] **4. Repair weather before giving it model weight.** `src/services/weatherData.ts:149` uses the server-local hour as an index into a venue-local forecast returned with `timezone=auto`; it does not match actual timestamps. Missing temperature/wind entries default to 20°C/zero wind, which can look like real mild weather. Venue coordinates are baseball-oriented with city fallbacks, and there is no roof-status gate. Add actual football venues, indoor/retractable-roof handling, correct kickoff-hour matching, wind/gusts/precipitation, forecast issue time and explicit unknowns. Archive the forecast available before kickoff, not later observed weather, for replay. Initially show conditions as context; fit and test any football-specific effect rather than applying an arbitrary generic penalty.

## Priority 1 — improve NFL inputs and prove incremental value

- [ ] **5. Complete player identity and availability coverage.** Our recent pilot could not uniquely match 22 of 68 quoted player/market pairs to retrieved historical rosters. Add durable cross-provider player/team IDs, transactions, historical memberships, dated injury/practice reports, and verified game-day availability. A clean injury list or first-listed depth-chart slot is not a participation guarantee. Keep missing data blocked and visible.

- [ ] **6. Upgrade workload forecasting.** Keep current attempts/targets × efficiency as a baseline. Add snap share, routes, route participation, target share, carries, red-zone opportunities, teammate absences, and changes in starting QB/line/coaching. Model team opportunities and allocate them to players so projections are mutually plausible. Test recency weighting and offseason/team-change handling; do not assume a five-game trend remains valid after a role change.

- [ ] **7. Replace crude team-strength proxies with football-specific, opponent-adjusted inputs.** Current power-line calculation uses recent scoring margin and a fixed home advantage. The shared advanced-stats layer largely uses scoring averages for football and applies a generic Pythagorean exponent (`advancedStats.ts:71`). Candidate improvements: EPA/play, success rate, early-down/pass/rush splits, pressure, neutral-situation pace/pass rate, rest/travel and projected game script. Explicitly control for opponent strength, season type and garbage time. Treat each as a hypothesis, not a guaranteed gain. [nfelo's model/market research](https://www.nfeloapp.com/analysis/using-market-regression-to-improve-prediction-accuracy-in-the-nfl/) is an example of testing combinations rather than assuming more variables are better.

- [ ] **8. Add a clean market-implied baseline.** Compare identical player/team, market, period, line, overtime rules and timestamp; remove bookmaker margin from matched two-sided prices. Exclude the target price from its own reference consensus, and test reference-book weights rather than assuming every book is equally informative. Legacy `aggregateMarkets.ts:83` groups by outcome name and averages implied prices across offers that may have different lines; its consensus is not automatically a no-vig fair price. Keep the new exact-quote boards. Report market-derived value separately from independent football-model value to avoid double-counting the same information.

- [ ] **9. Establish out-of-sample calibration and feature-removal tests.** Freeze chronological train/calibration/test windows before inspecting test results. Compare trailing means, football-only models, market-only baselines and any combined model. Evaluate forecast error, probability calibration/Brier or log loss, exact-price unit return, drawdown, distinct-game uncertainty and missing coverage. Correlated props are not independent trials. Run each new feature both included and excluded; keep it only if it adds stable out-of-sample value or necessary safety information. Do not optimize on our already-seen two-game pilot or treat 20 outcomes as validation.

- [ ] **10. Finish auditable tracking and closing-price capture.** Keep immutable prediction/quote/model versions, separate manual/model/historical records, win/loss/push/pending/review, units and ROI. Add verified pre-kickoff closing captures with source timestamps, price/line availability and missed-capture counts. A later manually refreshed quote is not necessarily the closing price. Add participation-aware review for missing stats, sportsbook-specific settlement metadata and a stat-correction audit trail. Do not assume zero or a loss for an absent player row. Our two Tipton selections remain unresolved.

## Priority 2 — expand only after the foundation works

- [ ] **11. Validate college spreads/totals separately.** The quote board works, but it does not create validated college forecasts. Use reliable college team/venue IDs, opponent-adjusted efficiency and tempo, returning production/transfers, QB changes, coaching turnover, neutral sites and appropriately declining preseason priors. Check data licensing, freshness and historical availability before choosing a supplier. Do not transfer NFL coefficients or data coverage assumptions to college.

- [ ] **12. Keep specialty markets restricted until modeled and graded.** Quarter/half markets need period-specific scoring/possession distributions; do not just divide a full-game expectation by four or two. TD/alternate-line/parlay recommendations require suitable distribution tails and dependence between legs, plus explicit settlement. Existing quote/paper-grading support is not proof that an automated specialty model is validated. Keep NFL core props first; no need to buy every competitor feature.

- [ ] **13. Simplify the interface and remove unsupported influence, not historical evidence.** De-emphasize old head-to-head streaks, automatic hot/cold or fade-public rules, generic point bonuses and duplicated signals unless holdout tests show incremental value. `sharpIntelligence.ts` correctly marks movement-based signals inferred; retain factual line movement but avoid presenting it as verified professional money. `getATSSignalForScoring` has no external call site in the inspected source despite its comment claiming scoring integration—do not count it as a working feature. Keep ATS and recent hit rates as labeled descriptive context with sample sizes, not stand-alone win probabilities. Archive unused UI/code deliberately; do not delete records or reset tracking.

## Keep — already directionally useful

- [x] Football-only scope; NFL primary, college spreads/totals secondary.
- [x] Explicit odds pulls, credit limits, cache/freshness checks and exact bookmaker lines/prices.
- [x] Four core NFL workload forecasts with same-team/strictly earlier history and baseline checks.
- [x] Paper-only experimental issuance with original evidence saved before display.
- [x] Exact-ID conservative grading, explicit REVIEW and separate model/manual/historical records.
- [x] No forced recommendation when data or model checks fail.

## Recommended next implementation batch

First fix items 1–4 and regression-test them, without changing the fresh live record or weakening NFL prop gates. Then complete availability/identity and workload data (5–6), establish comparable market/calibration evaluation (8–9), and make additions prove their value. No claim is made that any individual new feature, competing service or model can guarantee profitable betting.

Evidence limits: repository review and two isolated deterministic diagnostics, plus public competitor pages; no production ATS-store corruption assessment, paid competitor performance audit or league-wide new backtest. Existing working-tree documentation changes were preserved. The website was not changed in this research turn.
