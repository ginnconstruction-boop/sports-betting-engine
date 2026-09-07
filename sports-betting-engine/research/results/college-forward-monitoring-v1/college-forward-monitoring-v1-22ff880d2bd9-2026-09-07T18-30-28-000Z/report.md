# Phase 8 — forward validation monitoring and data quality

Generated: 2026-09-07T18:30:28.000Z

## A. Phase 7 operational verification

Workflow configured: true. Schedules: 07:00 America/Chicago and 14:00 America/Chicago; exactly 2 scheduled runs/day. DST uses America/Chicago. Required secrets verified: UNKNOWN — requires an authenticated run. Provider access verified by scheduled success: false. Authority: research/forward-archive on default Git branch.

## B. Scheduled run evidence

```json
[
  {
    "trigger": "SCHEDULED_0700_CT",
    "status": "AWAITING_FIRST_SCHEDULED_EXECUTION",
    "scheduledTime": null,
    "actualStartTime": null,
    "actualCompletionTime": null,
    "eligibleGamesDiscovered": null,
    "snapshotsCreated": null,
    "snapshotsDeduplicated": null,
    "gamesSkippedAfterKickoff": null,
    "providerRequests": null,
    "cacheHits": null,
    "failures": null,
    "archiveCommitHash": null
  },
  {
    "trigger": "SCHEDULED_1400_CT",
    "status": "AWAITING_FIRST_SCHEDULED_EXECUTION",
    "scheduledTime": null,
    "actualStartTime": null,
    "actualCompletionTime": null,
    "eligibleGamesDiscovered": null,
    "snapshotsCreated": null,
    "snapshotsDeduplicated": null,
    "gamesSkippedAfterKickoff": null,
    "providerRequests": null,
    "cacheHits": null,
    "failures": null,
    "archiveCommitHash": null
  }
]
```

## C. Current archive counts

```json
{
  "eligibleGames": 1,
  "gamesWithAtLeastOneValidPregameSnapshot": 1,
  "gamesWithMorningSnapshot": 0,
  "gamesWithAfternoonSnapshot": 0,
  "gamesWithManualSnapshot": 1,
  "gamesWithMultipleValidSnapshots": 0,
  "gamesFinalized": 0,
  "gamesPending": 1,
  "gamesCanceledPostponed": 0,
  "gamesWithCaptureFailure": 0,
  "regime": {
    "fbsFbs": 1,
    "fbsFcs": 0
  },
  "seasonStage": {
    "weeks0To2": 1,
    "weeks3To5": 0,
    "week6Plus": 0
  }
}
```

## D. Eligible-universe capture rate

```json
{
  "eligibleGames": 1,
  "capturedGames": 1,
  "missingGames": 0,
  "captureRatePercent": 100,
  "byRegime": {
    "FBS_FBS": {
      "eligible": 1,
      "captured": 1
    },
    "FBS_FCS": {
      "eligible": 0,
      "captured": 0
    }
  },
  "missingEventIds": []
}
```

## E. Feature coverage table

```json
{
  "MODEL_A": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "MARKET_QUOTE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "TEAM_IDENTITY": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "SCHEDULE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "CURRENT_SEASON_RESULTS": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "TEAM_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "OFFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "DEFENSIVE_EFFICIENCY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "RUSH_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "PASS_INFORMATION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "QB_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "QB_AVAILABILITY": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "ROSTER_EVIDENCE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "RETURNING_PRODUCTION": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "TRANSFER_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "TALENT_EVIDENCE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "COACHING_EVIDENCE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "INJURY_EVIDENCE": {
    "PASS": 0,
    "PARTIAL": 0,
    "FAIL": 1,
    "UNKNOWN": 0,
    "available": 0,
    "missing": 1,
    "coveragePercent": 0
  },
  "WEATHER": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "VENUE": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "NEUTRAL_SITE_STATUS": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
    "missing": 0,
    "coveragePercent": 100
  },
  "FBS_FCS_CLASSIFICATION": {
    "PASS": 1,
    "PARTIAL": 0,
    "FAIL": 0,
    "UNKNOWN": 0,
    "available": 1,
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
      "PARTIAL": 0,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 1,
      "coveragePercent": 0
    },
    "QB_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 1,
      "coveragePercent": 0
    },
    "ROSTER_EVIDENCE": {
      "PASS": 1,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 1,
      "missing": 0,
      "coveragePercent": 100
    },
    "TALENT_EVIDENCE": {
      "PASS": 1,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 1,
      "missing": 0,
      "coveragePercent": 100
    },
    "TRANSFER_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 1,
      "coveragePercent": 0
    },
    "COACHING_EVIDENCE": {
      "PASS": 1,
      "PARTIAL": 0,
      "FAIL": 0,
      "UNKNOWN": 0,
      "available": 1,
      "missing": 0,
      "coveragePercent": 100
    },
    "INJURY_EVIDENCE": {
      "PASS": 0,
      "PARTIAL": 0,
      "FAIL": 1,
      "UNKNOWN": 0,
      "available": 0,
      "missing": 1,
      "coveragePercent": 0
    }
  },
  "fcsQuality": {
    "available": 0,
    "total": 0
  }
}
```

## G. Provider reliability

