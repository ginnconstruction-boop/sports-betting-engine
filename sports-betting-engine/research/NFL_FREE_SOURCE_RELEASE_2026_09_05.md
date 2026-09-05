# NFL free-source expansion — September 5, 2026

## Result

Three zero-subscription data paths were verified and connected for paper
research:

1. The official NFL weekly injury report at
   `https://www.nfl.com/injuries/league/{season}/reg{week}`.
2. nflverse weekly team statistics for team/opponent diagnostics.
3. nflverse snap counts plus its schedule file for dated player snap-share
   diagnostics.

No sportsbook odds endpoint is called by these adapters. No new model
coefficient, recommendation, probability, Kelly stake, or real bet is enabled.

## Source findings

### Official weekly injury reports

NFL.com serves the report as five-column tables: player, position, injury,
practice status, and game status. The adapter verifies the official page title,
the exact table schema, season/week bounds, response size, and approved redirect
host before parsing. Requests are coalesced and cached for 15 minutes.

The Week 1 2026 page was reachable but had not published its structured team
tables at the September 5 audit. The system therefore reports `not posted yet`.
It does not infer that an absent player is healthy or active.

### Official game-day inactives

The free NFL.com inactives landing page is identified. The upcoming slate did
not yet expose a verified player structure, so no speculative scraper was
enabled. Automatic player-prop issuance still requires fresh, exact event,
team, and player availability evidence near kickoff.

### nflverse

The nflverse-data repository reports a CC-BY-4.0 license. The following release
assets were verified:

- 2025 snap counts: available; compressed file about 0.5 MB.
- 2025 weekly team statistics: available; compressed file about 0.08 MB.
- 2026 snap counts/team weekly statistics: correctly unavailable before Week 1.
- 2026 depth charts: available, but the existing ESPN current-depth adapter
  remains the primary depth diagnostic.

The adapters enforce fixed schemas, compressed/decompressed size limits,
approved redirect hosts, exact player-name-to-one-PFR-ID matching, chronological
cutoffs, regular-season-only filtering, and duplicate rejection. Cross-provider
name matching is explicitly diagnostic because no official ESPN-to-PFR player-ID
crosswalk is present.

## Live audit

- Drake Maye: one exact PFR identity, 17 dated 2025 snap rows, latest five mean
  offensive snap share 91%; zero 2026 rows as expected before Week 1.
- End-to-end Drake Maye forecast-input audit: exact ESPN player ID, 30 historical
  production rows, five of five recent workload games verified, 17 prior-season
  snap rows, and the official Week 1 report checked. No odds were requested and
  no paper pick was issued.
- New England and Seattle: 17 prior-season games each for separate offensive,
  opponent-allowed, sack, and QB-hit summaries.
- Current-season values: unavailable, not zero-filled.
- Official Week 1 injury tables: not posted yet.
- Official game-day availability: unavailable.
- Sportsbook odds calls/credits: zero.

These are source-pipeline checks, not evidence that any betting model is
profitable.

## Checklist effect

- Item 2, injuries/availability: advanced to partial. Official weekly reports
  are connected; official inactives remain the blocker.
- Item 7, workload: snap share is now available as a displayed diagnostic.
  Routes, red-zone work, and teammate interactions remain missing.
- Item 8, opponent research: team/offense and opponent-allowed efficiency, EPA,
  sacks, and QB hits are now collected as dated diagnostics. No prediction
  coefficient is enabled.
- Items 5, 12, 13, and 14 remain unapproved until their own chronological model
  and forward-test gates pass.

## Operational order

1. Recheck the official weekly injury page on each daily preflight.
2. Verify and test the NFL.com inactives structure when it first becomes live.
3. Collect forward core-prop attempts and same-book price observations.
4. Add current-season snap/team rows only after their source files appear.
5. Design frozen feature sets and baselines before fitting opponent or snap
   coefficients.
6. Evaluate and calibrate by market; do not pool unrelated props.
7. Consider full-game and specialty models only after those gates pass.

## Terms note

NFL.com robots.txt does not disallow the public injury or inactives paths. Its
terms restrict automated collection for commercial purposes. This personal
research integration uses low-frequency cached reads and does not redistribute
NFL page content. Commercial or public product use needs a separate licensing
review. nflverse attribution and the CC-BY-4.0 license must be retained.
