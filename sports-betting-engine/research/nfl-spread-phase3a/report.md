# NFL Phase 3A — Spread Model Research and Market Benchmarking

Generated: 2026-09-08T11:45:00.000Z

## A. MODEL A FORMULA

{
  "version": "nfl-game-line-ridge-research-v2-audit-metrics",
  "config": {
    "ridge": 3,
    "halfLifeDays": 180
  },
  "formula": "Two-score ridge: league intercept + offense team coefficient + opponent defense coefficient ± learned half home advantage; projected home margin is projected home score minus projected away score.",
  "features": [
    "same-season and prior-season earlier final scores",
    "team offense identity",
    "opponent defense identity",
    "home/neutral venue"
  ],
  "weights": "current season 1.0, previous season 0.65, plus 180-day exponential half-life",
  "fallbacks": "Requires at least 100 league games and six appearances per team; otherwise MODEL_UNAVAILABLE.",
  "homeField": "learned coefficient, split ± one half per team; neutral zero",
  "earlySeason": "previous season transferred at 0.65 without a separate roster/QB layer",
  "injury": "blocking context outside numeric formula only",
  "QB": "not numeric",
  "weather": "not numeric",
  "marketContamination": false
}

## B. MODEL A FEATURE AUDIT

[
  {
    "feature": "TEAM_STRENGTH_DIFF",
    "source": "prior final scores",
    "safety": "RECONSTRUCTED_WITHOUT_FUTURE_INFO",
    "transformation": "365-day half-life regularized home/away margin rating using only earlier dates",
    "coefficient": 1.2952435760656784,
    "fallback": "MODEL_UNAVAILABLE",
    "missing": "row excluded"
  },
  {
    "feature": "HOME_FIELD",
    "source": "nflverse location",
    "safety": "SAFE_HISTORICAL_SNAPSHOT",
    "transformation": "1 home, 0 neutral; coefficient learned",
    "coefficient": 1.3813485213656311,
    "fallback": "0 neutral",
    "missing": "row invalid"
  },
  {
    "feature": "BLENDED_OFFENSE_DIFF / BLENDED_DEFENSE_DIFF",
    "source": "earlier final scores",
    "safety": "RECONSTRUCTED_WITHOUT_FUTURE_INFO",
    "transformation": "prior/current blend reaches full current weight after four games",
    "coefficient": [
      0.2566181889454062,
      0.07583281475313373
    ],
    "fallback": "regressed prior season",
    "missing": "MODEL_UNAVAILABLE without minimum prior history"
  },
  {
    "feature": "ROLLING_MARGIN_DIFF",
    "source": "earlier final scores",
    "safety": "RECONSTRUCTED_WITHOUT_FUTURE_INFO",
    "transformation": "last four completed games",
    "coefficient": 0.027474355975482652,
    "fallback": "prior games may enter early season",
    "missing": "MODEL_UNAVAILABLE without history"
  },
  {
    "feature": "REST / SCHEDULE",
    "source": "schedule and prior locations",
    "safety": "SAFE_HISTORICAL_SNAPSHOT",
    "transformation": "capped rest difference, short-week flags, division, neutral, away road streak",
    "coefficient": {},
    "fallback": "documented seven-day rest only when source blank",
    "missing": "feature availability disclosed"
  },
  {
    "feature": "QB",
    "source": "revised schedule starter",
    "safety": "UNAVAILABLE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "MODEL_UNAVAILABLE_HISTORICAL_POINT_IN_TIME_QB"
  },
  {
    "feature": "INJURY",
    "source": null,
    "safety": "UNAVAILABLE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "INJURY_FEATURE_UNAVAILABLE"
  },
  {
    "feature": "WEATHER",
    "source": "revised observed stadium weather",
    "safety": "UNSAFE_FUTURE_LEAKAGE",
    "transformation": null,
    "coefficient": null,
    "fallback": "none",
    "missing": "excluded from candidates"
  },
  {
    "feature": "MARKET",
    "source": "nflverse spread_line",
    "safety": "SAFE_HISTORICAL_SNAPSHOT",
    "transformation": "external benchmark only",
    "coefficient": null,
    "fallback": "none",
    "missing": "never enters Model A/B features"
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

## D. DATA SAFETY CLASSIFICATION

Only earlier final scores, schedule-known rest, divisional status, and home/neutral designation enter candidates. Revised starter-QB, observed weather, and non-timestamped injury/context data are excluded. Market data remains external.

## E. BASELINES

| Baseline | N | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| Home field only | 272 | 11.062 | 14.145 | 0.369 |
| Prior-season strength | 272 | 11.235 | 14.209 | 0.419 |
| Current-season scoring margin | 272 | 11.294 | 14.133 | 0.932 |
| Simple rolling margin | 272 | 11.249 | 14.643 | 0.398 |
| NFLVERSE spread-line benchmark | 272 | 9.722 | 12.271 | 0.572 |

Earliest trustworthy quote and verified closing quote are unavailable because the source supplies no quote timestamp.

## F. HOME-FIELD RESULT

Development empirical home margin: 1.746. Selected-model home-field coefficient: 1.381. Neutral games receive zero home indicator.

## G. EARLY-SEASON METHOD

Four-game linear transition from regressed prior-season scoring context to current-season context. Weeks 1–4 holdout: {"model":{"n":64,"mae":9.223993190264716,"rmse":12.493151162950065,"bias":3.2518985180358473},"market":{"n":64,"mae":8.84375,"rmse":12.104041164007993,"bias":3.5}}

## H. CURRENT-SEASON FEATURES

Pregame rolling points for, points allowed, and four-game margin are derived only from earlier calendar dates. EPA, success rate, pressure and pace are unavailable in the frozen point-in-time source and were not fabricated.

## I. OPPONENT ADJUSTMENT

TEAM_STRENGTH_DIFF is a regularized two-season margin rating with a 365-day half-life, refit chronologically. No retrospective full-season rating is used.

## J. QB FEATURE STATUS

MODEL_UNAVAILABLE_HISTORICAL_POINT_IN_TIME_QB. The revised source's final starter identity is not treated as a preserved pregame starter snapshot.

## K. INJURY FEATURE STATUS

INJURY_FEATURE_UNAVAILABLE. No retrospective inactive inference or arbitrary point adjustment is used.

## L. REST/SCHEDULE FEATURES

Rest difference (capped ±7), home/away short-week flags, divisional game, neutral site and away road streak were predeclared. Coefficients: {}

## M. WEATHER FEATURE STATUS

UNSAFE_FUTURE_LEAKAGE for candidate use: the source contains observed game weather, not a timestamped pregame forecast. Excluded.

## N. MODEL B CANDIDATES

{
  "B1_TEAM_STRENGTH": {
    "features": [
      "TEAM_STRENGTH_DIFF",
      "HOME_FIELD"
    ],
    "development": {
      "n": 2095,
      "mae": 10.164383164143956,
      "rmse": 13.153875113762957,
      "bias": -6.56912869367706e-16
    },
    "validation": {
      "n": 272,
      "mae": 10.181987629014877,
      "rmse": 13.219850056648099,
      "bias": 0.11519112605240127
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.856044948537232,
      "HOME_FIELD": 2.598963361484204
    }
  },
  "B2_TEAM_AND_EFFICIENCY": {
    "features": [
      "TEAM_STRENGTH_DIFF",
      "HOME_FIELD",
      "BLENDED_OFFENSE_DIFF",
      "BLENDED_DEFENSE_DIFF",
      "ROLLING_MARGIN_DIFF"
    ],
    "development": {
      "n": 2095,
      "mae": 10.147908131705918,
      "rmse": 13.112147946403603,
      "bias": 5.227322155084747e-16
    },
    "validation": {
      "n": 272,
      "mae": 10.11222332266934,
      "rmse": 13.130320866500913,
      "bias": 0.05791907633206965
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.343215284124105,
      "HOME_FIELD": 2.5299781123023166,
      "BLENDED_OFFENSE_DIFF": 0.2279041909110584,
      "BLENDED_DEFENSE_DIFF": 0.049409235991488595,
      "ROLLING_MARGIN_DIFF": 0.030250551195631612
    }
  },
  "B4_PLUS_SCHEDULE": {
    "features": [
      "TEAM_STRENGTH_DIFF",
      "HOME_FIELD",
      "BLENDED_OFFENSE_DIFF",
      "BLENDED_DEFENSE_DIFF",
      "ROLLING_MARGIN_DIFF",
      "REST_DIFF",
      "HOME_SHORT_WEEK",
      "AWAY_SHORT_WEEK",
      "DIVISIONAL_GAME",
      "NEUTRAL_SITE",
      "AWAY_ROAD_STREAK"
    ],
    "development": {
      "n": 2095,
      "mae": 10.139043425135705,
      "rmse": 13.10591617957135,
      "bias": 3.234750044062986e-16
    },
    "validation": {
      "n": 272,
      "mae": 10.122578739721432,
      "rmse": 13.15460865573347,
      "bias": 0.06305894201848686
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.3423451625557652,
      "HOME_FIELD": 1.2939047969421982,
      "BLENDED_OFFENSE_DIFF": 0.22550010987771849,
      "BLENDED_DEFENSE_DIFF": 0.04947764880249729,
      "ROLLING_MARGIN_DIFF": 0.030650535056969554,
      "REST_DIFF": 0.10490240920360033,
      "HOME_SHORT_WEEK": 0.4713726417726391,
      "AWAY_SHORT_WEEK": 0.13173251060723784,
      "DIVISIONAL_GAME": -0.5207949834512936,
      "NEUTRAL_SITE": -1.2939047969425974,
      "AWAY_ROAD_STREAK": -0.18951638963863718
    }
  }
}

B3 and B5 remain MODEL_UNAVAILABLE because historical point-in-time QB and injury/context evidence is absent. Selected on validation RMSE: B2_TEAM_AND_EFFICIENCY.

## O. DEVELOPMENT / VALIDATION / HOLDOUT SPLIT

Development 2016–2023: N=2095. Validation 2024: N=272. Locked holdout 2025: N=272. No random split.

## P. WALK-FORWARD RESULTS

[
  {
    "season": 2019,
    "trainingN": 768,
    "testN": 256,
    "metrics": {
      "n": 256,
      "mae": 10.546031228791652,
      "rmse": 13.529281266317772,
      "bias": -2.6204134282447504
    },
    "modelA": {
      "n": 256,
      "mae": 10.40570882873071,
      "rmse": 13.333129441073597,
      "bias": -0.7318155320338663
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.4213979411849007,
      "HOME_FIELD": 2.3249665248332287,
      "BLENDED_OFFENSE_DIFF": 0.2321725527288738,
      "BLENDED_DEFENSE_DIFF": 0.02359667113639635,
      "ROLLING_MARGIN_DIFF": -0.002506652387736974
    }
  },
  {
    "season": 2020,
    "trainingN": 1024,
    "testN": 256,
    "metrics": {
      "n": 256,
      "mae": 10.098693391228577,
      "rmse": 13.048012409963333,
      "bias": -1.7324144472768233
    },
    "modelA": {
      "n": 256,
      "mae": 10.122296567211402,
      "rmse": 13.003024071911653,
      "bias": -0.20817050846879814
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.318809452674408,
      "HOME_FIELD": 2.7583945895622417,
      "BLENDED_OFFENSE_DIFF": 0.23836731411403791,
      "BLENDED_DEFENSE_DIFF": 0.05773893082407735,
      "ROLLING_MARGIN_DIFF": 0.03994981866811254
    }
  },
  {
    "season": 2021,
    "trainingN": 1280,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 11.227120290625313,
      "rmse": 14.11443048641962,
      "bias": 0.32687130754455485
    },
    "modelA": {
      "n": 272,
      "mae": 11.22884819535854,
      "rmse": 14.22521833427159,
      "bias": 1.6168468030909078
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.2542704766822357,
      "HOME_FIELD": 3.3209336618417096,
      "BLENDED_OFFENSE_DIFF": 0.25610763642561113,
      "BLENDED_DEFENSE_DIFF": 0.10676515856952287,
      "ROLLING_MARGIN_DIFF": 0.03734912610708056
    }
  },
  {
    "season": 2022,
    "trainingN": 1552,
    "testN": 271,
    "metrics": {
      "n": 271,
      "mae": 9.034849342039042,
      "rmse": 11.730850174591733,
      "bias": 0.47391622982239273
    },
    "modelA": {
      "n": 271,
      "mae": 9.08240817995245,
      "rmse": 11.787574895855743,
      "bias": 0.23499122315950424
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.3269062714289912,
      "HOME_FIELD": 1.2379328319602885,
      "BLENDED_OFFENSE_DIFF": 0.23472140801653466,
      "BLENDED_DEFENSE_DIFF": 0.05270302187649542,
      "ROLLING_MARGIN_DIFF": 0.048905049027891036
    }
  },
  {
    "season": 2023,
    "trainingN": 1823,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 10.395676121579012,
      "rmse": 13.539233153288313,
      "bias": 1.033333091473735
    },
    "modelA": {
      "n": 272,
      "mae": 10.432983667857727,
      "rmse": 13.557636343429415,
      "bias": 0.6083287013230818
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.3040320038804496,
      "HOME_FIELD": 2.6175272961594342,
      "BLENDED_OFFENSE_DIFF": 0.22843983435052412,
      "BLENDED_DEFENSE_DIFF": 0.03708189958239575,
      "ROLLING_MARGIN_DIFF": 0.05157668840795954
    }
  },
  {
    "season": 2024,
    "trainingN": 2095,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 10.11222332266934,
      "rmse": 13.130320866500913,
      "bias": 0.05791907633206965
    },
    "modelA": {
      "n": 272,
      "mae": 10.184608082387584,
      "rmse": 13.150467144370642,
      "bias": 0.1955972266115036
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.343215284124105,
      "HOME_FIELD": 2.5299781123023166,
      "BLENDED_OFFENSE_DIFF": 0.2279041909110584,
      "BLENDED_DEFENSE_DIFF": 0.049409235991488595,
      "ROLLING_MARGIN_DIFF": 0.030250551195631612
    }
  },
  {
    "season": 2025,
    "trainingN": 2367,
    "testN": 272,
    "metrics": {
      "n": 272,
      "mae": 10.310892919868488,
      "rmse": 12.992699123045407,
      "bias": 0.41039909442949435
    },
    "modelA": {
      "n": 272,
      "mae": 10.321725578304568,
      "rmse": 13.010504572125042,
      "bias": -0.11275347967728234
    },
    "coefficients": {
      "TEAM_STRENGTH_DIFF": 1.2952435760656784,
      "HOME_FIELD": 1.3813485213656311,
      "BLENDED_OFFENSE_DIFF": 0.2566181889454062,
      "BLENDED_DEFENSE_DIFF": 0.07583281475313373,
      "ROLLING_MARGIN_DIFF": 0.027474355975482652
    }
  }
]

