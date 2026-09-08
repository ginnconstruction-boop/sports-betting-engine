# NFL Phase 3C — Player Prop Opportunity Engine

Generated: 2026-09-07T23:45:00.000Z

## A. Existing prop formula map

{
  "supportedProductionOutputs": [
    "QB passing yards",
    "QB rushing yards",
    "RB/WR/TE receiving yards",
    "RB/WR/TE receptions",
    "RB rushing yards when the player has rushing history"
  ],
  "unsupportedCoreOutputs": [
    "QB passing attempts",
    "QB completions",
    "QB designed rushes",
    "QB scrambles",
    "RB rushing attempts as a direct final-stat forecast",
    "routes",
    "goal-line opportunities",
    "red-zone opportunities"
  ],
  "features": [
    "same-team completed regular-season ESPN game-log production",
    "passing attempts, rushing attempts, or receiving targets",
    "at most 20 earlier appearances",
    "last-five and full-window summaries",
    "current roster and depth used only as eligibility warnings"
  ],
  "coefficients": {
    "workload": "0.60 × last-five mean opportunity + 0.40 × last-twenty mean opportunity",
    "efficiency": "0.40 × last-five pooled production/opportunity + 0.60 × last-twenty pooled production/opportunity",
    "finalProjection": "workload × efficiency",
    "simpleBaseline": "last-twenty mean final production"
  },
  "fallbacks": "No numerical fallback. Fewer than eight complete same-team games, nonpositive opportunity, stale/missing roster/depth, injuries, missing rolling errors, or a baseline failure blocks issuance.",
  "opponentAdjustment": "None",
  "injuryAdjustment": "No point adjustment; injury evidence adds a blocking reason.",
  "roleAssumption": "First-listed depth role is required for issuance but does not change the numeric projection.",
  "marketInput": "None in point projection. Exact prop line is used only after projection as an external benchmark.",
  "probability": "Smoothed empirical rolling production errors with one pseudocount per possible outcome; explicitly uncalibrated.",
  "missingData": "Excluded or MODEL_UNAVAILABLE; never zero-filled."
}

## B. Opportunity / efficiency separation design

Availability → role → team volume → player opportunity → efficiency → final stat. Phase 3C implements and archives the first four as a separate shadow component. Efficiency and final production remain in the unchanged existing formula.

## C–D. Historical sources and point-in-time safety

[
  {
    "provider": "ESPN public game logs and final summaries",
    "classification": "RECONSTRUCTED_WITHOUT_FUTURE_INFO",
    "use": "Earlier final opportunity features and final target counts; revised data, not a preserved pregame role feed."
  },
  {
    "provider": "nflverse/PFR snap counts",
    "classification": "SAFE_HISTORICAL_SNAPSHOT",
    "use": "Free diagnostic offense snaps/share; cross-provider name-to-ID mapping and publication timing prevent automatic role proof."
  },
  {
    "provider": "nflverse participation/FTN",
    "classification": "UNAVAILABLE",
    "use": "Routes are not suitable for weekly point-in-time 2026 use because 2023+ participation is documented as released after postseason."
  },
  {
    "provider": "ESPN depth/roster",
    "classification": "VERIFIED_POINT_IN_TIME",
    "use": "Current manual-capture identity and provisional depth evidence only."
  },
  {
    "provider": "NFL.com injury/inactive reports",
    "classification": "VERIFIED_POINT_IN_TIME",
    "use": "Availability state only; never reconstructed from final participation."
  }
]

## E–F. Availability and role pipelines

Official complete inactives can verify ACTIVE/INACTIVE. Pending, unknown, questionable and doubtful remain distinct. Current ESPN depth supplies provisional position-specific roles; it never proves game-day participation. Unknown role fails closed.

## G–H. Snap/routes and target/carry coverage

{
  "historicalRows": 159,
  "players": 4,
  "positions": {
    "QB": 60,
    "RB": 34,
    "WR": 65,
    "TE": 0
  },
  "metrics": {
    "PASS_ATTEMPTS": 30,
    "RUSH_ATTEMPTS": 64,
    "TARGETS": 65
  },
  "snapCounts": "Provider exists for historical offense snaps/share; Phase 3C evaluation source does not contain snap rows.",
  "routes": "0 usable point-in-time rows in the frozen Phase 3C evaluation source.",
  "targetsCarries": "Exact player numerator and team denominator present for every accepted row; duplicate receiving views reconciled exactly."
}

