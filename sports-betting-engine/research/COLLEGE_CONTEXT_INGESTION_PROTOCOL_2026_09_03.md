# College current-context ingestion protocol — September 3, 2026

## Existing architecture

The application persists append-only JSON evidence on the configured
`SNAPSHOT_DIR`; it does not currently use a relational database. College games
already resolve to canonical ESPN team and event IDs before modeling.
`CollegePredictions` freezes the score projection, then `collegeSafety` applies
the fail-closed classification before `nflPaper` may save an immutable paper
opening. The new context layer belongs between canonical identity resolution and
that safety assessment. It must not change the frozen score model.

## Normalized evidence design

Context is stored as one field observation per record rather than hundreds of
nullable columns on a game. Every record carries a canonical team ID, season,
optional event/player ID, domain, field name, value, effective interval,
published/source date, retrieval time, source URL/name/tier/reliability,
verification state and raw-payload hash. Records are content-addressed and
append-only. Conflicting records remain stored; the resolver returns a conflict
instead of silently choosing a value.

The domains are QB, roster, returning production, transfers, coaching, talent,
FCS quality, injuries and weather. Raw provider payloads are archived separately
by SHA-256. Static records and dynamic records use different freshness limits.

## As-of rule

A forecast at time `T` can only read records whose `publishedAt`, `retrievedAt`
and `effectiveFrom` are all at or before `T`, and whose optional `effectiveTo`
has not passed. Game-specific records must match the canonical event ID. Later
observations never replace earlier records. This deliberately makes modern data
unavailable to an older backtest rather than leaking it backward.

## Source hierarchy

1. Official school/conference/NCAA releases: HIGH unless internally ambiguous.
2. ESPN and major/reputable reporting providers: MEDIUM by default.
3. Established specialty/analytics providers such as CFBD: MEDIUM by default.
4. Unverified aggregators/social posts: LOW and never sufficient alone for a
   confirmed starter.

Reliability is separate from completeness. Conflicts, staleness and missing
provider publication timestamps can reduce reliability.

## Integrations and refresh policy

- ESPN game summaries: game/weather/venue and explicitly supplied pregame
  availability/depth data, refreshed only during an explicit scan and cached for
  15 minutes. A depth-chart QB is EXPECTED, never CONFIRMED.
- ESPN current rosters: roster presence and candidate data, cached for 24 hours;
  roster membership is not starter confirmation.
- Open-Meteo: supported by the existing context-only weather parser when a
  verified venue coordinate/roof record exists. Weather has no score effect.
- CollegeFootballData: optional server-side bearer-key integration for returning
  production, transfer portal and roster talent. Static season data refreshes at
  most daily. The key is never sent to the browser or stored in evidence.
- Verified operator import: supplies official/coaching/injury/QB facts that no
  configured provider exposes, using the same validation and append-only store.

No background job is added. Context requests never call the sportsbook API and
do not spend sportsbook odds credits.

## Completeness and model use

The versioned coverage weights are current roster 3%, QB 20%, returning
production 15%, transfers 15%, coaching 10%, talent/depth 12%, injuries 10%,
weather 10%, and current-season sample 5%. Within a section, available required fields earn partial
coverage. These are UI/audit coverage weights, not betting-model coefficients.

The early-season blend exposes prior-season, current-season and roster-context
weights, but all three remain diagnostic/unfitted. Context-adjusted points remain
unavailable until dated historical evidence and independent validation approve a
coefficient artifact. Better coverage may explain a disagreement; it does not
automatically promote a game or make the model agree with the market.

## Backtest rule

No historical context backtest will be claimed without context records actually
known before every archived prediction. For the current evidence store:

**Historical context backtest unavailable.**