## Q. MODEL A METRICS

{
  "n": 272,
  "mae": 10.321725578304568,
  "rmse": 13.010504572125042,
  "bias": -0.11275347967728234
}

## R. MODEL B METRICS

{
  "n": 272,
  "mae": 10.310892919868488,
  "rmse": 12.992699123045407,
  "bias": 0.41039909442949435
}

## S. MARKET METRICS

{
  "n": 272,
  "mae": 9.722426470588236,
  "rmse": 12.271177672521421,
  "bias": 0.5716911764705882
}

Label: NFLVERSE SPREAD_LINE HISTORICAL BENCHMARK — QUOTE TIME/CLOSE NOT VERIFIED.

## T. INCREMENTAL MARKET TEST

Market coefficient 1.183725; Model B coefficient 0.151779; intercept -0.173915. Holdout {"n":272,"mae":9.915015553265036,"rmse":12.309157518203724,"bias":0.2184863774436485}. RMSE improvement versus raw market: -0.31%.

## U. ENSEMBLE TEST

Validation-only Model B weight 0.00%; market weight 100.00%. Holdout {"n":272,"mae":9.722426470588236,"rmse":12.271177672521421,"bias":0.5716911764705882}.

## V. DISAGREEMENT ANALYSIS

{
  "n": 272,
  "buckets": [
    {
      "from": 0,
      "to": 1.5,
      "n": 123,
      "mae": 9.985452024707174,
      "rmse": 12.36459468007468,
      "bias": 0.32480462264973003
    },
    {
      "from": 1.5,
      "to": 3,
      "n": 73,
      "mae": 9.241256571884616,
      "rmse": 12.02520737231069,
      "bias": -0.1692025266937488
    },
    {
      "from": 3,
      "to": 5,
      "n": 43,
      "mae": 11.133950386191598,
      "rmse": 13.923261071956228,
      "bias": 1.9621291019416216
    },
    {
      "from": 5,
      "to": 7,
      "n": 21,
      "mae": 11.3964688342307,
      "rmse": 13.844441392736089,
      "bias": 3.3687892860765447
    },
    {
      "from": 7,
      "to": 10,
      "n": 9,
      "mae": 16.72591884074051,
      "rmse": 20.569163358469854,
      "bias": -9.958986307129749
    },
    {
      "from": 10,
      "to": null,
      "n": 3,
      "mae": 11.040521241973787,
      "rmse": 11.355257342199264,
      "bias": 6.1813733068732875
    }
  ],
  "correlation": -0.3430274080308778,
  "regressionSlope": -1.3716609418012307
}