## I–L. Position-specific opportunity models

QB: pass attempts; designed-rush/scramble split unavailable. RB: team rush volume, carry share/carries, and targets when present. WR: team pass volume/target share/targets; routes unavailable. TE: target share/targets, with high-snap/low-target blocking role diagnostic; routes unavailable. All outputs are shadow-only and missing metrics remain null.

## M–O. Early season, roster movement, and teammate dependency

A transparent six-current-game transition exposes current/prior weights. Prior usage is not transferred to a verified new team without current-team evidence. Rookie/new-team/role/injury flags increase uncertainty. Teammate absences are detected, but redistribution remains UNKNOWN unless measured evidence exists; no fixed percentage is added.

## P. Chronological split

{
  "development": 84,
  "validation": 26,
  "lockedHoldout": 49
}

## Q–R. Baselines and candidates

Baselines: last game, last three, season average, previous-season average. Candidates: weighted recent role, share × team volume, early-season prior blend. Validation selects the candidate; the locked holdout does not.

## S–T. MAE / RMSE / bias and position results

{
  "selected": "EARLY_SEASON_PRIOR_BLEND",
  "baseline": "PREVIOUS_SEASON_AVERAGE",
  "candidates": {
    "LAST_GAME": {
      "validation": {
        "n": 26,
        "mae": 4.8076923076923075,
        "rmse": 6.0351534299532865,
        "bias": -0.4230769230769231,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 5.816326530612245,
        "rmse": 7.694418862568703,
        "bias": -0.10204081632653061,
        "coverage": 1
      }
    },
    "LAST_3_AVERAGE": {
      "validation": {
        "n": 26,
        "mae": 3.8974358974358974,
        "rmse": 4.988019835600284,
        "bias": -0.5897435897435899,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.517006802721089,
        "rmse": 6.419570418162067,
        "bias": -0.05442176870748306,
        "coverage": 1
      }
    },
    "SEASON_AVERAGE": {
      "validation": {
        "n": 26,
        "mae": 3.9120192307692303,
        "rmse": 5.243542082764088,
        "bias": -0.8876602564102564,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.593557193107013,
        "rmse": 6.170925742264229,
        "bias": 0.7866365627169949,
        "coverage": 1
      }
    },
    "PREVIOUS_SEASON_AVERAGE": {
      "validation": {
        "n": 26,
        "mae": 3.619574175824176,
        "rmse": 4.659041683194417,
        "bias": -2.185554029304029,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.409959554917538,
        "rmse": 5.908390657343969,
        "bias": -0.22924138020176427,
        "coverage": 1
      }
    },
    "WEIGHTED_RECENT_ROLE": {
      "validation": {
        "n": 26,
        "mae": 3.597178891799636,
        "rmse": 4.612825583490013,
        "bias": -1.121203130374957,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.372653061224489,
        "rmse": 6.176712684902605,
        "bias": 0.07387755102040819,
        "coverage": 1
      }
    },
    "SHARE_TEAM_VOLUME": {
      "validation": {
        "n": 26,
        "mae": 3.610553549133717,
        "rmse": 4.599110112017839,
        "bias": -1.0700259042139417,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.378546985011378,
        "rmse": 6.197860023328177,
        "bias": 0.04527806320699129,
        "coverage": 1
      }
    },
    "EARLY_SEASON_PRIOR_BLEND": {
      "validation": {
        "n": 26,
        "mae": 3.5507478632478637,
        "rmse": 4.703059267200205,
        "bias": -1.3090277777777783,
        "coverage": 1
      },
      "holdout": {
        "n": 49,
        "mae": 4.603534517370052,
        "rmse": 6.173770050419837,
        "bias": 0.7766592384539562,
        "coverage": 1
      }
    }
  },
  "byPosition": {
    "QB": {
      "LAST_GAME": {
        "n": 18,
        "mae": 4.555555555555555,
        "rmse": 6.8068592855540455,
        "bias": -0.2222222222222222,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 18,
        "mae": 4.351851851851851,
        "rmse": 6.655082528172744,
        "bias": -1.351851851851852,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 18,
        "mae": 4.438959805626471,
        "rmse": 6.265593309484561,
        "bias": -1.667354867354867,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 18,
        "mae": 4.632671803505136,
        "rmse": 6.344503858577322,
        "bias": -2.6043889752223084,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 18,
        "mae": 4.364444444444445,
        "rmse": 6.451607896055403,
        "bias": -1.74,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 18,
        "mae": 4.377465081672566,
        "rmse": 6.450368197937786,
        "bias": -1.897479660460792,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 18,
        "mae": 4.466120299453632,
        "rmse": 6.273216281163554,
        "bias": -1.6945153611820278,
        "coverage": null
      }
    },
    "RB": {
      "LAST_GAME": {
        "n": 11,
        "mae": 8.363636363636363,
        "rmse": 10.43595184490092,
        "bias": -0.36363636363636365,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 11,
        "mae": 5.454545454545454,
        "rmse": 7.38822431886435,
        "bias": 1.212121212121212,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 11,
        "mae": 5.570300874111035,
        "rmse": 7.383309963390943,
        "bias": 3.1092619130720736,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 11,
        "mae": 4.612878120097371,
        "rmse": 6.493931166359064,
        "bias": 0.3643932716125226,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 11,
        "mae": 4.814545454545455,
        "rmse": 7.1512440112955815,
        "bias": 1.5054545454545456,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 11,
        "mae": 4.907397185358878,
        "rmse": 7.232909285179226,
        "bias": 1.667769062631183,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 11,
        "mae": 5.570300874111035,
        "rmse": 7.383309963390943,
        "bias": 3.1092619130720736,
        "coverage": null
      }
    },
    "WR": {
      "LAST_GAME": {
        "n": 20,
        "mae": 5.55,
        "rmse": 6.591661399070799,
        "bias": 0.15,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 20,
        "mae": 4.15,
        "rmse": 5.575242894559244,
        "bias": 0.4166666666666667,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 20,
        "mae": 4.195485817287287,
        "rmse": 5.289858711640609,
        "bias": 1.7177849070863775,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 20,
        "mae": 4.09791332033979,
        "rmse": 5.109370020340737,
        "bias": 1.5818923968188674,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 20,
        "mae": 4.137,
        "rmse": 5.280509445119856,
        "bias": 0.9190000000000002,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 20,
        "mae": 4.088653087825184,
        "rmse": 5.281404796852579,
        "bias": 0.901389964824691,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 20,
        "mae": 4.195485817287287,
        "rmse": 5.289858711640609,
        "bias": 1.7177849070863775,
        "coverage": null
      }
    },
    "TE": {
      "LAST_GAME": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 0,
        "mae": null,
        "rmse": null,
        "bias": null,
        "coverage": null
      }
    }
  },
  "byMetric": {
    "PASS_ATTEMPTS": {
      "LAST_GAME": {
        "n": 9,
        "mae": 6.666666666666667,
        "rmse": 9.140872800534726,
        "bias": -0.2222222222222222,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 9,
        "mae": 6.851851851851851,
        "rmse": 9.110433579144297,
        "bias": -2.111111111111111,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 9,
        "mae": 6.876019042685709,
        "rmse": 8.524568066276144,
        "bias": -2.4587350920684248,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 9,
        "mae": 7.161405878072545,
        "rmse": 8.601549794559284,
        "bias": -3.463570380237047,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 9,
        "mae": 6.842222222222222,
        "rmse": 8.821743339927519,
        "bias": -2.5355555555555553,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 9,
        "mae": 6.829425463540011,
        "rmse": 8.795877196747186,
        "bias": -2.6360115687316905,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 9,
        "mae": 6.900710400710401,
        "rmse": 8.531838383580846,
        "bias": -2.4834264500931167,
        "coverage": null
      }
    },
    "RUSH_ATTEMPTS": {
      "LAST_GAME": {
        "n": 20,
        "mae": 5.7,
        "rmse": 8,
        "bias": -0.3,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 20,
        "mae": 3.8333333333333335,
        "rmse": 5.70379990298865,
        "bias": 0.3999999999999999,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 20,
        "mae": 3.964520736616324,
        "rmse": 5.7108206550322125,
        "bias": 1.3159054630010512,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 20,
        "mae": 3.4838549440755324,
        "rmse": 5.111515225058051,
        "bias": -0.5849271072065192,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 20,
        "mae": 3.497,
        "rmse": 5.528802763709336,
        "bias": 0.403,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 20,
        "mae": 3.565545566859688,
        "rmse": 5.6039635128319905,
        "bias": 0.39574649596169836,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 20,
        "mae": 3.9778540699496583,
        "rmse": 5.713466091276361,
        "bias": 1.302572129667718,
        "coverage": null
      }
    },
    "TARGETS": {
      "LAST_GAME": {
        "n": 20,
        "mae": 5.55,
        "rmse": 6.591661399070799,
        "bias": 0.15,
        "coverage": null
      },
      "LAST_3_AVERAGE": {
        "n": 20,
        "mae": 4.15,
        "rmse": 5.575242894559244,
        "bias": 0.4166666666666667,
        "coverage": null
      },
      "SEASON_AVERAGE": {
        "n": 20,
        "mae": 4.195485817287287,
        "rmse": 5.289858711640609,
        "bias": 1.7177849070863775,
        "coverage": null
      },
      "PREVIOUS_SEASON_AVERAGE": {
        "n": 20,
        "mae": 4.09791332033979,
        "rmse": 5.109370020340737,
        "bias": 1.5818923968188674,
        "coverage": null
      },
      "WEIGHTED_RECENT_ROLE": {
        "n": 20,
        "mae": 4.137,
        "rmse": 5.280509445119856,
        "bias": 0.9190000000000002,
        "coverage": null
      },
      "SHARE_TEAM_VOLUME": {
        "n": 20,
        "mae": 4.088653087825184,
        "rmse": 5.281404796852579,
        "bias": 0.901389964824691,
        "coverage": null
      },
      "EARLY_SEASON_PRIOR_BLEND": {
        "n": 20,
        "mae": 4.195485817287287,
        "rmse": 5.289858711640609,
        "bias": 1.7177849070863775,
        "coverage": null
      }
    }
  }
}

