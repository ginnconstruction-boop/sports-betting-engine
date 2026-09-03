# College safety/context release — September 3, 2026

Release marker: `college-safety-2`.

## Outcome

The frozen `college-score-ridge-v1` score engine and its original historical
audit were retained. A new fail-closed layer now sits between its projection and
paper persistence. It produces PAPER BET, PAPER LEAN, PAPER MONITOR, PAPER PASS
or MODEL WARNING. With current missing roster/QB inputs and failed calibration,
the September 3 scan produces no qualified BET/LEAN selections. Monitor-only
observations can be saved prospectively so the model cannot discard difficult
games, while warnings are archived separately and do not enter the pick ledger.
No real-money recommendation, Kelly/stake sizing or total paper pick is possible.

Architecture and predeclared methods are in
[`COLLEGE_CONTEXT_PROTOCOL_2026_09_02.md`](COLLEGE_CONTEXT_PROTOCOL_2026_09_02.md).

## Implementation

- `collegeContext.ts`: dated current-season roster/QB schema and validation,
  transparent week blend, season-specific FBS/FCS lookup, immutable operator
  imports, and quality-varying coefficient interface. Coefficients and point
  adjustments remain inactive because no qualifying dated data/fitted artifact
  is available. Missing inputs reduce confidence and are never encoded as zero.
- `collegeSafety.ts`: fresh multi-book consensus, explicit 3/6/10-point market
  disagreement boundaries, provider/identity/venue/sample/context validation,
  mismatch and huge-FCS-underdog warnings, conservative classifications and
  hard no-money/no-Kelly/no-stake/no-totals outputs.
- `collegeCalibration.ts`: time-aware Platt and PAV isotonic research fitting;
  training only on results resolved before each cutoff; Brier, intercept, slope
  and six reliability buckets. The artifact is integrity checked and explicitly
  unapproved. Runtime raw probabilities are labeled uncalibrated; research
  calibrated values are paper-only diagnostics.
- `collegeEntities.ts`: canonical ESPN identifiers, explicit aliases (including
  Massachusetts/UMass variants and program renames), exact normalized matching,
  provider-ID priority and fuzzy suggestions that never auto-resolve.
- `collegeClv.ts`: append-only same-book line/price observations and separate
  spread/price CLV reports. Only final-five-minute observations are called a
  closing proxy; no provider offers a verified final close here. Missing CLV is
  unavailable, not zero. No background closing-time odds request was added.
- `nflPaper.ts`: v2 safety evidence and opening hashes, canonical-game duplicate
  prevention, append-only line evidence, replay of model/context/line evidence,
  and altered-opening refusal. Existing grading audits and v1 records remain
  readable. Manual college totals are also disabled; old totals can still grade.
- `collegePredictions.ts`/`collegeDayScan.ts`: full-slate diagnostics, all-game
  warning evidence, repeated huge-underdog warning, separate qualified and
  monitor collections, canonical duplicate-game detection. Scan first/grade
  afterward and paid-request limits are unchanged.
- `footballGuardrail.ts`/`closingLineTracker.ts`: old generic college A+/score/
  Kelly and official-pick paths fail closed. NFL behavior is unchanged.
- `college-markets.js`/`index.html`: per-game market/model/context/reliability/
  classification diagnostics, calibration buckets, CLV report and explicit
  NO RELIABLE EDGE, monitor, totals and uncalibrated-probability labels.
- Conference registry was captured from season-scoped ESPN metadata for 2023–26.
  This supplies classification only—not roster quality, starters or injuries.
- `collegeSafetyAudit.ts` replays existing chronology without paid requests;
  `collegeSlateSafetyCompare.ts` replays one archived slate; both write new
  evidence and refuse to rewrite existing results. Scoped ESLint was added.

## Historical evaluation

The unchanged 2025 chronological score rows replay byte-for-byte at the row
level. This is previously inspected data, not a new untouched holdout.

| Metric | Before | After |
|---|---:|---:|
| Spread RMSE | 17.1491 | 17.1491 (raw score model unchanged) |
| Simple spread baseline RMSE | 19.7054 | 19.7054 |
| Total RMSE | 15.9028 | 15.9028 (still failed/disabled) |
| Total baseline RMSE | 15.7168 | 15.7168 |
| Fixed-date ATS | 113–93 | 0 qualified v2 bets; monitors/warnings not relabeled as bets |
| Fixed-date hypothetical units/ROI | +10.994 / 5.337% | unavailable for v2 until prospective qualified picks exist |

