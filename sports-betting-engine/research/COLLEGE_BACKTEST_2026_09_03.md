# College football September 3, 2026 outcome review

Reviewed September 4, 2026 (America/Chicago).

## Bottom line

The five exact production **WATCH / PAPER MONITOR** lines finished 3–2 for
**+0.80 hypothetical units** at the saved prices (15.9% for this five-play
sample). These were observations, not official recommendations, and the sample
is much too small to establish profitability.

The wider diagnostic result was weaker: all ten raw model directions finished
4–6 for -2.29 hypothetical units. The five games the safety layer had already
blocked as **MODEL WARNING** finished 1–4. The system was right not to promote
those directions.

No score coefficient, team rating, probability, or qualification threshold was
tuned to this one slate. The only change is a general fail-closed safety rule:
**an FBS/FCS matchup without a validated depth/talent adjustment is MODEL
WARNING, diagnostic-only, and cannot enter the paper W/L ledger.**

## Exact production WATCH lines

These lines and prices came from the saved production scan shown before kickoff.
One hypothetical unit risks 1.00 unit; a win returns the price-implied profit.

| Game | Saved direction | Final | ATS result | Hypothetical units | Absolute model margin error |
|---|---:|---:|---:|---:|---:|
| West Georgia at Kennesaw State | West Georgia +21.5 (-110) | Kennesaw State 47–0 | Loss | -1.00 | 34.13 pts |
| Albany at Buffalo | Albany +18.5 (-110) | Buffalo 21–17 | Win | +0.91 | 6.09 pts |
| Akron at Wake Forest | Akron +27.5 (-104) | Wake Forest 38–16 | Win | +0.96 | 2.16 pts |
| UAB at Illinois | UAB +27 (-108) | Illinois 42–23 | Win | +0.93 | 3.01 pts |
| Idaho at Utah | Idaho +37 (-108) | Utah 66–14 | Loss | -1.00 | 21.67 pts |
| **Total** |  |  | **3–2** | **+0.80** | **13.41 pts mean** |

## Blocked warning directions

These were never official paper picks. Their lines come from the frozen pregame
diagnostic reconstruction because warnings were correctly excluded from the
production paper ledger. They are included only to test the safety decision.

| Game | Diagnostic direction | Final | ATS diagnostic | Hypothetical units | Absolute model margin error |
|---|---:|---:|---:|---:|---:|
| Merrimack at Delaware | Merrimack +28.5 (-105) | Delaware 42–7 | Loss | -1.00 | 23.51 pts |
| Bethune-Cookman at UCF | Bethune-Cookman +42.5 (-110) | UCF 73–6 | Loss | -1.00 | 54.15 pts |
| Colorado at Georgia Tech | Georgia Tech -6.5 (-110) | Colorado 14–13 | Loss | -1.00 | 18.62 pts |
| Arkansas-Pine Bluff at Missouri | Arkansas-Pine Bluff +54.5 (-110) | Missouri 54–14 | Win | +0.91 | 8.61 pts |
| Eastern Illinois at Minnesota | Eastern Illinois +42.5 (-108) | Minnesota 59–7 | Loss | -1.00 | 34.94 pts |
| **Total** |  |  | **1–4** | **-3.09** | **27.97 pts mean** |

Massachusetts at Rutgers was a **PASS** and had no saved exact paper line, so it
is not assigned a retrospective ATS result. Massachusetts won 37–21.

## What the slate taught us

- The five WATCH observations did well, but `n=5` is not actionable proof.
- Seven FBS/FCS games had a mean absolute margin error of about 26.16 points;
  the three FBS/FBS games were about 7.93 points. This is a warning about missing
  matchup context, not evidence for a new fixed point adjustment.
- The broader chronological audit already showed the same risk: raw selected
  FBS/FCS directions were 12–22 for -10.95 hypothetical units across 34 games.
- Therefore the system now blocks every unadjusted FBS/FCS direction as MODEL
  WARNING. It does not guess a talent adjustment when reliable data is absent.
- Totals, Kelly sizing, real-money advice, and uncalibrated probability remain
  disabled.

## Before and after evaluation

The chronological score evaluation did not change because the score model did
not change:

| Metric | Before | After |
|---|---:|---:|
| 2025 spread RMSE | 17.149 | 17.149 |
| Spread baseline RMSE | 19.705 | 19.705 |
| Total RMSE (research only) | 15.903 | 15.903 |
| Total baseline RMSE | 15.717 | 15.717 |

The safety replay changed 10 historical diagnostics from PAPER MONITOR to MODEL
WARNING: warnings increased from 55 to 65 and monitors decreased from 151 to
141. No result record was rewritten, and old paper snapshots continue to replay
under their original archived safety version.

## Sources and audit boundaries

Final scores were checked against the [CBS Sports college football schedule](https://www.cbssports.com/college-football/schedule/),
with additional checks from the [NCAA FBS scoreboard](https://www.ncaa.com/scoreboard/football/fbs),
[Illinois athletics](https://fightingillini.com/sports/football/stats/2026/uab/boxscore/29206),
[Utah athletics](https://utahutes.com/sports/football/stats/2026/idaho/boxscore/23862),
and [Rutgers athletics](https://scarletknights.com/news/2026/9/3/football-loses-to-umass).

This review grades the lines that existed before kickoff. It does not claim
those prices were universally available at close, does not reconstruct a bet
after the result, and does not treat warning diagnostics as selections.