## U. Ablation

[
  {
    "family": "team volume / share",
    "comparison": "SHARE_TEAM_VOLUME versus WEIGHTED_RECENT_ROLE",
    "status": "EVALUATED",
    "holdoutMaeDelta": 0.0058939237868891325
  },
  {
    "family": "prior-season evidence",
    "comparison": "EARLY_SEASON_PRIOR_BLEND versus WEIGHTED_RECENT_ROLE",
    "status": "EVALUATED",
    "holdoutMaeDelta": 0.2308814561455632
  },
  {
    "family": "role",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  },
  {
    "family": "historical depth chart",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  },
  {
    "family": "injury status",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  },
  {
    "family": "teammate status",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  },
  {
    "family": "routes",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  },
  {
    "family": "coaching/QB change",
    "comparison": null,
    "status": "UNAVAILABLE_POINT_IN_TIME",
    "holdoutMaeDelta": null
  }
]

## V. Sample sizes

{
  "rows": 159,
  "partitions": {
    "development": 84,
    "validation": 26,
    "lockedHoldout": 49
  },
  "sampleLabel": "INSUFFICIENT FOR MODEL CONCLUSION",
  "positions": [
    "QB",
    "RB",
    "WR"
  ],
  "missingPositions": [
    "TE"
  ]
}

