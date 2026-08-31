# Football catch-up checklist

Updated August 30, 2026 (America/Chicago).

Current website: [Sports Betting Engine](https://sports-betting-engine-1.onrender.com/).

**Release target: usable NFL research and paper testing, not validated betting recommendations.** No real bets are placed. A functioning dashboard and passing software tests do not establish a profitable model.

| # | Item | Status / remaining work |
|---|---|---|
| 1 | Website, login, deployment | Workload-forecast release `ee5eee9` live August 30, 2026, around 9:18 PM Central. Health, new assets and authenticated login verified; saved login unchanged. Persistent storage verified. |
| 2 | Find all required accounts | Active Render + GitHub + Odds API are the required stack. ESPN public feeds need no account. Old suspended Render web/database/cron services are not dependencies; leave them paused. |
| 3 | Football-only production | NFL primary; college spreads/totals only. Other sports paused. Earlier records are recoverable in a reset backup; see the history note below. |
| 4 | NFL market coverage | 16 on-demand quote categories, next 14 days, freshness and credit controls. Availability varies; not every sportsbook special, future or live market is supported. |
| 5 | NFL player context | Current rosters, injury flags, provisional depth-chart order and regular-season attempts/targets connected. Still verify active/inactive lists, actual starting roles and snap expectations close to kickoff. |
| 6 | Core prop model audit | Basketball-shaped fallback disabled. Experimental workload forecasts now implemented for passing/rushing/receiving yards and receptions, with rolling baseline comparisons and fail-closed issuance gates. First historical results are mixed; opponent adjustments and independent betting validation remain unfinished. |
| 7 | Result grading | Supported core props and standard game/quarter/half paper lines have exact-ID final-score grading. Missing data requires review. Book-specific rules, specialty grading and later stat-correction handling remain separate work. |
| 8 | NFL paper performance | Eligible Forecast + track recommendations auto-save the original quote/model before display. Separate model/manual season/market/version W/L, push, pending, review and unit returns. Fresh prospective sample still needs collecting; no validated NFL accuracy claim. |
| 9 | Closing prices and calibration | Same-book, same-line pregame observations supported on explicit odds refreshes. Verified near-kickoff closing capture and calibrated forecast probabilities remain unfinished. Do not call current observations true CLV. |
| 10 | Weekly operation and expansion | Runbook below is ready. Complete NFL paper workflow first, then validate college spreads/totals and specialty models. Parlays, TD estimates and teasers are research-only. |

## Weekly runbook

1. Open the current site and confirm login and health. No old Render service needs unpausing.
2. Open the main-menu **NFL Forecast + track** button, then **Load / refresh NFL games**. This uses no odds credits. The old menu label was Core Prop History & Paper Tests.
3. Choose one game/category and inspect its credit ceiling before **Load posted odds**. No background polling is configured.
4. Use **History** beside a supported core prop. Read the season, sample size, attempts/targets, roster injury flags and provisional depth chart. Do not treat last year's mean as a current forecast.
5. Verify current availability, role and the exact line/price/rules at the sportsbook. A clean roster injury list is not proof of health.
6. Check the paper-rules box above the quotes, then the green **Forecast + track** button on the left of a supported core-prop row. It evaluates loaded quotes at configured books and automatically saves an eligible experimental pick; a failed gate explains why no pick is issued. **Save paper** is a separate manual selection. Stale/expired quotes need reloading. Only paper records are created.
7. If desired, explicitly refresh the same category before kickoff to observe the same book/line's later price. Five-minute cache applies. No guaranteed closing line is captured.
8. After the game ends (and at least four hours after kickoff), click **Grade completed paper picks**. Repeat if more than ten games await checking. REVIEW needs inspection or a later retry, not an assumed loss.
9. Review **Refresh paper record**, separating model/manual, markets/seasons/versions and noting distinct games. **View original forecast** reopens the locked evidence, including after kickoff. Do not optimize against a handful of correlated picks.
10. Before any production-model promotion, require documented data completeness, no-lookahead backtesting, out-of-sample probability calibration, suitable sample size, costs/odds-aware performance and a deliberate approval. Twenty positive picks do not automatically unlock BET labels.

## Verification evidence for this release

- All 50 automated tests and the TypeScript build passed; production dependency audit reported zero vulnerabilities on the model release. Tests exercise market scope, identities, stale quotes, kickoff boundaries, NFL-specific statistics, missing data, rolling no-lookahead forecasts, persistence before issuance, concurrent duplicate protection, regulation periods vs overtime, report denominators and retries. Three UI regression tests additionally check the visible forecast entry point, first-column actions and paper-rules focus.
- First fixed-cohort historical stat audit: 96 correlated forecasts across six evaluable player/market pairs; workload beat baseline on three pairs and lost on three. Two additional pairs lacked usable source data. This is not a betting backtest, win rate or ROI. Full method and all results: [NFL_FORECAST_V1.md](NFL_FORECAST_V1.md).
- Local browser QA issued one automatically logged model paper recommendation, returned the same original on repeat, reopened its original evidence and left the separate official log at zero. Synthetic final-game tests verified grading and model/manual report separation. No QA selections are copied to production.
- Live read-only source checks matched a current NFL player to his current roster and upcoming ESPN event, separated 2026 zero completed regular-season games from 2025 history, and surfaced a current injury flag.
- Historical ESPN game 401772798 (Chargers at Chiefs, December 14, 2025) returned Patrick Mahomes passing yards 189, Q1 total 10 and second-half regulation total 6; the paper evaluator matched all three.
- Local browser QA uses isolated temporary storage; its test selections must never be copied into production.
- Production verified: healthy HTTP 200, authenticated login, 15 upcoming NFL games, zero paper test records, exact player/depth/history data, and HTTP 400 for an invalid paper selection. Anonymous paper access returns HTTP 401.
- Workload-release production verification: HTTP 200 health/assets/login, HTTP 401 anonymous forecast access and HTTP 400 invalid authenticated forecast request. Read-only live forecast inputs returned 30 same-team games and 22 rolling tests. Official and paper logs each remained at zero; storage is `/var/data/snapshots`. No production forecast was issued for QA. Local QA server stopped and isolated test tab closed.

## Intentional fresh start — confirmed by owner

The owner confirmed that the reset was intentional. Keep the fresh active record; do not restore or merge the older picks into it. At the final deployment check, the active log contained zero records. Its timestamp and reset backup show that it was cleared at **August 30, 2026, 7:42 PM Central**, before release `fedb4da` deployed around 8:24 PM Central. The backup `/var/data/snapshots/reset_backups/reset_2026-08-31_00-42-47/picks_log.json` was read and verified to contain **all 329 earlier picks**. Retain that backup untouched for reference and recovery. No reset, deletion or restoration was performed in this work.

## Where things live

- Website/hosting: Render `sports-betting-engine-1`, service `srv-d7c6qpcp3tds739nn2tg`.
- Source: GitHub `ginnconstruction-boop/sports-betting-engine`, branch `main`, app root `sports-betting-engine`.
- Durable data: Render disk `/var/data/snapshots`, including new `nfl_paper_picks.json`; existing `picks_log.json` remains separate.
- Configuration: active Render environment (`ODDS_API_KEY`, dashboard credentials, `SNAPSHOT_DIR`, etc.). Do not commit or share secrets.
- Recovery: preserve existing daily Render disk snapshots and export important paper history before significant future schema changes. Deploying code is not a database backup.

## Next unresolved work

The first experimental workload forecast and paper-tracking loop are implemented. Reliable participation/snap exposure, role-change/opponent adjustments and independent odds-aware validation remain the largest gaps. Descriptive History stays separate from Forecast + track. Confirmed game-day availability and fresh 2026 results cannot be established in advance. Collect prospective model results, finish verified closing snapshots and probability calibration, then validate college/specialty markets. No profit or readiness-for-real-money claim is supported yet. Grading is on demand; unattended scheduling is not configured.
