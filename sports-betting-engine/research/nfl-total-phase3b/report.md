# NFL Phase 3B — Totals Model Research and Market Benchmarking

Generated: 2026-09-08T16:10:00.000Z

## A. TOTAL MODEL A FORMULA

{
  "version": "nfl-game-line-ridge-research-v2-audit-metrics",
  "config": {
    "version": "nfl-game-line-ridge-research-v2-audit-metrics",
    "ridge": 3,
    "halfLifeDays": 180,
    "frozen": true
  },
  "formula": "Two-score ridge projects home and away points separately from league intercept, team offense, opponent defense, and learned home advantage; Total Model A is projected home points plus projected away points.",
  "features": [
    "same-season and prior-season earlier final scores",
    "team offense identity",
    "opponent defense identity",
    "home/neutral venue"
  ],
  "weights": "current season 1.0, previous season 0.65, 180-day half-life",
  "fallback": "Requires at least 100 league games and six prior appearances for both teams; otherwise MODEL_UNAVAILABLE.",
  "earlySeason": "previous season enters at 0.65 without roster or pace continuity.",
  "QB": "not numeric",
  "weather": "not numeric",
  "pace": "not numeric",
  "marketContamination": false
}

## B. TOTAL MODEL A FEATURE AUDIT

[
  {
    "feature": "team offense / opponent defense",
    "source": "earlier final scores",
    "safety": "RECONSTRUCTED_WITHOUT_FUTURE_INFO",
    "transformation": "regularized chronological scoring components",
    "coefficient": "fitted team coefficients",
    "fallback": "MODEL_UNAVAILABLE",
    "missing": "row excluded"
  },
  {
    "feature": "home field",
    "source": "nflverse location",
    "safety": "SAFE_HISTORICAL_SNAPSHOT",
    "transformation": "learned and split across two team-score equations",
    "coefficient": "fitted",
    "fallback": "zero neutral",
    "missing": "invalid game"
  },
  {
    "feature": "QB",
    "source": "revised final starter",
    "safety": "UNAVAILABLE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "QB_CONTEXT_UNAVAILABLE"
  },
  {
    "feature": "pace/pass-run/OL",
    "source": null,
    "safety": "UNAVAILABLE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "MODEL_UNAVAILABLE"
  },
  {
    "feature": "weather/roof state",
    "source": "game-recorded conditions",
    "safety": "UNSAFE_FUTURE_LEAKAGE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "excluded from candidates"
  },
  {
    "feature": "market total",
    "source": "nflverse total_line",
    "safety": "SAFE_HISTORICAL_SNAPSHOT",
    "transformation": "external benchmark only",
    "coefficient": null,
    "fallback": "none",
    "missing": "never passed into independent candidate"
  }
]

## C. HISTORICAL DATASET

{
  "auditSeasons": {
    "from": 1999,
    "through": 2025
  },
  "seasons": {
    "1999": {
      "regular": 248,
      "playoffs": 11
    },
    "2000": {
      "regular": 248,
      "playoffs": 11
    },
    "2001": {
      "regular": 248,
      "playoffs": 11
    },
    "2002": {
      "regular": 256,
      "playoffs": 11
    },
    "2003": {
      "regular": 256,
      "playoffs": 11
    },
    "2004": {
      "regular": 256,
      "playoffs": 11
    },
    "2005": {
      "regular": 256,
      "playoffs": 11
    },
    "2006": {
      "regular": 256,
      "playoffs": 11
    },
    "2007": {
      "regular": 256,
      "playoffs": 11
    },
    "2008": {
      "regular": 256,
      "playoffs": 11
    },
    "2009": {
      "regular": 256,
      "playoffs": 11
    },
    "2010": {
      "regular": 256,
      "playoffs": 11
    },
    "2011": {
      "regular": 256,
      "playoffs": 11
    },
    "2012": {
      "regular": 256,
      "playoffs": 11
    },
    "2013": {
      "regular": 256,
      "playoffs": 11
    },
    "2014": {
      "regular": 256,
      "playoffs": 11
    },
    "2015": {
      "regular": 256,
      "playoffs": 11
    },
    "2016": {
      "regular": 256,
      "playoffs": 11
    },
    "2017": {
      "regular": 256,
      "playoffs": 11
    },
    "2018": {
      "regular": 256,
      "playoffs": 11
    },
    "2019": {
      "regular": 256,
      "playoffs": 11
    },
    "2020": {
      "regular": 256,
      "playoffs": 13
    },
    "2021": {
      "regular": 272,
      "playoffs": 13
    },
    "2022": {
      "regular": 271,
      "playoffs": 13
    },
    "2023": {
      "regular": 272,
      "playoffs": 13
    },
    "2024": {
      "regular": 272,
      "playoffs": 13
    },
    "2025": {
      "regular": 272,
      "playoffs": 13
    }
  },
  "totalFinalGames": 7276,
  "regularFinalGames": 6967,
  "postseasonFinalGames": 309,
  "sourceExclusions": {
    "NOT_FINAL": 272
  },
  "featureRows": 3151,
  "featureExclusions": {},
  "commonRows": 2639,
  "developmentN": 2095,
  "validationN": 272,
  "lockedHoldoutN": 272,
  "marketHoldoutN": 272
}

