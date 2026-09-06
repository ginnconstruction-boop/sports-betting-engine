# College spread model v2 research protocol — September 6, 2026

## Decision

The current score-only ridge model remains the frozen production research
control. It will not be tuned to the September 5 slate. Totals, Kelly staking
and real-money recommendations remain disabled.

All games before September 7, 2026 at 12:00 a.m. Central are already-inspected
development evidence. Games at or after that cutoff form the new immutable
forward sample. Forecasts and every input snapshot must be saved before kickoff.

## What public systems suggest testing

- ESPN's published College FPI description separates offense, defense and
  special teams; uses opponent adjustment; blends prior performance, returning
  starters/QB status, recruiting and coaching tenure; and reduces but does not
  erase the preseason prior as the season progresses.
- Massey describes schedule-strength adjustment and diminishing influence from
  large winning margins. This supports testing blowout down-weighting instead
  of treating every additional garbage-time point equally.
- Action Network's 2026 methodology describes weekly opponent-adjusted offense
  and defense, play-level PPA, a preseason prior that decays through the season,
  and historical residual simulation. Its author also discloses that the
  published 12-season calibration was not a strict untouched-season holdout, so
  it is a design reference rather than evidence we should trust its accuracy.
- CollegeFootballData exposes returning production, recruiting/talent,
  historical lines and advanced metrics. Its current free tier provides 1,000
  calls per month and requires a server-side API key. Opponent-adjusted metrics
  are listed beginning at the inexpensive paid tier, so the free tier should be
  tested first before any budget decision.

Sources:

- https://www.espn.com/blog/statsinfo/post/_/id/122612/an-inside-look-at-college-fpi
- https://masseyratings.com/faq.php
- https://www.actionnetwork.com/ncaaf/college-football-supercomputer-2026/embed
- https://collegefootballdata.com/api-tiers
- https://api.collegefootballdata.com/getting-started
- https://api.collegefootballdata.com/api/ratings

## Candidate feature families

1. Opponent-adjusted offensive and defensive efficiency, with play count and
   week/version attached to every snapshot.
2. A declining preseason prior using returning production, confirmed QB
   continuity, recruiting/talent, transfer movement and coaching continuity.
3. A season-scoped FBS/FCS quality interaction. Missing FCS quality must remain
   unknown and may not receive a fixed points adjustment.
4. Empirically fitted home field and explicit neutral-site treatment.
5. Garbage-time/blowout down-weighting.
6. Market consensus as a separate benchmark. A market feature may be tested
   only in a separately labeled market-informed candidate.

## Locked promotion gates

Before any v2 candidate can replace the research control it needs, on the same
future games:

- 300 forward games, including 75 Week 1-3 games and 50 FBS/FCS games;
- margin RMSE at least 5% better than the frozen v1 control;
- margin RMSE better than the archived pregame market benchmark;
- Brier score no worse than 0.250 and no populated calibration bucket more than
  five percentage points from observed results;
- at least 100 verified CLV observations, positive average spread CLV and more
  than 50% positive CLV.

Passing these gates would permit a new paper-only review, not real-money use.

## Immediate blocker

The code already has a CFBD ingestion adapter, but neither the local environment
nor the inspected production scan reports a configured `CFBD_API_KEY`. A free
key must be created by the account owner and stored only in the server-side
environment. No key should be pasted into source control or browser code.