ATS is secondary only: {"priced":272,"wins":128,"losses":143,"pushes":1,"winRate":0.47232472324723246,"units":-26.343614423058696,"roi":-0.09685152361418638,"meanBreakEven":0.5230020352323663,"wilson95":[0.4136876579696925,0.5317354511957324],"label":"RECONSTRUCTED NFLVERSE SPREAD-LINE/PRICE DIAGNOSTIC — NOT AN ACTIONABLE BACKTEST"}

## W. REGIME RESULTS

{
  "weeks_1_4": {
    "model": {
      "n": 64,
      "mae": 9.223993190264716,
      "rmse": 12.493151162950065,
      "bias": 3.2518985180358473
    },
    "market": {
      "n": 64,
      "mae": 8.84375,
      "rmse": 12.104041164007993,
      "bias": 3.5
    }
  },
  "weeks_5_9": {
    "model": {
      "n": 71,
      "mae": 11.334172511324358,
      "rmse": 13.956829432660465,
      "bias": -0.5236244823607811
    },
    "market": {
      "n": 71,
      "mae": 10.82394366197183,
      "rmse": 12.989838932525597,
      "bias": -0.4014084507042254
    }
  },
  "weeks_10_plus": {
    "model": {
      "n": 137,
      "mae": 10.288328917687998,
      "rmse": 12.700085808986676,
      "bias": -0.4329606804515052
    },
    "market": {
      "n": 137,
      "mae": 9.562043795620438,
      "rmse": 11.961464890880482,
      "bias": -0.291970802919708
    }
  },
  "model_favors_home": {
    "model": {
      "n": 167,
      "mae": 10.106336466323862,
      "rmse": 12.638672655576217,
      "bias": 0.3806212349834503
    },
    "market": {
      "n": 167,
      "mae": 9.547904191616766,
      "rmse": 11.986581819375148,
      "bias": 0.7035928143712575
    }
  },
  "model_favors_away": {
    "model": {
      "n": 105,
      "mae": 10.636235088839443,
      "rmse": 13.536709500960592,
      "bias": 0.45776007088177356
    },
    "market": {
      "n": 105,
      "mae": 10,
      "rmse": 12.71070040406526,
      "bias": 0.3619047619047619
    }
  },
  "home_favorite": {
    "model": {
      "n": 158,
      "mae": 10.229381849265637,
      "rmse": 12.548619856216895,
      "bias": 1.8896579175348946
    },
    "market": {
      "n": 158,
      "mae": 9.699367088607595,
      "rmse": 12.004811798987683,
      "bias": 0.9335443037974683
    }
  },
  "road_favorite": {
    "model": {
      "n": 114,
      "mae": 10.42386440368646,
      "rmse": 13.584195141037938,
      "bias": -1.639801730576234
    },
    "market": {
      "n": 114,
      "mae": 9.75438596491228,
      "rmse": 12.631067241097357,
      "bias": 0.07017543859649122
    }
  },
  "small_spread_0_3": {
    "model": {
      "n": 97,
      "mae": 10.051584875425322,
      "rmse": 13.39260152860574,
      "bias": 0.12438745760845524
    },
    "market": {
      "n": 97,
      "mae": 9.670103092783505,
      "rmse": 12.73743569331116,
      "bias": 0.4742268041237113
    }
  },
  "spread_over_7": {
    "model": {
      "n": 64,
      "mae": 10.525957932885595,
      "rmse": 12.582672945298098,
      "bias": 2.686068532277489
    },
    "market": {
      "n": 64,
      "mae": 9.3515625,
      "rmse": 11.39747093657185,
      "bias": 2.1796875
    }
  },
  "spread_over_10": {
    "model": {
      "n": 30,
      "mae": 10.671959011562022,
      "rmse": 12.58215118228699,
      "bias": 5.607452168213902
    },
    "market": {
      "n": 30,
      "mae": 9.016666666666667,
      "rmse": 10.9136764352501,
      "bias": 3.65
    }
  },
  "spread_over_14": {
    "model": {
      "n": 5,
      "mae": 7.969871150127188,
      "rmse": 9.280721810310407,
      "bias": 2.0065954370950267
    },
    "market": {
      "n": 5,
      "mae": 5.7,
      "rmse": 7.060453243241541,
      "bias": -0.7
    }
  },
  "divisional": {
    "model": {
      "n": 96,
      "mae": 10.155187405628194,
      "rmse": 12.606875963089983,
      "bias": 0.524898087266015
    },
    "market": {
      "n": 96,
      "mae": 9.546875,
      "rmse": 12.031750530713865,
      "bias": 0.765625
    }
  },
  "non_divisional": {
    "model": {
      "n": 176,
      "mae": 10.395823200363186,
      "rmse": 13.198395182202088,
      "bias": 0.34794509833684634
    },
    "market": {
      "n": 176,
      "mae": 9.818181818181818,
      "rmse": 12.399825878542885,
      "bias": 0.4659090909090909
    }
  },
  "neutral_or_international_designation": {
    "model": {
      "n": 7,
      "mae": 7.6861250607185765,
      "rmse": 10.828672503367041,
      "bias": -0.7287330678524844
    },
    "market": {
      "n": 7,
      "mae": 6.642857142857143,
      "rmse": 10.469343000262379,
      "bias": -0.7857142857142857
    }
  },
  "overtime": {
    "model": {
      "n": 14,
      "mae": 3.889276649852458,
      "rmse": 4.5022331226739105,
      "bias": -0.4390695147466209
    },
    "market": {
      "n": 14,
      "mae": 3.7857142857142856,
      "rmse": 5.092010548749033,
      "bias": -0.42857142857142855
    }
  }
}