## D. POINT-IN-TIME SAFETY

Only earlier calendar-date finals and schedule-known rest/venue facts enter independent candidates. Final starter identity, observed weather/roof state, injuries, pace, pass/run tendencies and OL context are excluded without preserved pregame timestamps.

## E. SIMPLE BASELINES

| Baseline | N | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| League average | 272 | 10.971 | 13.798 | 0.494 |
| Recent combined scoring | 272 | 11.249 | 14.131 | -0.414 |
| Prior-season combined scoring | 272 | 10.770 | 13.520 | 0.202 |
| Simple offense + defense | 272 | 10.864 | 13.612 | -0.179 |
| Historical market total | 272 | 10.393 | 13.186 | 1.151 |

## F. EARLY-SEASON METHOD

Four-game transition from prior offense/defense scoring to current scoring. Weeks 1–4: {"model":{"n":64,"mae":11.323021302209474,"rmse":13.756919604233985,"bias":1.0612881133209493},"market":{"n":64,"mae":11.40625,"rmse":13.828186793647243,"bias":1.4375},"warning":null}

## G. OFFENSIVE FEATURES

Blended home-plus-away scoring offense and a chronological opponent-adjusted total. Points per drive, YPP, EPA, success rate, red-zone and explosive-play rates are unavailable in the frozen source.

## H. DEFENSIVE FEATURES

Blended points allowed and opponent-adjusted scoring. Drive/play efficiency and pass/rush defense are unavailable point-in-time.

## I. PACE FEATURES

MODEL_UNAVAILABLE_POINT_IN_TIME_PACE. No plays/game, seconds/snap or neutral-situation pace was fabricated.

## J. PASS/RUN FEATURES

MODEL_UNAVAILABLE_POINT_IN_TIME_PASS_RUN.

## K. QB STATUS

QB_CONTEXT_UNAVAILABLE. Revised final starter identity is not treated as a pregame snapshot.

## L. OL STATUS

OL_CONTEXT_UNAVAILABLE.

## M. WEATHER STATUS

Observed game weather and retractable-roof status are not timestamped pregame forecasts and are excluded. Indoor/outdoor is used only as a retrospective regime label.

## N. REST / SCHEDULE STATUS

Schedule-known rest, short-week flags, division, neutral designation and previous-game overtime were tested only in B5.

## O. MODEL B CANDIDATES