## W. Forward archive integration

Future manual snapshots accept one optional content-addressed opportunity-projection component per game. Each canonical player row records availability, role, relevant opportunity metrics, uncertainty, timestamps, flags, method, and failure states. Existing Phase 2 snapshots remain schema-compatible and unchanged.

## X. API impact

{
  "additionalPaidRequestsPerManualRun": 0,
  "additionalOddsCreditsPerManualRun": 0,
  "additionalProviderCalls": "None. Forward opportunity output reuses the already bounded Phase 2 forecast-input calls; unfetched players remain MODEL_UNAVAILABLE."
}

## Y. Tests / regression / typecheck / lint

PASS. Phase 3C focused tests: 26/26. Combined opportunity plus Phase 2 forward-integrity suite: 74/74. Full repository regression: 390/390. TypeScript: PASS. ESLint: PASS. Existing protected archive: 2 snapshots, hash verification PASS. Collection remains MANUAL_ONLY; manual collection is AVAILABLE and scheduled collection is DISABLED_BY_CONFIGURATION. The local status health field is NOT_CONFIGURED because scheduler and durable-storage environment flags are absent.

## Z. Final decision

PLAYER OPPORTUNITY ENGINE BLOCKED BY DATA QUALITY

Reason: the frozen data does not include TE opportunity rows or point-in-time routes, historical roles, injuries, depth changes, or teammate availability. The sample remains INSUFFICIENT FOR MODEL CONCLUSION. No production promotion is allowed.