```json
[
  {
    "provider": "CollegeFootballData",
    "requests": 0,
    "successes": 0,
    "usableFeatureAttachments": 0,
    "partialResponses": 0,
    "failures": 4,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 4,
    "operationalSuccessPercent": null
  },
  {
    "provider": "ESPN",
    "requests": 5,
    "successes": 5,
    "usableFeatureAttachments": 23,
    "partialResponses": 0,
    "failures": 0,
    "rateLimits": 0,
    "timeouts": 0,
    "entityMismatches": 0,
    "staleResponses": 0,
    "cacheHits": 0,
    "operationalSuccessPercent": 100
  },
  {
    "provider": "The Odds API",
    "requests": 1,
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
  }
]
```

## H. Entity match quality

```json
{
  "gamesSuccessfullyCanonicalized": 1,
  "totalGames": 1,
  "teamsSuccessfullyMatched": 2,
  "totalTeams": 2,
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
    "n": 0,
    "meanMinutes": null,
    "medianMinutes": null,
    "minimumMinutes": null,
    "maximumMinutes": null,
    "ranges": {
      "over24h": 0,
      "h12To24": 0,
      "h6To12": 0,
      "h3To6": 0,
      "h1To3": 0,
      "under1h": 0
    }
  },
  "afternoon": {
    "n": 0,
    "meanMinutes": null,
    "medianMinutes": null,
    "minimumMinutes": null,
    "maximumMinutes": null,
    "ranges": {
      "over24h": 0,
      "h12To24": 0,
      "h6To12": 0,
      "h3To6": 0,
      "h1To3": 0,
      "under1h": 0
    }
  },
  "manual": {
    "n": 1,
    "meanMinutes": 599.5253666666666,
    "medianMinutes": 599.5253666666666,
    "minimumMinutes": 599.5253666666666,
    "maximumMinutes": 599.5253666666666,
    "ranges": {
      "over24h": 0,
      "h12To24": 0,
      "h6To12": 1,
      "h3To6": 0,
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
    "MODEL_A": null,
    "MARKET_QUOTE": null,
    "TEAM_IDENTITY": null,
    "SCHEDULE": null,
    "CURRENT_SEASON_RESULTS": null,
    "TEAM_EFFICIENCY": null,
    "OFFENSIVE_EFFICIENCY": null,
    "DEFENSIVE_EFFICIENCY": null,
    "RUSH_INFORMATION": null,
    "PASS_INFORMATION": null,
    "QB_EVIDENCE": null,
    "QB_AVAILABILITY": null,
    "ROSTER_EVIDENCE": null,
    "RETURNING_PRODUCTION": null,
    "TRANSFER_EVIDENCE": null,
    "TALENT_EVIDENCE": null,
    "COACHING_EVIDENCE": null,
    "INJURY_EVIDENCE": null,
    "WEATHER": null,
    "VENUE": null,
    "NEUTRAL_SITE_STATUS": null,
    "FBS_FCS_CLASSIFICATION": null
  },
  "afternoon": {
    "MODEL_A": null,
    "MARKET_QUOTE": null,
    "TEAM_IDENTITY": null,
    "SCHEDULE": null,
    "CURRENT_SEASON_RESULTS": null,
    "TEAM_EFFICIENCY": null,
    "OFFENSIVE_EFFICIENCY": null,
    "DEFENSIVE_EFFICIENCY": null,
    "RUSH_INFORMATION": null,
    "PASS_INFORMATION": null,
    "QB_EVIDENCE": null,
    "QB_AVAILABILITY": null,
    "ROSTER_EVIDENCE": null,
    "RETURNING_PRODUCTION": null,
    "TRANSFER_EVIDENCE": null,
    "TALENT_EVIDENCE": null,
    "COACHING_EVIDENCE": null,
    "INJURY_EVIDENCE": null,
    "WEATHER": null,
    "VENUE": null,
    "NEUTRAL_SITE_STATUS": null,
    "FBS_FCS_CLASSIFICATION": null
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
    "fbsFcs": 0
  },
  "coverage": {
    "available": 0,
    "total": 0
  },
  "gate": {
    "ready": false,
    "checks": {
      "finalized": false,
      "fcsQuality": false,
      "qb": false,
      "roster": false,
      "talent": false,
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
      "fcsQuality": false,
      "qb": false,
      "roster": false,
      "talent": false,
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
- CURRENT N: 1
- FINALIZED N: 0
- FBS/FBS N: 1
- FBS/FCS N: 0
- 7 AM: NOT_REQUIRED
- 2 PM: NOT_REQUIRED
- LEAKAGE: PASS
- NEXT MILESTONE: 25
- MODEL B V2: NOT READY
- ALERTS: CRITICAL_FEATURE_COVERAGE_LOW, PROVIDER_FAILURE_SPIKE

## S. Tests added

Scheduled configuration/execution semantics, dataset counting, transparent coverage, six-stage aggregation, provider reliability, entity matching, timing, contamination, leakage, append-only corrections, missed-capture classification, universe capture rate, FBS/FCS isolation, minimum-N suppression, milestones, readiness, deterministic reporting, and hash integrity.

## T. Full regression results

314/314_PASS

## U. Typecheck/lint

TYPECHECK_PASS_AND_LINT_PASS

## V. Production impact

No production recommendation, coefficient, qualification, calibration, Kelly, staking, parlay, totals, or paper-selection behavior changed.

## W. Final decision

**FORWARD COLLECTION DEGRADED — FIX DATA PIPELINE**