{
  "B1_OFFENSE_DEFENSE": {
    "features": [
      "BLENDED_OFFENSE_SUM",
      "BLENDED_DEFENSE_SUM"
    ],
    "development": {
      "n": 2095,
      "mae": 10.831141232191136,
      "rmse": 13.64139419765139,
      "bias": -2.74720580413213e-16
    },
    "validation": {
      "n": 272,
      "mae": 9.840495605842355,
      "rmse": 12.776827489395925,
      "bias": 0.9899539173049351
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.42414477742623835,
      "BLENDED_DEFENSE_SUM": 0.17995010252376228
    }
  },
  "B1_PLUS_OPPONENT_ADJUSTMENT": {
    "features": [
      "BLENDED_OFFENSE_SUM",
      "BLENDED_DEFENSE_SUM",
      "OPPONENT_ADJUSTED_TOTAL",
      "RECENT_COMBINED_TOTAL"
    ],
    "development": {
      "n": 2095,
      "mae": 10.82226825714003,
      "rmse": 13.629715789316405,
      "bias": -4.395529286611408e-15
    },
    "validation": {
      "n": 272,
      "mae": 9.882253121448604,
      "rmse": 12.822055943950472,
      "bias": 1.2630278719631465
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.2840040816495048,
      "BLENDED_DEFENSE_SUM": 0.050597527387210364,
      "OPPONENT_ADJUSTED_TOTAL": 0.38021675234839425,
      "RECENT_COMBINED_TOTAL": 0.07948741862322023
    }
  },
  "B5_PLUS_SAFE_SCHEDULE": {
    "features": [
      "BLENDED_OFFENSE_SUM",
      "BLENDED_DEFENSE_SUM",
      "OPPONENT_ADJUSTED_TOTAL",
      "RECENT_COMBINED_TOTAL",
      "REST_SUM",
      "HOME_SHORT_WEEK",
      "AWAY_SHORT_WEEK",
      "DIVISIONAL_GAME",
      "NEUTRAL_SITE",
      "PREVIOUS_OVERTIME_COUNT"
    ],
    "development": {
      "n": 2095,
      "mae": 10.813410944805947,
      "rmse": 13.600571730517926,
      "bias": 6.647559723578981e-16
    },
    "validation": {
      "n": 272,
      "mae": 9.896187285693559,
      "rmse": 12.899252322860987,
      "bias": 1.248200427855546
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.27771817939600724,
      "BLENDED_DEFENSE_SUM": 0.04831199053736811,
      "OPPONENT_ADJUSTED_TOTAL": 0.3907866900010518,
      "RECENT_COMBINED_TOTAL": 0.08330847524137389,
      "REST_SUM": -0.08345613875020728,
      "HOME_SHORT_WEEK": 0.37782813160851153,
      "AWAY_SHORT_WEEK": 0.051348438559355086,
      "DIVISIONAL_GAME": -1.3733112209236866,
      "NEUTRAL_SITE": -3.3203676268194946,
      "PREVIOUS_OVERTIME_COUNT": -0.9680416098890071
    }
  }
}

Selected on validation RMSE: B1_OFFENSE_DEFENSE. B2/B3/B4 are unavailable for pace, pass/run and QB data rather than silently reduced to B1.

## P. DEVELOPMENT / VALIDATION / HOLDOUT

Development 2016–2023: N=2095. Validation 2024: N=272. Locked holdout 2025: N=272.

## Q. WALK-FORWARD RESULTS

[
  {
    "season": 2019,
    "trainingN": 768,
    "testN": 256,
    "metrics": {
      "n": 256,
      "mae": 10.988750272330071,
      "rmse": 13.780643440689689,
      "bias": 0.6041884097337166
    },
    "modelA": {
      "n": 256,
      "mae": 11.121049288876105,
      "rmse": 13.774980676625349,
      "bias": 0.04475554693213876
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.4494562016326849,
      "BLENDED_DEFENSE_SUM": 0.13845878752374544
    }
  },
  {
    "season": 2020,
    "trainingN": 1024,
    "testN": 256,
    "metrics": {
      "n": 256,
      "mae": 10.68899475564927,
      "rmse": 13.519257104184492,
      "bias": 1.8241177289493085
    },
    "modelA": {
      "n": 256,
      "mae": 10.727722394286742,
      "rmse": 13.577445023807634,
      "bias": 1.1090389516134445
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.3969545160805348,
      "BLENDED_DEFENSE_SUM": 0.21388557663458913
    }
  },
  {
    "season": 2021,
    "trainingN": 1280,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 11.025956470259077,
      "rmse": 13.61033903016516,
      "bias": -0.6883554009469188
    },
    "modelA": {
      "n": 272,
      "mae": 11.315609779309554,
      "rmse": 13.931960055271695,
      "bias": -1.5997595289537625
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.4201613451294666,
      "BLENDED_DEFENSE_SUM": 0.24074128262919162
    }
  },
  {
    "season": 2022,
    "trainingN": 1552,
    "testN": 271,
    "metrics": {
      "n": 271,
      "mae": 10.93154159689473,
      "rmse": 13.72489391585663,
      "bias": -0.8524896492520024
    },
    "modelA": {
      "n": 271,
      "mae": 10.934741384798912,
      "rmse": 13.858067637313729,
      "bias": -0.7311372937970223
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.4137434202055184,
      "BLENDED_DEFENSE_SUM": 0.1996554001310224
    }
  },
  {
    "season": 2023,
    "trainingN": 1823,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 10.605741899944931,
      "rmse": 13.377006468936868,
      "bias": -0.8527296621464684
    },
    "modelA": {
      "n": 272,
      "mae": 10.630242630138394,
      "rmse": 13.517677701843116,
      "bias": -0.13859946356375577
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.4075512774941903,
      "BLENDED_DEFENSE_SUM": 0.19446936972160872
    }
  },
  {
    "season": 2024,
    "trainingN": 2095,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 9.840495605842355,
      "rmse": 12.776827489395925,
      "bias": 0.9899539173049351
    },
    "modelA": {
      "n": 272,
      "mae": 10.099850877865904,
      "rmse": 13.015267531347964,
      "bias": 1.381351611944378
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.42414477742623835,
      "BLENDED_DEFENSE_SUM": 0.17995010252376228
    }
  },
  {
    "season": 2025,
    "trainingN": 2367,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 10.734603024231133,
      "rmse": 13.466884807812503,
      "bias": 0.145627414089416
    },
    "modelA": {
      "n": 272,
      "mae": 10.652450423959998,
      "rmse": 13.453033280514775,
      "bias": -0.1311608514672604
    },
    "coefficients": {
      "BLENDED_OFFENSE_SUM": 0.42628647682168747,
      "BLENDED_DEFENSE_SUM": 0.1756037010233512
    }
  }
]

