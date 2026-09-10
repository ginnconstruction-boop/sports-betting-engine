# Phase 8 — forward validation monitoring and data quality

Generated: 2026-09-10T21:31:18.000Z

## A. Phase 7 operational verification

Workflow configured: true. Schedules: 07:00 America/Chicago and 14:00 America/Chicago; exactly 2 scheduled runs/day. DST uses America/Chicago. Required secrets verified: true. Provider access verified by scheduled success: true. Authority: research/forward-archive on default Git branch.

## B. Scheduled run evidence

```json
[
  {
    "trigger": "SCHEDULED_0700_CT",
    "status": "SUCCESS",
    "scheduledTime": "2026-09-08T12:00:00.000Z",
    "actualStartTime": "2026-09-08T16:09:00.040Z",
    "actualCompletionTime": "2026-09-08T16:09:00.610Z",
    "eligibleGamesDiscovered": 0,
    "snapshotsCreated": 0,
    "snapshotsDeduplicated": 0,
    "gamesSkippedAfterKickoff": 1,
    "providerRequests": 3,
    "cacheHits": 0,
    "failures": 0,
    "archiveCommitHash": "7fc51440a075678a667d8d1a268d1690e7ededaf"
  },
  {
    "trigger": "SCHEDULED_1400_CT",
    "status": "SUCCESS",
    "scheduledTime": "2026-09-07T19:00:00.000Z",
    "actualStartTime": "2026-09-07T21:56:37.798Z",
    "actualCompletionTime": "2026-09-07T21:56:38.998Z",
    "eligibleGamesDiscovered": 1,
    "snapshotsCreated": 1,
    "snapshotsDeduplicated": 0,
    "gamesSkippedAfterKickoff": 2,
    "providerRequests": 6,
    "cacheHits": 4,
    "failures": 0,
    "archiveCommitHash": "a2774cc95ac1eaf00af6cb4eb55436eb1ef9ad92"
  }
]
```

## C. Current archive counts

```json
{
  "eligibleGames": 7,
  "gamesWithAtLeastOneValidPregameSnapshot": 7,
  "gamesWithMorningSnapshot": 6,
  "gamesWithAfternoonSnapshot": 7,
  "gamesWithManualSnapshot": 1,
  "gamesWithMultipleValidSnapshots": 7,
  "gamesFinalized": 0,
  "gamesPending": 7,
  "gamesCanceledPostponed": 0,
  "gamesWithCaptureFailure": 1,
  "regime": {
    "fbsFbs": 3,
    "fbsFcs": 4
  },
  "seasonStage": {
    "weeks0To2": 7,
    "weeks3To5": 0,
    "week6Plus": 0
  }
}
```

## D. Eligible-universe capture rate

```json
{
  "eligibleGames": 7,
  "capturedGames": 7,
  "missingGames": 0,
  "captureRatePercent": 100,
  "byRegime": {
    "FBS_FBS": {
      "eligible": 3,
      "captured": 3
    },
    "FBS_FCS": {
      "eligible": 4,
      "captured": 4
    }
  },
  "missingEventIds": []
}
```

## E. Feature coverage table

```json
{
  "MODEL_A": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "MARKET_QUOTE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 6,
    "available": 1,
    "missing": 6,
    "coveragePercent": 14.3
  },
  "TEAM_IDENTITY": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "SCHEDULE": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "CURRENT_SEASON_RESULTS": {
    "PASS": 3,
    "PARTIAL": 2,
    "FAIL": 0,
    "UNKNOWN": 2,
    "available": 5,
    "missing": 2,
    "coveragePercent": 71.4
  },
  "TEAM_EFFICIENCY": {
    "PASS": 2,
    "PARTIAL": 4,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 6,
    "missing": 1,
    "coveragePercent": 85.7
  },
  "OFFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 5,
    "UNKNOWN": 2,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "DEFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 5,
    "UNKNOWN": 2,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "RUSH_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 7,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "PASS_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 7,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "QB_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 7,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "QB_AVAILABILITY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 7,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "ROSTER_EVIDENCE": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "RETURNING_PRODUCTION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 7,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "TRANSFER_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 7,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "TALENT_EVIDENCE": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "COACHING_EVIDENCE": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "INJURY_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 7,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 7,
    "coveragePercent": 0
  },
  "WEATHER": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "VENUE": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "NEUTRAL_SITE_STATUS": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  },
  "FBS_FCS_CLASSIFICATION": {
    "PASS": 7,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 7,
    "missing": 0,
    "coveragePercent": 100
  }
}
```

