# College score-model paper release — September 2, 2026

Target: Thursday September 3 games. Release marker `college-model-paper-1`.

## Decision

Enable an explicitly acknowledged **experimental paper spread** workflow, not
real-money betting advice. Totals remain projection/research-only. NFL model
availability gates and all existing records remain unchanged.

The frozen score model passed its spread baseline gate but failed its total
baseline gate. Historical spread ROI was positive; probability calibration
failed. This is not a validated profitability or calibrated win-chance claim.

## Frozen method and results

Protocol: `COLLEGE_MODEL_PROTOCOL_2026_09_02.json`, registered before examining
2025 results. ESPN FBS/FCS monthly scoreboards, August–December, regular season
only; numeric IDs, verified home/away and neutral venue. Completed scores only.
Exact overlapping sources deduplicated; conflicting scores/IDs refused.

Two team scoring observations per game fit ridge offense/defense, intercept
and home advantage. Current/prior season only, prior-season weight 0.65, calendar
recency decay. Minimum six games per team, twelve-hour result availability lag.
Rankings, current news/injuries, winner flags and target/future outcomes are not
features. Past results fetched today can include corrections: this is a
reconstruction, not an as-seen historical data archive.

2024 development: 1,418 eligible games; 69 excluded. Six predefined configurations.
Chosen ridge 1 / half-life 365 days, locked at `2026-09-02T23:36:38.170Z`.
No retuning after holdout.
The same scoring model and quote-selection modules are hash-checked in production.

| 2025 chronological holdout | Margin | Total |
| --- | ---: | ---: |
| Eligible games | 1,565 | 1,565 |
| Model RMSE (points) | 17.149 | 15.903 |
| Same-cohort naive RMSE | 19.705 | 15.717 |
| Model MAE (points) | 13.381 | 12.799 |
| Same-cohort naive MAE | 15.300 | 12.675 |
| Initial paper gate | Pass | Fail |

73 games were excluded for insufficient team history. Daily chronological refits
used only information earlier than each forecast cutoff. No NFL coefficients.

## Fixed historical odds test

Six dates fixed before results: 2025-09-06, 09-20, 10-11, 10-25, 11-08, 11-22.
12:00 UTC snapshots, US spreads/totals; six calls at 20 credits = **120 credits**.
329 provider games, 318 projected, 11 identity/history exclusions. 206 spread
selections, zero totals selections. Every forecast/quote was frozen before the
separate grading invocation. No alternate dates or threshold tuning.

Fixed thresholds: at least 3 model-to-line points, 3 percentage points of
experimental conditional probability gap, 0.04 estimated EV; valid American
prices -200 to +180; fresh FanDuel/BetMGM quotes. One selection/event/market/version.
Probabilities use only 2024 rolling residuals, with integer pushes represented.

**113 wins, 93 losses, 0 pushes, 0 unresolved; +10.994 hypothetical units;
5.337% ROI.** Win rate 54.85%; illustrative 95% Wilson interval 48.03–61.50%.
The interval assumes independent trials and does not remove common-date/model
correlation. Three of six dates lost units; max sequential drawdown 11.36 units.

| Date | Picks | W–L | Paper units |
| --- | ---: | ---: | ---: |
| Sep 6 | 58 | 30–28 | -0.378 |
| Sep 20 | 43 | 21–22 | -2.550 |
| Oct 11 | 28 | 15–13 | +0.938 |
| Oct 25 | 24 | 17–7 | +8.565 |
| Nov 8 | 24 | 17–7 | +8.481 |
| Nov 22 | 29 | 13–16 | -4.063 |

**Calibration failed:** mean forecast win probability 67.04%, observed 54.85%.
Brier error 0.27844, worse than 0.25 for a constant 50% prediction. The 90–100%
bin won 1 of 4; high modeled confidence is not a trustworthy win chance. The
website warns about this and does not display these probabilities as confidence
ratings or recommend stakes. Positive sample ROI does not override this failure.

## Operation and safeguards

Choose a Central date in College football. Leave the paper checkbox unchecked
for a preview; check it explicitly and scan to record qualifying experimental
spreads. No single-game selection required. Record the exact original line,
book, odds, model/version, IDs, probabilities, score projection and input/source
hashes before displaying a saved recommendation. Repeat scans return the first
selection unchanged, even if later lines or sides change.

Model evidence is content-addressed on the durable Render disk. The existing
separate college ledger supports final-score grading (including OT), pushes,
REVIEW, corrections, forecast/result replay and exports. Exports include
normalized forecast inputs and up to 25 MiB of forecast/settlement evidence;
raw current-season scoreboard sources remain on server disk. No real bets.
No unattended scans, automatic grading or guaranteed closing-price capture.

Missing fresh quotes, identities, venue/history or functioning storage blocks
issuance. Prior-season bundle expiry blocks a new season pending review.
Monthly FBS/FCS current results are fetched on demand and reused for an hour;
no paid historical requests occur during website scans. One bulk current odds
pull costs up to two credits, cached across dates for five minutes.

Thursday local verification: 10 provider games / 11 independent games; all 10
projected and passed paper spread thresholds. UMass–Rutgers remains missing from
the odds feed. No substitute odds or pick inferred. Ten paper records were saved
**only in isolated QA storage**; repeated scan retained ten original picks and
original forecast replay matched. Actual market quotes may change by Thursday.

## Verification and deployment

- 126 automated tests and TypeScript build pass; JavaScript syntax passes.
- Dependency audit: zero vulnerabilities.
- Local authenticated endpoint smoke: health/model status 200, anonymous 401,
  forged or invalid/non-boolean requests 400; separate ledgers protected.
- Browser: full-day date/checkbox controls, ten saved paper cards, unchanged
  duplicate records, original forecast replay and separate W/L table verified.
- Historical audit 120 credits; local full-day QA 2 credits; cached repeats 0.
  Last observed balance after local QA: 19,866. No subscription/billing changes.
- Production deployment/live smoke: pending final verification below.

Raw research archives and locks: ignored local `snapshots/college-model-v1/`.
Portable normalized 2025 history, fixed configuration, 2024 residuals, score
holdout and odds summaries: `src/data/college-score-ridge-v1.json` (403,803 bytes),
SHA-256 `4b30c269515f545f0eea031deb24ba1fa6083a77d3377029c1cb664acc83c6c4`.
Calibration detail: `src/data/college-score-audit-details.json`.

## Ordered next work

1. Collect prospective paper results with original prices and review missing games.
2. Fix probability calibration on a newly declared development split; reserve a
   genuinely untouched later evaluation period. Do not retune to this holdout.
3. Add historical/as-of roster turnover, starting-QB/injury and venue/weather
   evidence; test each input rather than assuming it improves predictions.
4. Diagnose totals independently; leave model total selections blocked meanwhile.
5. Evaluate full-book closing-line evidence, subgroup coverage (including FCS
   mismatch games), costs and sufficiently large out-of-sample results before
   proposing any real-money promotion. Continue NFL availability work separately.