## R. TOTAL MODEL A METRICS

{
  "n": 272,
  "mae": 10.652450423959998,
  "rmse": 13.453033280514775,
  "bias": -0.1311608514672604
}

## S. TOTAL MODEL B METRICS

{
  "n": 272,
  "mae": 10.734603024231133,
  "rmse": 13.466884807812503,
  "bias": 0.145627414089416
}

## T. MARKET METRICS

{
  "n": 272,
  "mae": 10.393382352941176,
  "rmse": 13.18644580397525,
  "bias": 1.150735294117647
}

HISTORICAL MARKET TOTAL BENCHMARK — QUOTE TIME/CLOSE NOT VERIFIED.

## U. INCREMENTAL MARKET TEST

Market coefficient 0.934208; Model B coefficient 0.124335; intercept -1.180598. Holdout {"n":272,"mae":10.406489927436498,"rmse":13.14548772721211,"bias":-0.42077852105503977}. RMSE improvement versus raw market 0.31%.

## V. ENSEMBLE TEST

Validation-only Model B weight 15.00%; market weight 85.00%. Holdout {"n":272,"mae":10.398233167463307,"rmse":13.182651499843864,"bias":0.9999691121134147}.

## W. DISAGREEMENT ANALYSIS

{
  "n": 272,
  "buckets": [
    {
      "from": 0,
      "to": 1.5,
      "n": 104,
      "mae": 9.353192635135473,
      "rmse": 11.757486934245346,
      "bias": 0.7907419324571403
    },
    {
      "from": 1.5,
      "to": 3,
      "n": 84,
      "mae": 10.7007374341411,
      "rmse": 13.377406521473652,
      "bias": -0.4884111856611492
    },
    {
      "from": 3,
      "to": 5,
      "n": 55,
      "mae": 11.400174468588448,
      "rmse": 14.490439050632995,
      "bias": 0.41308542885575666
    },
    {
      "from": 5,
      "to": 7,
      "n": 16,
      "mae": 13.780752388503574,
      "rmse": 16.315757221902764,
      "bias": 5.984466763950147
    },
    {
      "from": 7,
      "to": 10,
      "n": 13,
      "mae": 15.439723852346479,
      "rmse": 17.785706702872986,
      "bias": -9.23624088907337
    },
    {
      "from": 10,
      "to": null,
      "n": 0,
      "mae": null,
      "rmse": null,
      "bias": null
    }
  ],
  "correlation": -0.22002814969409804,
  "regressionSlope": -1.0122224914408726
}

Secondary O/U diagnostic: {"priced":272,"wins":133,"losses":139,"pushes":0,"winRate":0.4889705882352941,"units":-17.509773521103877,"roi":-0.06437416735699955,"meanBreakEven":0.5232086617773735,"label":"RECONSTRUCTED NFLVERSE TOTAL-LINE/PRICE DIAGNOSTIC — NOT AN ACTIONABLE BACKTEST"}