QB-change regimes are unavailable point-in-time. Playoffs were audited separately (N=309) and excluded from fitting.

## X. ABLATION

{
  "prior_and_opponent_strength": {
    "removed": [
      "TEAM_STRENGTH_DIFF"
    ],
    "metrics": {
      "n": 272,
      "mae": 10.237224815014509,
      "rmse": 12.981567803633105,
      "bias": 0.45474968125591225
    }
  },
  "current_season_efficiency": {
    "removed": [
      "BLENDED_OFFENSE_DIFF",
      "BLENDED_DEFENSE_DIFF",
      "ROLLING_MARGIN_DIFF"
    ],
    "metrics": {
      "n": 272,
      "mae": 10.355885626938276,
      "rmse": 13.057383475111077,
      "bias": 0.39821642689466663
    }
  },
  "home_field": {
    "removed": [
      "HOME_FIELD"
    ],
    "metrics": {
      "n": 272,
      "mae": 10.294665073007168,
      "rmse": 12.996016726122631,
      "bias": 0.3972265866189659
    }
  },
  "rest_and_schedule": {
    "removed": [],
    "status": "NOT_PRESENT_IN_SELECTED_MODEL"
  },
  "QB": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "injury_context": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  },
  "weather": {
    "status": "UNAVAILABLE_POINT_IN_TIME"
  }
}