## F. Critical feature coverage

```json
{
  "critical": {
    "TEAM_EFFICIENCY": {
      "PASS": 2,
      "PARTIAL": 4,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 6,
      "missing": 1,
      "coveragePercent": 85.7
    },
    "QB_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 7,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 7,
      "coveragePercent": 0
    },
    "ROSTER_EVIDENCE": {
      "PASS": 7,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 7,
      "missing": 0,
      "coveragePercent": 100
    },
    "TALENT_EVIDENCE": {
      "PASS": 7,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 7,
      "missing": 0,
      "coveragePercent": 100
    },
    "TRANSFER_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 7,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 7,
      "coveragePercent": 0
    },
    "COACHING_EVIDENCE": {
      "PASS": 7,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 7,
      "missing": 0,
      "coveragePercent": 100
    },
    "INJURY_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 7,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 7,
      "coveragePercent": 0
    }
  },
  "fcsQuality": {
    "available": 4,
    "total": 4
  }
}
```

## G. Provider reliability

```json
[
  {
    "provider": "CollegeFootballData",
    "requests": 12,
    "successes": 6,
    "usableFeatureAttachments": 50,
    "partialResponses": 0,
    "failures": 18,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 28,
    "operationalSuccessPercent": 50
  },
  {
    "provider": "ESPN",
    "requests": 56,
    "successes": 65,
    "usableFeatureAttachments": 357,
    "partialResponses": 0,
    "failures": 0,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 0,
    "operationalSuccessPercent": 116.1
  },
  {
    "provider": "The Odds API",
    "requests": 7,
    "successes": 0,
    "usableFeatureAttachments": 0,
    "partialResponses": 0,
    "failures": 16,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 0,
    "operationalSuccessPercent": 0
  },
  {
    "provider": "Verified schedule identity",
    "requests": 0,
    "successes": 8,
    "usableFeatureAttachments": 32,
    "partialResponses": 0,
    "failures": 0,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 0,
    "operationalSuccessPercent": null
  }
]
```

## H. Entity match quality

```json
{
  "gamesSuccessfullyCanonicalized": 7,
  "totalGames": 7,
  "teamsSuccessfullyMatched": 14,
  "totalTeams": 14,
  "providerAliasesUsed": 1,
  "ambiguousMatches": 0,
  "failedMatches": 0,
  "manualOverrides": 0,
  "matchPercent": 100
}
```

## I. Snapshot timing distribution

```json
{
  "morning": {
    "n": 7,
    "meanMinutes": 1685.6583095238095,
    "medianMinutes": 1862.2237666666667,
    "minimumMinutes": 482.22406666666666,
    "maximumMinutes": 1922.2231333333334,
    "ranges": {
      "over24h": 6,
      "h12To24": 0,
      "h6To12": 1,
      "h3To6": 0,
      "h1To3": 0,
      "under1h": 0
    }
  },
  "afternoon": {
    "n": 8,
    "meanMinutes": 1194.9732,
    "medianMinutes": 1528.7377000000001,
    "minimumMinutes": 93.35025,
    "maximumMinutes": 1588.7369833333332,
    "ranges": {
      "over24h": 6,
      "h12To24": 0,
      "h6To12": 0,
      "h3To6": 0,
      "h1To3": 2,
      "under1h": 0
    }
  },
  "manual": {
    "n": 2,
    "meanMinutes": 421.7760083333333,
    "medianMinutes": 421.7760083333333,
    "minimumMinutes": 244.02665,
    "maximumMinutes": 599.5253666666666,
    "ranges": {
      "over24h": 0,
      "h12To24": 0,
      "h6To12": 1,
      "h3To6": 1,
      "h1To3": 0,
      "under1h": 0
    }
  }
}
```