## X. REGIME RESULTS

{
  "weeks_1_4": {
    "model": {
      "n": 64,
      "mae": 11.323021302209474,
      "rmse": 13.756919604233985,
      "bias": 1.0612881133209493
    },
    "market": {
      "n": 64,
      "mae": 11.40625,
      "rmse": 13.828186793647243,
      "bias": 1.4375
    },
    "warning": null
  },
  "weeks_5_9": {
    "model": {
      "n": 71,
      "mae": 9.748507974120884,
      "rmse": 12.919457835097228,
      "bias": 0.8857741148175814
    },
    "market": {
      "n": 71,
      "mae": 9.669014084507042,
      "rmse": 12.630027934798989,
      "bias": 1.4577464788732395
    },
    "warning": null
  },
  "weeks_10_plus": {
    "model": {
      "n": 137,
      "mae": 10.970763453188896,
      "rmse": 13.60714147964002,
      "bias": -0.6657061662209327
    },
    "market": {
      "n": 137,
      "mae": 10.295620437956204,
      "rmse": 13.16161472577666,
      "bias": 0.8576642335766423
    },
    "warning": null
  },
  "market_below_40": {
    "model": {
      "n": 31,
      "mae": 13.518170639593835,
      "rmse": 15.433310031460557,
      "bias": -3.1897055153969744
    },
    "market": {
      "n": 31,
      "mae": 12.048387096774194,
      "rmse": 15.31154950967069,
      "bias": 2.435483870967742
    },
    "warning": null
  },
  "market_40_to_44_5": {
    "model": {
      "n": 118,
      "mae": 10.073046252026192,
      "rmse": 12.626697268533864,
      "bias": -0.8548893136059945
    },
    "market": {
      "n": 118,
      "mae": 10.008474576271187,
      "rmse": 12.443601582298554,
      "bias": 0.9745762711864406
    },
    "warning": null
  },
  "market_45_to_49_5": {
    "model": {
      "n": 94,
      "mae": 10.124526009367447,
      "rmse": 12.786283996258408,
      "bias": 0.8838576792990633
    },
    "market": {
      "n": 94,
      "mae": 9.797872340425531,
      "rmse": 12.46847087486861,
      "bias": 0.40425531914893614
    },
    "warning": null
  },
  "market_50_plus": {
    "model": {
      "n": 29,
      "mae": 12.428407935994048,
      "rmse": 16.36246640580368,
      "bias": 5.389167060724921
    },
    "market": {
      "n": 29,
      "mae": 12.120689655172415,
      "rmse": 15.69455209673858,
      "bias": 2.913793103448276
    },
    "warning": "SMALL SAMPLE"
  },
  "indoor_dome_recorded": {
    "model": {
      "n": 92,
      "mae": 9.595523048555327,
      "rmse": 12.389147467258885,
      "bias": 1.3070848578303407
    },
    "market": {
      "n": 92,
      "mae": 9.108695652173912,
      "rmse": 12.09608272918569,
      "bias": 1.5
    },
    "warning": null
  },
  "outdoor_or_open_recorded": {
    "model": {
      "n": 180,
      "mae": 11.316799456243208,
      "rmse": 13.985693207959496,
      "bias": -0.4480063904892786
    },
    "market": {
      "n": 180,
      "mae": 11.05,
      "rmse": 13.71029621205254,
      "bias": 0.9722222222222222
    },
    "warning": null
  },
  "divisional": {
    "model": {
      "n": 96,
      "mae": 11.050847781355186,
      "rmse": 13.602755358120552,
      "bias": -2.024143722106256
    },
    "market": {
      "n": 96,
      "mae": 10.666666666666666,
      "rmse": 13.231118622399242,
      "bias": -0.8125
    },
    "warning": null
  },
  "non_divisional": {
    "model": {
      "n": 176,
      "mae": 10.56210588398165,
      "rmse": 13.39219260091452,
      "bias": 1.3291389429234186
    },
    "market": {
      "n": 176,
      "mae": 10.244318181818182,
      "rmse": 13.16201490515933,
      "bias": 2.221590909090909
    },
    "warning": null
  },
  "primetime": {
    "model": {
      "n": 56,
      "mae": 11.698808853854612,
      "rmse": 14.993090331112615,
      "bias": -0.03947250070406115
    },
    "market": {
      "n": 56,
      "mae": 11.839285714285714,
      "rmse": 15.24443692442778,
      "bias": 0.5178571428571429
    },
    "warning": null
  },
  "neutral_or_international_designation": {
    "model": {
      "n": 7,
      "mae": 8.773649124784976,
      "rmse": 11.373671308207543,
      "bias": -5.097689041839007
    },
    "market": {
      "n": 7,
      "mae": 7.785714285714286,
      "rmse": 10.715476124345972,
      "bias": -3.7857142857142856
    },
    "warning": "SMALL SAMPLE"
  },
  "overtime": {
    "model": {
      "n": 14,
      "mae": 14.588122235093165,
      "rmse": 17.753576699580375,
      "bias": 9.349264522230442
    },
    "market": {
      "n": 14,
      "mae": 14.142857142857142,
      "rmse": 17.674638812231983,
      "bias": 9.285714285714286
    },
    "warning": "SMALL SAMPLE"
  }
}

