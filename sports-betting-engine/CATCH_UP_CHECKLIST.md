# Football catch-up checklist

Updated September 3, 2026 (America/Chicago).

## September 3 safety update — college-safety-2

The unchanged v1 score model now has a fail-closed context layer. Extreme market
disagreement, missing roster/QB data, FBS/FCS mismatch and failed calibration can
downgrade a game to PAPER MONITOR/PASS or MODEL WARNING. No qualified v2 bets are
currently produced. Generic college A+/Kelly/official paths and all college total
paper saves are blocked. Canonical UMass matching, immutable forward snapshots,
append-only line observations and separate CLV diagnostics were added. On the
archived September 3 slate: 5 monitor-only, 5 warnings, 0 qualified bets. A fresh
QA scan matched all 11 current games including UMass–Rutgers. See the detailed
[safety release report](research/COLLEGE_SAFETY_RELEASE_2026_09_03.md).

Current website: [Sports Betting Engine](https://sports-betting-engine-1.onrender.com/).

**Release target: usable football research and experimental paper testing, not proven real-money recommendations.** No real bets are placed. A functioning dashboard and passing software tests do not establish a profitable model.

## Latest college model — college-model-paper-1

**One-click workflow update — college-one-click-1:** The main **College football —
scan + track + grade** button now chooses today in Central time, scans the full
available slate, saves qualifying experimental paper spreads, grades previously
tracked eligible games in batches until the fixed backlog is checked, and refreshes
the college W/L record. No date picker, game list or checkbox is needed. The
date/preview controls remain available under Optional. Final results are required;
unfinished games stay pending and are checked on a later click, not overnight by
a scheduler. No real bets. Live commit `4d9c65f`, verified September 2 at 7:13 PM
Central: 134 tests and build pass; public assets/health and authenticated endpoint
checks pass. Today's empty-slate one-click run completed with zero picks and zero
odds credits. Details: [one-click release report](research/COLLEGE_ONE_CLICK_2026_09_02.md).

The independent college scoring model is live and verified on September 2 at
6:56 PM Central. **Spreads: experimental paper only. Totals: research
only. NFL automatic picks: still blocked by missing verified availability.**

- 2025 held-out score test: 1,565 games; spread RMSE 17.15 vs simple baseline
  19.71 (pass); total RMSE 15.90 vs 15.72 (fail).
- Six fixed historical odds dates: 113W–93L, +10.99 hypothetical units, +5.34%
  ROI. Three dates lost money. This is a reconstructed test, not a live record.
- Probability calibration **failed**: predicted 67% on average but won 55%.
  High modeled confidence is not trustworthy; no real-money or stake advice.
- The one-click daily scan saves qualifying paper spreads; the optional date
  preview retains its paper checkbox. Original line/price/forecast remains unchanged on
  repeat scans; separate college W/L, grading, replay and export are visible.
- Tomorrow (Thursday September 3): local and live scans verified 10 provider games and
  generated 10 paper preview candidates. Rutgers–UMass is a disclosed feed gap.
  Ten test records were saved in isolated QA storage, not production.
- 126 automated tests, server build and JS syntax pass; dependency audit clear.
  Historical odds audit used 120 credits; local/live scan QA used 4; cached repeats 0.
  Last observed balance: 19,864. No subscription/billing changes.
- Live commit `fdc0f8ea37d9fe843f1f69cb615d61b6387d3a46`; health, assets,
  authenticated model/record endpoints and Thursday preview passed. Live smoke
  created zero picks. Official/ATS/reset-backup fingerprints are unchanged;
  both NFL and college production paper ledgers remain absent until first saves.

Detailed evidence and deployment status:
[College model release report](research/COLLEGE_MODEL_RELEASE_2026_09_02.md).

### What to do tomorrow

Refresh the [website](https://sports-betting-engine-1.onrender.com/) once after
the update. Then click **College football — scan + track + grade**. That is the
entire daily workflow. Today is selected by the server in Central time, even if
an optional date was previously selected. Click again later or the next morning
to check games that have since finished. The college paper record below the scan
is separate from the official cards at the top. No real-money approval is implied.

### Next development priorities

1. Collect prospective paper outcomes and missing-game coverage without changing
   original selections or treating REVIEW as a loss.
2. Fix college probability calibration using a new declared development/test
   split; the existing 2025 holdout must not become a tuning target.
3. Add and independently test dated roster/QB/injury/venue/weather inputs.
4. Diagnose totals; keep automatic total picks blocked until separate tests pass.
5. Continue verified NFL availability and closing-price evidence work; require
   stronger out-of-sample evidence before any real-money model promotion.

## Previous college workflow — college-day-scan-4

The main college control now scans a selected **Central calendar day**, not a
single selected game or rolling 24-hour window. One bulk spreads/totals request
costs up to 2 credits, with five-minute reuse across dates. The game dropdown is
inside an optional inspection section. Empty days, feed failures, missing odds,
identity/time conflicts and price-test rejections have separate explanations.

Independent schedule coverage is checked. September 3 has 10 provider games
plus Rutgers–UMass missing from that feed. September 5 has 68 provider games;
two source kickoff conflicts remain deliberately blocked. These are snapshot
observations, not permanent schedule guarantees.

College manual paper saving, grading, source replay and export now use the
shared audited lifecycle with separate college IDs/rules/records. No NFL model
coefficients were copied. **No validated college recommendation model is enabled.**
The exact-line price shortlist is research, not a betting recommendation.

115 automated tests and the server build pass; the current dependency audit is
clear after a targeted `qs` security patch. Deployment and live verification are
documented in [the college scan release report](research/COLLEGE_DAY_SCAN_2026_09_02.md).
Commit `c7b7cab` is live, verified September 2 around 6:15 PM Central. Production
day scans checked 10 games for Thursday and 68 for Saturday; source gaps are
shown, and neither price-research shortlist qualified a selection. Local/live
testing used 4 odds credits total, leaving 19,990. Pick/backup hashes are unchanged.

**Billing resolved:** Owner confirmed payment fixed on September 2. Website
health rechecked at 6:24 PM Central: HTTP 200, `college-day-scan-4`. The billing
dashboard itself was not rechecked; no payment details were changed by the agent.

## Previous research/tracking update — football-research-3

See the [tested changes and ordered next steps](research/NFL_RESEARCH_RELEASE_2026_08_31.md).
The new release adds plain-language website guidance, verified recent team
attempt/target-share context, archived grading sources, read-only result replay
and paper-record export. A separate fixed-cohort shadow test produced 77 stat
forecasts over 33 games; results were mixed and no new formula was promoted.
96 tests pass. Commit `61321f9` is live on Render as of August 31 at **10:44 AM
Central**; authenticated production checks passed. Zero odds credits consumed;
19,853 remain. Deployment evidence is recorded in that release report.

Automatic recommendations remain blocked by missing verified game-specific
availability; this source is not yet connected. No additional subscription was
purchased. NFL manual paper tracking remains usable, college remains quote-only,
and the original records/backups are not restored or reset.

## Previous safety/tracking update — football-foundation-2

The requested 13-item roadmap is **partially implemented, not complete**. See the
[item-by-item implementation status](research/IMPLEMENTATION_STATUS_2026_08_31.md).
Spread/ATS/probability/weather safety repairs, exact no-vig price comparisons,
paper probability/performance metrics and audited stat rechecks are implemented.
The website now has a visible 13-item readiness checklist.

Important change: automatic NFL model paper issuance now requires verified
game-specific availability; that feed is not connected. Forecast diagnostics and
manual paper tracking remain available. Legacy specialty models are paused in
the API/CLI/UI. Rich workload/opponent inputs, actual weather venues/roofs,
unseen holdout/ablation testing, guaranteed closing capture and college model
validation remain open. No tracking reset or old-record restoration occurred.

Release `e07bc17` live August 31 at 8:10:32 AM Central. 83 tests,
server-inclusive TypeScript build and JS syntax pass; dependency audit reports
zero vulnerabilities. Live login/API/health/schedules/paused commands verified.
Official ledger, absent paper file, legacy ATS and 329-pick backup fingerprints
are unchanged. No paid odds calls were needed. Full verification is in the
release status report.

| # | Item | Status / remaining work |
|---|---|---|
| 1 | Website, login, deployment | Foundation release `e07bc17` live August 31, 2026, 8:10 AM Central. Live health/new assets, login, 15 NFL and 96 college games, empty paper audit and paused-model API guards verified. Credentials unchanged. |
| 2 | Find all required accounts | Active Render + GitHub + Odds API are the required stack. ESPN public feeds need no account. Old suspended Render web/database/cron services are not dependencies; leave them paused. |
| 3 | Football-only production | NFL primary; college spreads/totals only. Dedicated **College football — spreads & totals** button opens upcoming-game discovery and quotes, separate from the existing game-day scan. Other sports paused. Earlier records remain in the untouched reset backup. |
| 4 | NFL market coverage | 16 on-demand quote categories, next 14 days, freshness and credit controls. Availability varies; not every sportsbook special, future or live market is supported. |
| 5 | NFL player context | Current ESPN rosters/IDs, injury flags, provisional depth and attempts/targets available. Game-specific official active evidence is now required for auto model picks and is not connected; diagnostics/manual paper remain available. |
| 6 | Core prop model audit | Four baseline stat forecasts retained; v2 tightens availability gating, not forecast equations. Frozen v1 conditional pilot stays 3 wins, 4 losses, 2 REVIEW; −1.3214 units on 7 settled selections. Archived availability and 22/68 identities unresolved. Not a verified live-policy replay. |
| 7 | Result grading | Exact-ID supported core/period paper grading; missing data requires review. New last-14-day stat-correction button preserves original picks and grading audit. Book-specific participation/settlement and unsupported specialties remain unfinished. |
| 8 | NFL paper performance | Eligible Forecast + track recommendations auto-save the original quote/model before display. Separate model/manual season/market/version W/L, push, pending, review and unit returns. Fresh prospective sample still needs collecting; no validated NFL accuracy claim. |
| 9 | Closing prices and calibration | Exact-line last-five-minute observation/missed counts, Brier/log loss/calibration bins, drawdown and game-cluster diagnostics added. No automatic final close collection or completed holdout calibration. Do not call observations true CLV. |
| 10 | Weekly operation and expansion | Manual NFL paper runbook available; model issuance is availability-blocked. College quote board stays open. Legacy parlay/TD/teaser recommendation engines disabled pending validation. |

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

For college: click **College football — scan + track + grade**. It scans today,
saves qualifying experimental paper spreads and grades eligible saved games.
Check coverage and confidence warnings. Optional date/preview and single-game
tools stay separate. No unattended grading or overnight schedule is configured.
Refresh the website after deployment to replace the old college scan button.

## Verification evidence for this release

- College-board / historical-pilot release: all 65 automated tests and TypeScript build passed. Browser verified the named college entry, 96 upcoming games, 38 UMass–Rutgers quotes, 4 BetMGM filter results and a free cached repeat. Browser inspection also corrected the heading's sticky-menu offset and expanded the game selector to full width. Isolated API checks: login 200, anonymous college access 401, invalid/out-of-scope college requests 400, official and NFL paper ledgers both zero. The college board never creates picks.
- Live release `dec0648ebb6e8e65f2a71821b2745036e7f09566`: Render live at 7:28:09 AM Central on August 31. Public health/new JavaScript verified; anonymous college endpoints return 401. Authenticated checks returned login 200, 96 games, odds 200 with 38 quotes limited to spreads/totals, cached repeat true and invalid/out-of-scope requests 400. Official and NFL paper records remain zero; before/after ledger fingerprints are identical. Pilot plus local/live college QA used 85 credits total (81 + 2 + 2), with 19,853 remaining at the final odds check. No backups, credentials or model safety gates were changed.
- All 50 automated tests and the TypeScript build passed; production dependency audit reported zero vulnerabilities on the model release. Tests exercise market scope, identities, stale quotes, kickoff boundaries, NFL-specific statistics, missing data, rolling no-lookahead forecasts, persistence before issuance, concurrent duplicate protection, regulation periods vs overtime, report denominators and retries. Three UI regression tests additionally check the visible forecast entry point, first-column actions and paper-rules focus.
- First fixed-cohort historical stat audit: 96 correlated forecasts across six evaluable player/market pairs; workload beat baseline on three pairs and lost on three. Two additional pairs lacked usable source data. This is not a betting backtest, win rate or ROI. Full method and all results: [NFL_FORECAST_V1.md](NFL_FORECAST_V1.md).
- Local browser QA issued one automatically logged model paper recommendation, returned the same original on repeat, reopened its original evidence and left the separate official log at zero. Synthetic final-game tests verified grading and model/manual report separation. No QA selections are copied to production.
- Live read-only source checks matched a current NFL player to his current roster and upcoming ESPN event, separated 2026 zero completed regular-season games from 2025 history, and surfaced a current injury flag.
- Historical ESPN game 401772798 (Chargers at Chiefs, December 14, 2025) returned Patrick Mahomes passing yards 189, Q1 total 10 and second-half regulation total 6; the paper evaluator matched all three.
- Local browser QA uses isolated temporary storage; its test selections must never be copied into production.
- Production verified: healthy HTTP 200, authenticated login, 15 upcoming NFL games, zero paper test records, exact player/depth/history data, and HTTP 400 for an invalid paper selection. Anonymous paper access returns HTTP 401.
- Workload-release production verification: HTTP 200 health/assets/login, HTTP 401 anonymous forecast access and HTTP 400 invalid authenticated forecast request. Read-only live forecast inputs returned 30 same-team games and 22 rolling tests. Official and paper logs each remained at zero; storage is `/var/data/snapshots`. No production forecast was issued for QA. Local QA server stopped and isolated test tab closed.
- Visibility fix verified: named main-menu entry, green sticky first-column actions, core props listed before specialty quotes, and paper-rules box above the table. Local browser checked against posted odds without issuing a pick; deployed HTML/JavaScript and health returned HTTP 200. All 50 tests passed; local QA server stopped.

## Intentional fresh start — confirmed by owner

The owner confirmed that the reset was intentional. Keep the fresh active record; do not restore or merge the older picks into it. At the final deployment check, the active log contained zero records. Its timestamp and reset backup show that it was cleared at **August 30, 2026, 7:42 PM Central**, before release `fedb4da` deployed around 8:24 PM Central. The backup `/var/data/snapshots/reset_backups/reset_2026-08-31_00-42-47/picks_log.json` was read and verified to contain **all 329 earlier picks**. Retain that backup untouched for reference and recovery. No reset, deletion or restoration was performed in this work.

## Where things live

- Website/hosting: Render `sports-betting-engine-1`, service `srv-d7c6qpcp3tds739nn2tg`.
- Source: GitHub `ginnconstruction-boop/sports-betting-engine`, branch `main`, app root `sports-betting-engine`.
- Durable data: Render disk `/var/data/snapshots`, including new `nfl_paper_picks.json`; existing `picks_log.json` remains separate.
- Configuration: active Render environment (`ODDS_API_KEY`, dashboard credentials, `SNAPSHOT_DIR`, etc.). Do not commit or share secrets.
- Recovery: preserve existing daily Render disk snapshots and export important paper history before significant future schema changes. Deploying code is not a database backup.

## Previous NFL unresolved-work notes (see current priorities above)

August 28 preseason research completed separately: archived game lines and final results recovered for all ten games; zero prices qualified in the frozen consensus-price experiment. A separately labeled favorite benchmark went 4–3 and lost 0.6878 units. Preseason player props are not covered by the provider, so this did not validate the regular-season prop model. No production picks changed. See [full research report](research/AUGUST_28_2026_BACKTEST_REPORT.md).

December 7, 2025 regular-season pilot completed August 31, 2026: two predetermined games, 250 target-book quotes, 68 player/market pairs, nine locked conditional selections. Result: 3–4 with two unresolved Tipton selections, −18.88% ROI on seven settled one-unit stakes. Historical availability gates could not be evaluated; do not present this as the live model's record. The pilot used 81 credits. [Full report and next steps](research/REGULAR_SEASON_PROP_PILOT_REPORT.md).

Priority queue: (1) historical identity/availability completeness, (2) participation-aware missing-stat review, (3) larger fixed evaluation/calibration split, (4) prospective 2026 paper results and closing-price evidence, (5) college model/settlement validation. NFL remains the primary focus. A usable college quote board does not mean the college recommendation model is validated.

The first experimental workload forecast and paper-tracking loop are implemented. Reliable participation/snap exposure, role-change/opponent adjustments and independent odds-aware validation remain the largest gaps. Descriptive History stays separate from Forecast + track. Confirmed game-day availability and fresh 2026 results cannot be established in advance. Collect prospective model results, finish verified closing snapshots and probability calibration, then validate college/specialty markets. No profit or readiness-for-real-money claim is supported yet. Grading is on demand; unattended scheduling is not configured.
