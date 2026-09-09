# Phase 8 — forward validation monitoring and data quality

Generated: 2026-09-09T16:03:46.000Z

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
  "eligibleGames": 2,
  "gamesWithAtLeastOneValidPregameSnapshot": 2,
  "gamesWithMorningSnapshot": 1,
  "gamesWithAfternoonSnapshot": 1,
  "gamesWithManualSnapshot": 1,
  "gamesWithMultipleValidSnapshots": 1,
  "gamesFinalized": 0,
  "gamesPending": 2,
  "gamesCanceledPostponed": 0,
  "gamesWithCaptureFailure": 1,
  "regime": {
    "fbsFbs": 1,
    "fbsFcs": 1
  },
  "seasonStage": {
    "weeks0To2": 2,
    "weeks3To5": 0,
    "week6Plus": 0
  }
}
```

## D. Eligible-universe capture rate

```json
{
  "eligibleGames": 2,
  "capturedGames": 2,
  "missingGames": 0,
  "captureRatePercent": 100,
  "byRegime": {
    "FBS_FBS": {
      "eligible": 1,
      "captured": 1
    },
    "FBS_FCS": {
      "eligible": 1,
      "captured": 1
    }
  },
  "missingEventIds": []
}
```

## E. Feature coverage table

```json
{
  "MODEL_A": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "MARKET_QUOTE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "TEAM_IDENTITY": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "SCHEDULE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "CURRENT_SEASON_RESULTS": {
    "PASS": 1,
    "PARTIAL": 1,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "TEAM_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 1,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 1,
    "coveragePercent": 50
  },
  "OFFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "DEFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "RUSH_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 2,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "PASS_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 2,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "QB_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "QB_AVAILABILITY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "ROSTER_EVIDENCE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "RETURNING_PRODUCTION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "TRANSFER_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "TALENT_EVIDENCE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "COACHING_EVIDENCE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "INJURY_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 2,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 2,
    "coveragePercent": 0
  },
  "WEATHER": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "VENUE": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "NEUTRAL_SITE_STATUS": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
    "missing": 0,
    "coveragePercent": 100
  },
  "FBS_FCS_CLASSIFICATION": {
    "PASS": 2,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 2,
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
      "PASS": 0,
      "PARTIAL": 1,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 1,
      "missing": 1,
      "coveragePercent": 50
    },
    "QB_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 2,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 2,
      "coveragePercent": 0
    },
    "ROSTER_EVIDENCE": {
      "PASS": 2,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 2,
      "missing": 0,
      "coveragePercent": 100
    },
    "TALENT_EVIDENCE": {
      "PASS": 2,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 2,
      "missing": 0,
      "coveragePercent": 100
    },
    "TRANSFER_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 2,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 2,
      "coveragePercent": 0
    },
    "COACHING_EVIDENCE": {
      "PASS": 2,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 2,
      "missing": 0,
      "coveragePercent": 100
    },
    "INJURY_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 2,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 2,
      "coveragePercent": 0
    }
  },
  "fcsQuality": {
    "available": 1,
    "total": 1
  }
}
```

## G. Provider reliability

```json
[
  {
    "provider": "CollegeFootballData",
    "requests": 8,
    "successes": 4,
    "usableFeatureAttachments": 7,
    "partialResponses": 0,
    "failures": 9,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 20,
    "operationalSuccessPercent": 50
  },
  {
    "provider": "ESPN",
    "requests": 41,
    "successes": 16,
    "usableFeatureAttachments": 89,
    "partialResponses": 0,
    "failures": 0,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 0,
    "operationalSuccessPercent": 39
  },
  {
    "provider": "The Odds API",
    "requests": 7,
    "successes": 0,
    "usableFeatureAttachments": 0,
    "partialResponses": 0,
    "failures": 0,
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
    "successes": 2,
    "usableFeatureAttachments": 6,
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
  "gamesSuccessfullyCanonicalized": 2,
  "totalGames": 2,
  "teamsSuccessfullyMatched": 4,
  "totalTeams": 4,
  "providerAliasesUsed": 2,
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
    "n": 1,
    "meanMinutes": 1916.2668666666666,
    "medianMinutes": 1916.2668666666666,
    "minimumMinutes": 1916.2668666666666,
    "maximumMinutes": 1916.2668666666666,
    "ranges": {
      "over24h": 1,
      "h12To24": 0,
      "h6To12": 0,
      "h3To6": 0,
      "h1To3": 0,
      "under1h": 0
    }
  },
  "afternoon": {
    "n": 1,
    "meanMinutes": 93.35025,
    "medianMinutes": 93.35025,
    "minimumMinutes": 93.35025,
    "maximumMinutes": 93.35025,
    "ranges": {
      "over24h": 0,
      "h12To24": 0,
      "h6To12": 0,
      "h3To6": 0,
      "h1To3": 1,
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
    "MARKET_QUOTE": 100,
    "TEAM_IDENTITY": 100,
    "SCHEDULE": 100,
    "CURRENT_SEASON_RESULTS": 100,
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
    "fbsFbs": 1,
    "fbsFcs": 1
  },
  "coverage": {
    "available": 1,
    "total": 1
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
      "providerSuccess": false,
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
- CURRENT N: 2
- FINALIZED N: 0
- FBS/FBS N: 1
- FBS/FCS N: 1
- 7 AM: COMPLETED
- 2 PM: NOT_REQUIRED
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

**FORWARD COLLECTION HEALTHY — CONTINUE ACCUMULATING DATA**