Playoffs audited separately (N=309) and not fit. Weather-specific wind/cold/precipitation regimes are unavailable point-in-time.

## Y. ABLATION

{
  "offense": {
    "removed": [
      "BLENDED_OFFENSE_SUM"
    ],
    "metrics": {
      "n": 272,
      "mae": 10.996200702405833,
      "rmse": 13.823181849929997,
      "bias": 0.42424845528598343
    }
  },
  "defense": {
    "removed": [
      "BLENDED_DEFENSE_SUM"
    ],
    "metrics": {
      "n": 272,
      "mae": 10.74416325646022,
      "rmse": 13.47631546895525,
      "bias": 0.24955330869304754
    }
  },
  "opponent_adjustment": {
    "status": "NOT_PRESENT_IN_SELECTED_MODEL"
  },
  "recent_scoring": {
    "status": "NOT_PRESENT_IN_SELECTED_MODEL"
  },
  "rest_schedule": {
    "status": "NOT_PRESENT_IN_SELECTED_MODEL"
  },
  "venue": {
    "status": "NOT_PRESENT_IN_SELECTED_MODEL"
  },
  "pace": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "pass_run": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "QB": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "OL": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "weather": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  }
}

Coverage: {"offense":{"state":"PASS","n":2639,"total":2639,"percent":100},"defense":{"state":"PASS","n":2639,"total":2639,"percent":100},"pace":{"state":"FAIL","n":0,"total":2639,"percent":0},"pass_run":{"state":"FAIL","n":0,"total":2639,"percent":0},"QB":{"state":"FAIL","n":0,"total":2639,"percent":0},"OL":{"state":"UNKNOWN","n":0,"total":2639,"percent":0},"weather":{"state":"FAIL","n":0,"total":2639,"percent":0},"rest":{"state":"PASS","n":2639,"total":2639,"percent":100},"venue":{"state":"PARTIAL","n":2639,"total":2639,"percent":100,"note":"Home/neutral safe; game-specific roof state excluded."},"market":{"state":"PARTIAL","n":2639,"total":2639,"percent":100,"note":"Historical total exists without quote timestamp; verified close unavailable."}}. Forward integration: {"status":"NOT_INTEGRATED","existingSnapshotsModified":false,"protectedCutoff":"2026-09-08T02:19:07.588Z"}. API impact: {"newProviderCalls":0,"newPaidCredits":0,"newCachedData":0,"reusedCache":"research/nfl-spread-phase3a/sources/games.csv.gz"}. Production impact: {"spreadModel":false,"totalModel":false,"propModels":false,"recommendationThresholds":false,"ranking":false,"probabilityCalibration":false,"kelly":false,"staking":false,"parlays":false,"sgp":false,"collectionMode":"MANUAL_ONLY","scheduledJobs":false}.

## Z. FINAL DECISION

NFL TOTAL MODEL B FAILS RESEARCH GATE

Gate: {"minimumN":true,"maeImprovement":false,"rmseImprovement":false,"bias":true,"incrementalMarket":false,"stableWalkForward":true,"noCatastrophicMajorRegime":true,"noLeakage":true,"noMarketContamination":true}

Selection used total-error accuracy, not O/U profitability. No production or scheduling behavior changed.
