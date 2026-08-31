# Football catch-up checklist

Updated August 30, 2026 (America/Chicago).

Current website: [Sports Betting Engine](https://sports-betting-engine-1.onrender.com/).

**Release target: usable NFL research and paper testing, not validated betting recommendations.** No real bets are placed. A functioning dashboard and passing software tests do not establish a profitable model.

| # | Item | Status / remaining work |
|---|---|---|
| 1 | Website, login, deployment | Active Render service identified; saved login left unchanged. Health check and persistent storage configured. |
| 2 | Find all required accounts | Active Render + GitHub + Odds API are the required stack. ESPN public feeds need no account. Old suspended Render web/database/cron services are not dependencies; leave them paused. |
| 3 | Football-only production | NFL primary; college spreads/totals only. Other sports paused, history preserved. |
| 4 | NFL market coverage | 16 on-demand quote categories, next 14 days, freshness and credit controls. Availability varies; not every sportsbook special, future or live market is supported. |
| 5 | NFL player context | Current rosters, injury flags, provisional depth-chart order and regular-season attempts/targets connected. Still verify active/inactive lists, actual starting roles and snap expectations close to kickoff. |
| 6 | Core prop model audit | Basketball-shaped NFL fallback found and disabled. NFL-only historical baselines now available for passing/rushing/receiving yards and receptions. A role/opponent-adjusted forecasting model and out-of-sample validation remain unfinished. |
| 7 | Result grading | Supported core props and standard game/quarter/half paper lines have exact-ID final-score grading. Missing data requires review. Book-specific rules, specialty grading and later stat-correction handling remain separate work. |
| 8 | NFL paper performance | Separate durable ledger and season/market/version reports implemented. Fresh production paper sample still needs to be collected; legacy results do not establish NFL accuracy. |
| 9 | Closing prices and calibration | Same-book, same-line pregame observations supported on explicit odds refreshes. Verified near-kickoff closing capture and calibrated forecast probabilities remain unfinished. Do not call current observations true CLV. |
| 10 | Weekly operation and expansion | Runbook below is ready. Complete NFL paper workflow first, then validate college spreads/totals and specialty models. Parlays, TD estimates and teasers are research-only. |

## Weekly runbook

1. Open the current site and confirm login and health. No old Render service needs unpausing.
2. Open **Core Prop History & Paper Tests**, then **Load / refresh NFL games**. This uses no odds credits.
3. Choose one game/category and inspect its credit ceiling before **Load posted odds**. No background polling is configured.
4. Use **History** beside a supported core prop. Read the season, sample size, attempts/targets, roster injury flags and provisional depth chart. Do not treat last year's mean as a current forecast.
5. Verify current availability, role and the exact line/price/rules at the sportsbook. A clean roster injury list is not proof of health.
6. Acknowledge paper rules, then **Save paper** for an explicit selection. Stale/expired quotes need reloading. Only paper records are created.
7. If desired, explicitly refresh the same category before kickoff to observe the same book/line's later price. Five-minute cache applies. No guaranteed closing line is captured.
8. After the game ends (and at least four hours after kickoff), click **Grade completed paper picks**. Repeat if more than ten games await checking. REVIEW needs inspection or a later retry, not an assumed loss.
9. Review **Refresh paper record**, separating markets/seasons and noting distinct games. Do not optimize against a handful of correlated picks.
10. Before any production-model promotion, require documented data completeness, no-lookahead backtesting, out-of-sample probability calibration, suitable sample size, costs/odds-aware performance and a deliberate approval. Twenty positive picks do not automatically unlock BET labels.

## Verification evidence for this release

- Automated tests exercise market scope, identities, stale quotes, kickoff boundaries, NFL-specific statistics, missing data, paper deduplication/persistence, regulation periods vs overtime, report denominators and retries.
- Live read-only source checks matched a current NFL player to his current roster and upcoming ESPN event, separated 2026 zero completed regular-season games from 2025 history, and surfaced a current injury flag.
- Historical ESPN game 401772798 (Chargers at Chiefs, December 14, 2025) returned Patrick Mahomes passing yards 189, Q1 total 10 and second-half regulation total 6; the paper evaluator matched all three.
- Local browser QA uses isolated temporary storage; its test selections must never be copied into production.

## Where things live

- Website/hosting: Render `sports-betting-engine-1`, service `srv-d7c6qpcp3tds739nn2tg`.
- Source: GitHub `ginnconstruction-boop/sports-betting-engine`, branch `main`, app root `sports-betting-engine`.
- Durable data: Render disk `/var/data/snapshots`, including new `nfl_paper_picks.json`; existing `picks_log.json` remains separate.
- Configuration: active Render environment (`ODDS_API_KEY`, dashboard credentials, `SNAPSHOT_DIR`, etc.). Do not commit or share secrets.
- Recovery: preserve existing daily Render disk snapshots and export important paper history before significant future schema changes. Deploying code is not a database backup.

## Next unresolved work

NFL predictive modeling is the largest remaining item: reliable participation/snap exposure, role-change and opponent adjustments, and no-lookahead evaluation. Descriptive history is intentionally not labeled a forecast. Confirmed game-day availability and fresh 2026 results cannot be established in advance. After those, finish verified closing snapshots and probability calibration, then college/specialty validation. No profit or readiness-for-real-money claim is supported yet.
