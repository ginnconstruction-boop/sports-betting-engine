# 2026 college forward data collection — college-forward-research-v1

**RESEARCH_ONLY — COLLECT FACTS FIRST; MODEL LATER**
Generated: 2026-09-07T13:00:00.000Z

## A. Forward archive architecture

- Content-addressed immutable raw payload, pregame snapshot, verified-final, correction, and source-failure records.
- One append-only index references immutable records; loading rehashes every record and fails on corruption.
- Canonical ESPN event/team identity is preserved alongside every provider event ID.
- Every pregame record includes Model A, optional shadow-only candidates, football evidence, six-stage diagnostics, explicit failures, and a separate market namespace.
- Deterministic NDJSON export and manifest derive from the immutable authority; dataset hash excludes export timestamp.

## B. Data sources added

- **ESPN public college feeds** — canonical schedule identity, current-season samples, QB/depth evidence, rosters, injuries, weather, venue. Existing Phase 1 adapters and content-addressed raw records are reused; summary TTL 15 minutes and roster TTL 7 days.
- **CollegeFootballData** — CORE offense/defense/overall with play samples, completed opponent history, returning production, transfers, talent, coaching, prior FCS SRS. New forward collector adds /ratings/core and current-season /games snapshots. Four-call run ceiling, two attempts maximum, and 6h/24h cache TTLs.
- **Odds API / exact sportsbook quote** — home/away spread, price, sportsbook, quote timestamp. External benchmark namespace only. New network calls are allowed only in T-1H/latest windows; existing valid cached quotes can be reused.
- **Verified final source** — final score, final margin, FINAL/FINAL_OVERTIME status. Saved only after kickoff and never replaces a pregame record.

## C. Feature categories captured

- **TEAM_EFFICIENCY** — CFBD CORE overall/offense/defense, model version and qualifying-play sample where legitimately returned.
- **OPPONENT_HISTORY** — Earlier completed games, opponent IDs, date, score, venue orientation, neutral/conference flags.
- **QB** — starter identity, CONFIRMED/EXPECTED/COMPETITION/QUESTIONABLE/OUT/UNKNOWN, availability, source disagreement and timestamp.
- **ROSTER / TRANSFERS / TALENT** — provider-supported roster, returning production, portal counts/positions, composite and subdivision facts; no point values.
- **COACHING / INJURIES** — head coach and supported continuity facts; player/team injury facts with UNKNOWN retained.
- **FBS_FCS** — subdivision, conference, completed history and prior FCS SRS only after exact matching.
- **WEATHER / ENVIRONMENT** — temperature, wind/gust, precipitation, humidity, venue, indoor/neutral facts when returned.

## D. Snapshot timing policy

- **T24H**: 1080–1800 minutes before kickoff; new market request not allowed.
- **T6H**: 240–480 minutes before kickoff; new market request not allowed.
- **T1H**: 30–90 minutes before kickoff; new market request allowed.
- **LATEST_PREKICK**: 0–30 minutes before kickoff; new market request allowed.
Required target: LATEST_PREKICK. Latest trustworthy snapshot is derived by forecast timestamp; earlier windows never overwrite it.

## E. Immutability guarantees

- Snapshot IDs are SHA-256 hashes of canonical content. Exact duplicate writes are idempotent; conflicting same-event/window/timestamp writes fail.
- Final records are immutable. A changed final or context fact must be an append-only correction targeting the original ID.
- Source payloads are independently content-addressed. Original forecast/model/market values are never regenerated into an older snapshot.
- All feature publication, retrieval, effective, forecast, capture and kickoff timestamps are validated in order.

## F. Market / model separation

- Football evidence rejects fields, definitions, or providers containing sportsbook, spread, odds, total, moneyline, consensus, closing-line or market-implied terms.
- Market evidence is allowed only under EXTERNAL_MARKET_BENCHMARK and is not passed into Model A or a shadow candidate.
- Every research candidate must carry shadowOnly=true. No Phase 6 module is imported by the recommendation engine.

## G. FBS/FCS strategy

- FBS/FCS is a separate coverage regime; classification and prior FCS quality evidence are stored without an arbitrary point adjustment.
- Missing or ambiguous FCS evidence remains UNKNOWN/failed. Current production MODEL_UNAVAILABLE treatment is unchanged.
- Future research can choose a separate model/prior or continued abstention only after sufficient forward evidence.

## H. QB / roster / injury strategy

- Existing ESPN and CFBD normalized evidence is copied with raw hashes and original source timestamps.
- QB UNKNOWN is never converted to healthy; COMPETITION and source disagreement are preserved.
- No player-value, roster-value, coaching-value, injury-value, talent-value, weather-value or transfer-value point adjustment exists in Phase 6.

## I. API cost controls

- T-24H and T-6H do not authorize new market requests. T-1H and latest-prekick may make one bounded market attempt when no valid cached quote exists.
- CFBD collection uses shared whole-season snapshots: CORE, FBS games, FCS games and prior FCS SRS, capped at four requests per run.
- CFBD TTLs: six hours for CORE/current games and 24 hours for prior FCS SRS; concurrent identical requests coalesce.
- Provider retries are bounded at two for football data and one for market data. Failures are persisted rather than triggering unbounded retries.

## J. Data quality diagnostics

Each category/team persists SOURCE RETRIEVAL, NORMALIZATION, ENTITY MATCH, ATTACHMENT, FIELD VALIDITY, and FORECAST-TIME FRESHNESS as PASS/PARTIAL/FAIL/UNKNOWN. Missing evidence remains visible.

## K. Coverage dashboard

Current protected archive: 0/0 expected games captured; 0 pregame snapshots; 0 verified finals; 0 failures.
- qb: 0/0 (N/A)
- roster: 0/0 (N/A)
- efficiency: 0/0 (N/A)
- injury: 0/0 (N/A)
- talent: 0/0 (N/A)
- fcs: 0/0 (N/A)
- weather: 0/0 (N/A)
- market: 0/0 (N/A)
Milestones: 50 (50 remaining), 100 (100 remaining), 250 (250 remaining), 500 (500 remaining), 1000 (1000 remaining).

## L–M. Tests and full regression

Typecheck: PASS; lint: PASS; tests: 271 passed; 0 failed.

## N. Live production impact

Production changed: false. Model A, existing safety rules, paper-only operation, failed calibration status, disabled Kelly, and disabled production totals remain unchanged.

## O. Leakage-readiness decision

**CAPABLE OF CLEAN 2026 FORWARD COLLECTION WITHOUT FUTURE-INFORMATION LEAKAGE**
- Protected cutoff is enforced at 2026-09-07T12:45:00.000Z.
- Pregame, source and model timestamps fail closed at forecast/kickoff boundaries.
- Immutable corrections and verified finals preserve original evidence.
- Coverage includes missed games and raw N, so silence cannot masquerade as success.
- Exports are deterministic and versioned.

Operational status: Archive is correctly empty at lock. Invoke the standalone research capture/import job before eligible kickoffs; do not backfill earlier 2026 games.