## J. Morning vs afternoon data completeness

```json
{
  "morning": {
    "MODEL_A": 100,
    "MARKET_QUOTE": 14.3,
    "TEAM_IDENTITY": 100,
    "SCHEDULE": 100,
    "CURRENT_SEASON_RESULTS": 71.4,
    "TEAM_EFFICIENCY": 100,
    "OFFENSIVE_EFFICIENCY": 0,
    "DEFENSIVE_EFFICIENCY": 0,
    "RUSH_INFORMATION": 0,
    "PASS_INFORMATION": 0,
    "QB_EVIDENCE": 0,
    "QB_AVAILABILITY": 0,
    "ROSTER_EVIDENCE": 100,
    "RETURNING_PRODUCTION": 0,
    "TRANSFER_EVIDENCE": 0,
    "TALENT_EVIDENCE": 100,
    "COACHING_EVIDENCE": 100,
    "INJURY_EVIDENCE": 0,
    "WEATHER": 100,
    "VENUE": 100,
    "NEUTRAL_SITE_STATUS": 100,
    "FBS_FCS_CLASSIFICATION": 100
  },
  "afternoon": {
    "MODEL_A": 100,
    "MARKET_QUOTE": 12.5,
    "TEAM_IDENTITY": 100,
    "SCHEDULE": 100,
    "CURRENT_SEASON_RESULTS": 75,
    "TEAM_EFFICIENCY": 87.5,
    "OFFENSIVE_EFFICIENCY": 0,
    "DEFENSIVE_EFFICIENCY": 0,
    "RUSH_INFORMATION": 0,
    "PASS_INFORMATION": 0,
    "QB_EVIDENCE": 0,
    "QB_AVAILABILITY": 0,
    "ROSTER_EVIDENCE": 100,
    "RETURNING_PRODUCTION": 0,
    "TRANSFER_EVIDENCE": 0,
    "TALENT_EVIDENCE": 100,
    "COACHING_EVIDENCE": 100,
    "INJURY_EVIDENCE": 0,
    "WEATHER": 100,
    "VENUE": 100,
    "NEUTRAL_SITE_STATUS": 100,
    "FBS_FCS_CLASSIFICATION": 100
  },
  "manual": {
    "MODEL_A": 100,
    "MARKET_QUOTE": 100,
    "TEAM_IDENTITY": 100,
    "SCHEDULE": 100,
    "CURRENT_SEASON_RESULTS": 100,
    "TEAM_EFFICIENCY": 0,
    "OFFENSIVE_EFFICIENCY": 0,
    "DEFENSIVE_EFFICIENCY": 0,
    "RUSH_INFORMATION": 0,
    "PASS_INFORMATION": 0,
    "QB_EVIDENCE": 0,
    "QB_AVAILABILITY": 0,
    "ROSTER_EVIDENCE": 100,
    "RETURNING_PRODUCTION": 0,
    "TRANSFER_EVIDENCE": 0,
    "TALENT_EVIDENCE": 100,
    "COACHING_EVIDENCE": 100,
    "INJURY_EVIDENCE": 0,
    "WEATHER": 100,
    "VENUE": 100,
    "NEUTRAL_SITE_STATUS": 100,
    "FBS_FCS_CLASSIFICATION": 100
  }
}
```

## K. Market/football separation audit

```json
{
  "status": "PASS",
  "violations": []
}
```