FBS/FCS score diagnostics expose a structural concern: 126 games had RMSE
24.266 versus 17.149 overall, and the signed home-orientation residual was large.
This is evidence for caution, not enough to estimate a blanket correction.
FBS-vs-FBS RMSE was 16.746 on 1,436 games; three were UNKNOWN classification.
The saved evaluation also reports score RMSE by weeks 1–3/4–6/7+ and ATS/ROI
by spread buckets 0–3, 3.5–7, 7.5–14, 14.5–21, 21.5–30, 30.5–40 and 40+.

Calibration uses the first three fixed dates for training (129 non-push games)
and the last three for evaluation (77). The sample fails the predeclared minimum
and neither calibrator improves raw Brier on the identical later games:

| Probability | Brier | Calibration intercept | Calibration slope |
|---|---:|---:|---:|
| Raw | 0.243234 | 0.5468 | -0.1834 |
| Platt | 0.243733 | 0.3422 | 0.8249 |
| Isotonic | 0.286515 | 0.4520 | 0.0030 |

The negative raw slope is a major warning despite raw Brier being below 0.25 on
this small period. Rolling chronological Brier was 0.247847 for Platt and
0.263807 for isotonic across 148 available predictions. The complete six-date
raw result remains Brier 0.278422, mean 67.20% versus 54.85% observed. Neither
method is approved or used for Kelly/stakes.

Historical CLV is unavailable: the six archives are morning snapshots, not
closing snapshots. The implementation did not call those morning lines closes.

## September 3 comparison

On an identical archived September 3 snapshot, all 10 old candidates retain the
same raw scores and lines. Under v2 they become 5 PAPER MONITOR observations and
5 MODEL WARNING games, with 0 qualified PAPER BET/LEAN picks. This comparison is
reconstructed policy replay, not a new forward cohort.

Warnings: Merrimack–Delaware, Bethune-Cookman–UCF, Colorado–Georgia Tech,
Arkansas-Pine Bluff–Missouri, and Eastern Illinois–Minnesota. Reasons are extreme
market disagreement plus missing verified roster/QB context. The other five are
monitor-only because context/calibration remain inadequate.

A fresh isolated browser QA scan later found 11 provider games (the previously
omitted UMass–Rutgers game was now present and matched correctly), 11 games with
fresh odds, 5 saved monitor observations, 5 warnings and 0 qualified bets. That
one QA bulk pull used 2 odds credits; no production pick was created.

## Verification and remaining weaknesses

- TypeScript build/typecheck, scoped lint, JavaScript syntax and dependency audit
  pass. 146 automated tests pass (0 fail), including identity aliases, duplicate
  canonical games, classifications, timestamps, FBS/FCS, blend boundaries,
  missing/impossible roster data, Platt/isotonic chronology, reliability buckets,
  total/Kelly/legacy bypasses, immutable openings/replay, CLV signs, staleness,
  kickoff exclusion and all prior tests.
- Browser QA shows the real per-game diagnostics and one-click save/grade path.
- No current data source in the project verifies returning production, starters,
  transfers, recruiting/talent, coaches/schemes, depth, injury/QB status and
  point-in-time historical versions together. A future licensed/credentialed
  source and independent development/holdout protocol are required before point
  adjustments or qualified recommendations can be enabled.
- FCS quality, garbage time and substitution behavior are represented in the
  schema but have no valid coefficients. No fixed FBS bonus was invented.
- Weather remains unavailable to this college model. Calibration and CLV remain
  unapproved. Prospective samples, verified context coverage and verified closes
  are the next data dependencies. Real-money and totals stay disabled.

## Production deployment

Commit `f7d816aad033c1c9f5fe7021cd1c0c0d4b374ced` deployed successfully on
Render as deploy `dep-dacrn2p5efls73cp1e80` at September 3, 2026, 1:25:15 PM
Central. Public health returned HTTP 200 with release marker
`college-safety-2`; the versioned JavaScript and page both contained the new
diagnostic/NO RELIABLE EDGE interface, and anonymous protected access returned
HTTP 401.

The authenticated production smoke suite passed with zero paid odds calls and
zero created picks. It exercised protected exports/replays plus fail-closed
invalid NFL forecast and college scan/paper requests. The current-day production
one-click scan was deliberately not invoked for deployment QA because the full
behavior had already passed in an isolated browser test; invoking it would have
spent two more odds credits and created production monitor observations.

Pre/post-deploy production data fingerprints were identical: the active general
pick log remained empty; NFL and college paper ledgers remained absent; the ATS
database remained at 58 records; and the intentional-reset backup remained at
329 records. No result, backup, credential or saved recommendation was changed
by the release.