## Y. DATA COVERAGE

{
  "team_strength": {
    "state": "PASS",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Chronological regularized margin ratings."
  },
  "offense": {
    "state": "PASS",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Pregame rolling points scored."
  },
  "defense": {
    "state": "PASS",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Pregame rolling points allowed."
  },
  "passing": {
    "state": "FAIL",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "No point-in-time historical efficiency feed in the frozen source."
  },
  "rushing": {
    "state": "FAIL",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "No point-in-time historical efficiency feed in the frozen source."
  },
  "QB": {
    "state": "FAIL",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "Final recorded starter is not a preserved pregame starter snapshot."
  },
  "OL": {
    "state": "UNKNOWN",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "No trustworthy historical point-in-time continuity source."
  },
  "injuries": {
    "state": "FAIL",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "No archived pregame injury snapshots."
  },
  "coaching": {
    "state": "PARTIAL",
    "n": 7276,
    "total": 7276,
    "percent": 100,
    "note": "Names exist in revised schedules but are excluded from fitting without publication timestamps."
  },
  "rest": {
    "state": "PASS",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Schedule-known rest days."
  },
  "weather": {
    "state": "FAIL",
    "n": 0,
    "total": 2639,
    "percent": 0,
    "note": "Observed game weather is not a preserved forecast-time snapshot."
  },
  "venue": {
    "state": "PASS",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Home/neutral designation is explicit."
  },
  "market": {
    "state": "PARTIAL",
    "n": 2639,
    "total": 2639,
    "percent": 100,
    "note": "Spread line is a credible external historical benchmark but has no quote timestamp; earliest and verified close are unavailable."
  }
}

Forward archive integration: {"status":"NOT_INTEGRATED","existingSnapshotsModified":false,"protectedCutoff":"2026-09-08T02:19:07.588Z"}. API impact: {"newPaidCredits":0,"newPaidProviders":0,"sourceDownloadCalls":1,"cachedFiles":["sources/games.csv.gz"]}. Production impact: {"spreadCoefficients":false,"totals":false,"propFormulas":false,"rankings":false,"recommendationThresholds":false,"probabilities":false,"calibration":false,"kelly":false,"staking":false,"parlays":false,"sgp":false,"collectionMode":"MANUAL_ONLY","scheduledJobs":false}.

## Z. FINAL DECISION

NFL SPREAD MODEL B FAILS RESEARCH GATE

Gate: {"minimumN":true,"maeImprovement":false,"rmseImprovement":false,"bias":true,"incrementalMarket":false,"stableWalkForward":true,"noCatastrophicMajorRegime":true,"noLeakage":true,"noMarketContamination":true}

The decision is based on margin accuracy, bias, chronology, regime stability and incremental information beyond the market—not ATS profitability. No production or scheduling behavior changed.
