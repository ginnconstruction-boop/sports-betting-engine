# College safety/context v2 — protocol registered before implementation

## Architecture and reuse

- `collegeScoreModel.ts` remains the hash-locked v1 score engine. Its historical
  forecasts and residuals are not rewritten. `collegeModelQuotes.ts` remains the
  frozen historical selection comparator, not the new authorization layer.
- `collegeResearch.ts` delegates names to a canonical-ID resolver. Scoreboard
  identity retains date, season, orientation and venue checks. Provider omissions
  are not alias failures and cannot be repaired by inventing odds.
- New `collegeContext.ts` supplies dated roster feature validation, an explicit
  early-season blend, and a quality-varying mismatch-adjustment interface. No
  fitted roster coefficients or verified QB/transfer feed currently exists.
  Unavailable adjustments return null, not zero; live score changes stay blocked.
- New `collegeSafety.ts` is the sole v2 paper qualification/labeling layer around
  `collegePredictions.ts`. It records market consensus, disagreement, context
  completeness and missing checks. Extreme discrepancy lowers reliability.
- New `collegeCalibration.ts` implements logistic/Platt and isotonic calibration,
  chronological eligibility, reliability buckets, Brier, intercept and slope.
- Existing `NflPaperLedger`/`NflEvidenceArchive` retain the audited save/grade/
  replay/export lifecycle. New observations and safety evidence are append-only;
  old opening forecasts/quotes are never replaced. College monitor records are
  separated from qualified paper BET/LEAN records and from NFL/official totals.
- New `collegeClv.ts` measures observed spread movement and exact-line price CLV
  separately from outcomes. Morning quotes are not closing lines. Final-five-
  minute observations are explicitly proxies, never verified final closes.

## Predeclared evaluation

1. Replay the unchanged v1 chronological 2025 score evaluation and verify its
   rows against the original. This is an already-inspected historical diagnostic,
   NOT another untouched holdout. Do not tune against it or September 3 games.
2. Calibration: the first three already-fixed odds dates (Sep 6, Sep 20, Oct 11,
   2025) train each calibrator; the last three (Oct 25, Nov 8, Nov 22) evaluate
   both on identical frozen v1 selections. Exclude pushes from conditional win
   calibration; retain them in ATS/ROI. No selection optimization or winner-based
   calibrator promotion. Also report rolling fits using earlier resolved days only.
3. Deployment approval remains FALSE. Future calibration approval requires a
   separately registered prospective test, >=200 training and >=200 evaluation
   non-push games, Brier <=0.245 and below raw, slope 0.8–1.2, absolute intercept
   <=0.15, and populated reliability buckets. These are conservative governance
   criteria, not statistical guarantees. Isotonic needs substantially more data.
4. Roster blend policy (unfitted, diagnostic until validated): prior equivalent
   games = 6, 4, 2 for weeks 1–3, 4–6, 7+; current weight = effective current
   games / (effective games + prior equivalent games). Effective games = prior-
   cutoff current-season sample times verified sample quality [0,1]. Missing
   quality is zero, not a silently strong sample. Weights are configurable,
   versioned, documented heuristics; no claim they improve predictive accuracy.
5. Context point adjustments require dated features AND a separately fitted,
   validated coefficient artifact with training cutoff before prediction. No
   fixed FBS bonus; mismatch terms interact talent/depth/conference/quality with
   FBS/FCS status. No scholarship counts assumed across rule changes.
6. Market absolute disagreement: <3 normal, [3,6) meaningful, [6,10) large,
   >=10 extreme. Boundary convention is explicit. Extreme + missing context ->
   MODEL WARNING; missing roster/QB or weak early sample -> PAPER MONITOR.
   These safety thresholds are not optimized against ATS results.
7. Report all requested spread buckets, FBS/FBS vs FBS/FCS and weeks 1–3/4–6/7+.
   Unknown classification/week is its own bucket. Season-scoped conference
   metadata fetched now is retrospective descriptive data, not an archived
   pregame roster input. Missing historical closes -> CLV unavailable, not zero.
8. Totals, real-money recommendations and Kelly/stake sizing stay disabled at
   both qualification and persistence boundaries. Future totals approval needs
   a new declared holdout >=500 games with >=2% RMSE improvement over baseline;
   passing code tests alone never promotes any model.

## Sources and unavailable inputs

Calibration methods and disjoint-data caveats:
https://scikit-learn.org/stable/modules/calibration.html

Potential future roster/returning-production/talent source (no credential is
configured, no subscription purchased): https://collegefootballdata.com/api-tiers

ESPN season-specific conference hierarchy provides FBS/FCS classification, not
verified starters, transfer impact, coaching scheme, depth or historical injuries.
No source currently supplies all those dated inputs in this project.
