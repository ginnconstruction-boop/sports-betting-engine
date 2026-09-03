# College current-context release — September 3, 2026

Release marker: `college-context-3`.

## Outcome

The college scan now ingests dated current-season football evidence into a
normalized, append-only store before the existing safety assessment. It also
leads the website result with a plain-language SIMPLE READ:

- **RECOMMENDATION:** qualified paper play.
- **WATCH:** raw model direction is visible, but evidence is insufficient.
- **PASS:** neutral/no usable edge.
- **AVOID:** model/data warning; do not treat as a pick.

The frozen scoring model, calibration status and all safety gates are unchanged.
Context-adjusted points remain unavailable. Totals, Kelly, stake sizing and
real-money recommendations remain disabled.

## Files and storage

- `collegeContextEvidence.ts`: normalized types, content-addressed append-only
  records, source ranking, as-of resolution, conflict handling, freshness,
  completeness/reliability and unfitted blend diagnostics.
- `collegeContextIngestion.ts`: explicit-scan ESPN summary/roster ingestion plus
  optional daily-cached CollegeFootballData ingestion.
- `collegePredictions.ts` / `collegeSafety.ts`: context refresh and fail-closed
  assessment integration; evidence is archived and replayable with a pick.
- `collegeResearch.ts` / `nflPaper.ts`: verified venue metadata and immutable
  context replay.
- `weatherData.ts`: feels-like, humidity, precipitation probability, weather
  code, diagnostic flags and severe-weather fields; still context-only.
- `collegeContextEvidenceImport.ts`: validated operator import for official and
  other dated sources.
- `collegeCurrentContextAudit.ts`: no-sportsbook-call current-slate diagnostic.
- `college-markets.js`: concise SIMPLE READ plus optional technical diagnostics.
- `.env.example`: optional server-only `CFBD_API_KEY` configuration.

There is no relational database in this project. The migration adds
`SNAPSHOT_DIR/college_context/evidence-v1/index.json`, content-addressed field
records under `records/`, and source payloads under `raw/`. Existing ledgers and
immutable paper openings are not migrated or rewritten.

## Sources

ESPN (Tier 2, MEDIUM) supplies canonical current rosters and whatever the game
summary explicitly publishes for venue, weather, depth chart and injury
listings. Roster membership never means starter confirmation; a depth-chart QB
is EXPECTED, never CONFIRMED. When ESPN has no provider issue timestamp, the
retrieval time is stored as the observation/source date and disclosed.

CollegeFootballData (Tier 3, MEDIUM) is supported server-side for returning
production, transfers, roster talent, head-coach history, prior-year FCS SRS and
team records. It requires `CFBD_API_KEY`, which is not currently configured.
Static data is refreshed at most daily and only during an explicit scan. Six
provider calls cover the season/slate, not one call per team. Those calls are
separate from sportsbook credits and are subject to the CFBD account's own
usage limits. This audit made zero CFBD calls because no key was configured.
CFBD's aggregate returning-production percentage is stored as offensive
production; overall and defensive returning production stay missing unless a
separate dated source actually supplies them.

Official school/conference/NCAA imports are Tier 1; verified/corroborated rows
can be HIGH. Tier 4 and unverified rows are LOW. Conflicting equal-priority
sources are preserved and resolve to CONFLICT/LOW rather than a chosen value.

## Completeness and chronology

Coverage weights are current roster 3%, QB 20%, returning production 15%,
transfers 15%, coaching 10%, talent/depth 12%, injuries 10%, weather 10%, and
current sample 5%. Completeness measures field coverage only. Reliability is
reported separately and is never model confidence.

The resolver requires `publishedAt`, `retrievedAt`, and `effectiveFrom` to be at
or before the forecast timestamp and requires a still-valid `effectiveTo` when
present. Game-specific rows must match the canonical ESPN event. Later status
updates append; they do not overwrite earlier observations. Therefore:

**Historical context backtest unavailable.** Modern context was not applied to
old forecasts.

## September 3 diagnostic

A fresh ESPN-only audit at 1:49 PM Central checked all 11 games with **zero
sportsbook odds calls**. It archived 202 normalized field observations in an
isolated store. All 22 current rosters matched. ESPN supplied partial weather:
outdoor status, temperature, gust and precipitation probability. It did not
supply confirmed QBs, returning production, transfers, coaching/coordinators,
talent/depth, comprehensive injuries, sustained wind, feels-like, humidity or
precipitation amount. With no CFBD key, each team was 8% complete and MEDIUM
reliability from the available secondary-source observations.

| Game | Context result | Existing classification |
|---|---|---|
| UMass @ Rutgers | QB unknown; roster current; weather partial; other sections missing | PAPER PASS |
| West Georgia @ Kennesaw State | Same | PAPER MONITOR |
| Albany @ Buffalo | Same | PAPER MONITOR |
| Merrimack @ Delaware | Same; 15 mph gust flag | MODEL WARNING |
| Bethune-Cookman @ UCF | Same | MODEL WARNING |
| Akron @ Wake Forest | Same | PAPER MONITOR |
| Colorado @ Georgia Tech | Same | MODEL WARNING |
| Arkansas-Pine Bluff @ Missouri | Same | MODEL WARNING |
| Eastern Illinois @ Minnesota | Same | MODEL WARNING |
| UAB @ Illinois | Same | PAPER MONITOR |
| Idaho @ Utah | Same; 27 mph gust flag | PAPER MONITOR |

No classification was promoted. Merrimack–Delaware, Bethune-Cookman–UCF,
Colorado–Georgia Tech, Arkansas-Pine Bluff–Missouri and Eastern
Illinois–Minnesota remain MODEL WARNING. West Georgia–Kennesaw State,
Albany–Buffalo, Akron–Wake Forest, UAB–Illinois and Idaho–Utah remain PAPER
MONITOR. The available roster/weather observations do not validate any extreme
raw-model disagreement; none became more credible.

## Verification and next step

Typecheck/build, scoped lint, JavaScript syntax, normalized-store validation and
all 158 automated tests pass. Tests cover source hierarchy, CONFIRMED vs EXPECTED,
staleness, conflicts, status updates, effective dates, future-data leakage,
canonical IDs/provider aliases, returning production, transfers, talent,
coaching, FCS tiers, weather thresholds, Week 1 blend behavior,
incomplete-context downgrade, no numerical adjustments and immutable forecast
replay.

The recommended next development step is to configure a CFBD key for the
static season fields, then add vetted official/team depth-chart and availability
imports for confirmed QBs, coordinators and injuries. Only after a prospective
archive exists should context coefficients be developed and evaluated on a
separate chronological holdout.

## Production deployment

Commit `6706224b4e682b3fff0b99db27a143f10d662a98` deployed on September 3,
2026 at 2:01 PM Central. Public health returned HTTP 200 with release marker
`college-context-3`; the page and versioned JavaScript returned HTTP 200 and
contained the SIMPLE READ/WATCH language. Anonymous protected access still
returned HTTP 401.

Deployment verification did not invoke the college scan, buy odds, create a
new paper observation, grade a pick, or rewrite an existing opening. Existing
September 3 safety-v2 paper observations remain immutable and replay through
their own archived safety version. The context audit did not promote any
September 3 game, so the published classification list above is unchanged.