## L. Future-leakage audit

```json
{
  "status": "PASS",
  "violations": []
}
```

## M. FBS/FCS data status

```json
{
  "counts": {
    "fbsFbs": 3,
    "fbsFcs": 4
  },
  "coverage": {
    "available": 4,
    "total": 4
  },
  "gate": {
    "ready": false,
    "checks": {
      "finalized": false,
      "fcsQuality": true,
      "qb": false,
      "roster": true,
      "talent": true,
      "entityMatch": true,
      "zeroLeakage": true,
      "zeroContamination": true,
      "datasetHashValid": true
    }
  }
}
```

## N. Current Model A descriptive results

```json
{
  "status": "SUPPRESSED_MINIMUM_N",
  "n": 0,
  "minimumN": 25,
  "mae": null,
  "rmse": null,
  "bias": null
}
```

## O. Current market benchmark

```json
{
  "status": "SUPPRESSED_MINIMUM_N",
  "n": 0,
  "minimumN": 25,
  "mae": null,
  "rmse": null,
  "bias": null
}
```

## P. Forward holdout policy

Weeks 0–5 DEVELOPMENT; Weeks 6–9 VALIDATION; Week 10+ LOCKED_HOLDOUT. Fixed chronologically before outcomes; FBS/FBS and FBS/FCS stay separate; postseason excluded until separately declared.

## Q. Predeclared Model B v2 readiness gate

```json
{
  "fbsFbs": {
    "ready": false,
    "checks": {
      "finalized": false,
      "modelAIntegrity": true,
      "teamEfficiency": false,
      "qb": false,
      "roster": true,
      "talent": true,
      "transfers": false,
      "entityMatch": true,
      "providerSuccess": true,
      "zeroLeakage": true,
      "zeroContamination": true,
      "datasetHashValid": true,
      "development": false,
      "validation": false,
      "holdout": false
    }
  },
  "fbsFcs": {
    "ready": false,
    "checks": {
      "finalized": false,
      "fcsQuality": true,
      "qb": false,
      "roster": true,
      "talent": true,
      "entityMatch": true,
      "zeroLeakage": true,
      "zeroContamination": true,
      "datasetHashValid": true
    }
  },
  "partitions": {
    "DEVELOPMENT": 0,
    "VALIDATION": 0,
    "LOCKED_HOLDOUT": 0,
    "UNASSIGNED": 0
  },
  "policy": "Weeks 0–5 DEVELOPMENT; Weeks 6–9 VALIDATION; Week 10+ LOCKED_HOLDOUT. Fixed chronologically before outcomes; FBS/FBS and FBS/FCS stay separate; postseason excluded until separately declared."
}
```

## R. Research dashboard status

- FORWARD DATASET STATUS: COLLECTING
- CURRENT N: 7
- FINALIZED N: 0
- FBS/FBS N: 3
- FBS/FCS N: 4
- 7 AM: PROVIDER_FAILURE
- 2 PM: PROVIDER_FAILURE
- LEAKAGE: PASS
- NEXT MILESTONE: 25
- MODEL B V2: NOT READY
- ALERTS: CRITICAL_FEATURE_COVERAGE_LOW, PROVIDER_FAILURE_SPIKE

## S. Tests added

Scheduled configuration/execution semantics, dataset counting, transparent coverage, six-stage aggregation, provider reliability, entity matching, timing, contamination, leakage, append-only corrections, missed-capture classification, universe capture rate, FBS/FCS isolation, minimum-N suppression, milestones, readiness, deterministic reporting, and hash integrity.

## T. Full regression results

NOT RECORDED

## U. Typecheck/lint

NOT RECORDED

## V. Production impact

No production recommendation, coefficient, qualification, calibration, Kelly, staking, parlay, totals, or paper-selection behavior changed.

## W. Final decision

**FORWARD COLLECTION DEGRADED — FIX DATA PIPELINE**
