# College current-context ingestion audit — September 4, 2026

> Superseded for the live ingestion failure by the
> [September 5 context-refresh repair](COLLEGE_CONTEXT_REFRESH_REPAIR_2026_09_05.md).

## Outcome

The pipeline was retrieving useful ESPN data and then discarding it. The repair
adds general parsers for current-season results/team production, active primary
passers and opening/current line movement. It also records a field-level reason
for every unresolved input. No projection formula, score, spread threshold,
classification rule, 80% gate or betting safeguard changed.

The safety snapshot version advances from v4 to v5 only because the diagnostic
payload gained new fields. Earlier v4 observations remain immutable and replay
against their archived evidence; this is not a safety-rule change.

## Root causes

1. `CollegeContextIngestion` requested ESPN game summaries, but the parser only
   inspected nonexistent `depthchart`/`injuries` arrays plus weather. It ignored
   `lastFiveGames`, `leaders`, `boxscore.teams[].statistics` and `pickcenter`.
2. ESPN's September 4 summaries did not contain a structured pregame depth chart
   or injury array. The previous UI could not distinguish that source limitation
   from an unattempted request.
3. Returning production, transfers, roster talent and coaching are implemented
   through CollegeFootballData, but `CFBD_API_KEY` is not configured on the
   audited runtime. Those domains therefore were never retrieved today.
4. The ESPN weather payload contained temperature, gust and precipitation
   probability but no `windSpeed`, feels-like, precipitation amount or humidity.
   Sustained wind was not a mapping bug and remains unknown.
5. Official school releases contain additional facts, but the application has
   no safe structured discovery/parser covering every school site. The existing
   verified import path can store those facts; it does not pretend that arbitrary
   article text is structured evidence.

## Pipeline after the repair

`source request → exact ESPN event/team ID check → parser → dated append-only
field records → freshness/conflict resolution → section coverage/reliability →
scan diagnostic`

Each missing resolved field now reports one of: `NO_SOURCE_ATTEMPTED`,
`SOURCE_RETURNED_EMPTY`, `PARSER_FAILED`, `TEAM_MATCH_FAILED`, `STALE_SOURCE`,
`CONFLICTING_SOURCES`, `VALIDATION_FAILED`, or
`DATA_PROVIDER_UNAVAILABLE`. These reasons appear in a nested debug panel, not
in the simple recommendation line.

## Sources checked

- ESPN scoreboard: exact event/team identity and current-season game count.
- ESPN current roster: current-season roster and QB candidates, not starter
  confirmation.
- ESPN game summary: prior current-season results, team averages, primary
  passer, weather and DraftKings opening/current line diagnostic.
- CollegeFootballData: code path for returning production, portal, talent,
  head coach and prior FCS quality; unavailable because no server key is set.
- Verified operator imports: supported for official QB/injury/coordinator facts
  that do not exist in a configured structured feed.

Public source cross-checks found additional facts in [Miami's official roster](https://miamihurricanes.com/sports/football/roster/season/2026-27/player/darian-mensah),
[Stanford's official roster](https://gostanford.com/sports/football/roster/season/2026/player/davis-warren),
[San José State's official roster](https://sjsuspartans.com/sports/football/roster/player/luke-weaver),
and [Eastern Michigan's official game notes](https://emueagles.com/news/2026/8/31/football-hosts-san-jose-state-friday-night-in-ypsi).
These confirm that more public context exists, but they are not assigned model
points or silently scraped into a confirmed-starter field.

## Before and after: diagnostic games

| Team | Before | After | QB after | Current-season evidence after |
|---|---:|---:|---|---|
| Miami | 8.0% | 8.0% | UNKNOWN — ESPN source returned no structured starter and Miami had not played | 0 games |
| Stanford | 9.7% | 29.7% | Davis Warren — EXPECTED, current-season primary passer | 1 game; beat Hawai'i 37–27; 468 yards, 37 points |
| San José State | 9.7% | 29.7% | Luke Weaver — EXPECTED, current-season primary passer | 1 game; lost at USC 42–26; 336 yards, 26 points |
| Eastern Michigan | 9.7% | 29.7% | Noah Kim — EXPECTED, current-season primary passer | 1 game; beat Sacramento State 28–17; 348 yards, 28 points |

The labels remain EXPECTED because an active season passing leader is strong
evidence of the likely starter but is not an official game-day confirmation.

### Miami at Stanford

- Raw model remains Miami by 14.5; market remains Miami -24.5; disagreement
  remains 10.0 points and MODEL WARNING remains appropriate.
- ESPN/DraftKings movement: Miami -21.5 open to -24.5 current, three points
  toward Miami. The raw model's cover direction is Stanford, so the scan now
  shows `MODEL/MARKET DIVERGENCE — review only`.
- Weather remains 71°F, gust 18 mph, no precipitation; sustained wind is
  `SOURCE_RETURNED_EMPTY`.

### San José State at Eastern Michigan

- Raw model remains Eastern Michigan by 8.4; market remains Eastern Michigan
  -2.5; disagreement remains 5.9 points and PAPER MONITOR remains unchanged.
- ESPN/DraftKings movement: Eastern Michigan -3.5 open to -2.5 current, one
  point toward San José State. That opposes the model direction, so the scan
  shows `MODEL/MARKET DIVERGENCE — review only`.
- Weather remains 77°F, gust 10 mph, 34% precipitation probability; sustained
  wind is `SOURCE_RETURNED_EMPTY`.

## Completeness evidence and the 80% gate

Across 16 teams on the eight-game slate, reconstructed pre-repair completeness
averaged about 8.7%. The repaired parser averaged 17.4%, with a median of 8.0%
and 0/16 teams at 80%.

The largest universal blockers were the unconfigured returning-production,
transfer, coaching and talent feed; ESPN also returned no structured injuries
for any game and only partial weather. Even with a CollegeFootballData key,
that provider does not supply all coordinator, injury, depth-tier or aggregate
returning-production fields defined by the 80% policy. Routine achievable
coverage is therefore more likely around 60–70% when the optional feed works,
unless official structured inputs are added. The threshold remains unchanged
pending a larger prospective audit.

## Fields now populated

- Current-season games played, last opponent/result/score
- Current points and yards produced/allowed when ESPN supplies them
- Current primary QB and attempts; expected-starter label when active
- Opening and current home spread, provider, direction and magnitude
- Model-direction versus market-movement divergence
- Field-level missing/stale/conflict/parser/provider diagnostics
- Raw QB-transfer candidates and previous school when CFBD is configured; they
  are joined to the expected QB only on an exact name match

## Still unavailable and why

- Miami expected starter: public narrative evidence exists, but no configured
  structured source identifies the starter. Roster order is not assumed.
- Returning production/transfers/talent/head coach: CFBD key missing.
- Coordinators/play caller: not provided by the current ESPN/CFBD adapters.
- Injuries: no structured injury array in today's ESPN summaries.
- Sustained wind/feels-like/humidity/precipitation amount: absent from today's
  ESPN weather objects.
- Context point adjustment: coefficients have not been historically validated.

## Tests and remaining work

All 163 automated tests passed. Automated coverage includes expected versus confirmed QB, current-season
parsing, QB transfer identity, exact team matching, timestamps/freshness,
parser/source/team-match diagnostics, conflicts, partial weather, coverage and
reliability, market movement/divergence and future-data exclusion. The full
chronological score audit must remain unchanged.

Recommended next step: configure a server-side CollegeFootballData key, rerun
the same no-odds-call audit, and then add source-specific official adapters for
coordinator/injury reports. Do not lower the 80% gate until that evidence shows
the sustainable completeness distribution.
