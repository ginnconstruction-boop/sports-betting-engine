# NFL Phase 2 — Forward Integrity, Durable Collection, and Game-Day Availability

Generated after the first protected live capture on 2026-09-08 UTC. This is an operational/data-integrity report, not a model-performance report or betting recommendation.

## A. Protected NFL forward cutoff

`2026-09-08T02:19:07.588Z`, persisted in `src/config/nflForwardPolicy.ts`. Only records captured at or after that instant and strictly before the applicable kickoff can be `LIVE_FORWARD`. Earlier reconstruction is rejected by the protected archive.

## B. Canonical game identity status

PASS. Records preserve season, season type, week, exact home/away ESPN team IDs, kickoff, venue, neutral-site and international flags, status, canonical game ID, and provider IDs. Explicit schedule states support scheduled, in-progress, final, postponed, canceled, abandoned, and unknown. Changed kickoffs create later evidence; old evidence is never rewritten.

## C. Canonical player identity status

PASS for supported posted props in the live capture. Exact current-roster ESPN IDs are canonical. Suffix normalization is permitted only after game-roster scoping. Duplicate names, absent players, and ambiguous matches fail with `PLAYER_IDENTITY_UNRESOLVED`. Season/effective time, team, position, rookie, new-team, team-change, and position-change states are preserved, with `UNKNOWN` when no source proves a value.

## D. Six-stage diagnostic status

PASS. Programmatic, timestamp-bound diagnostics are persisted for every required team category and every resolved prop player category: source retrieval, normalization, entity matching, context attachment, field validity, and forecast-time freshness. States are PASS/PARTIAL/FAIL/UNKNOWN with deterministic counts, not a weighted completeness score.

## E. Game-day inactive source and verification status

Implemented fail-closed against the official NFL.com inactives page. The live page returned its season-pending message, so 28/28 eligible prop-player statuses are `STATUS_PENDING`; 0 were inferred active. `ACTIVE_VERIFIED` is possible only after a unique game is matched to an explicitly complete official list. Weekly practice injury designations remain separate.

Official source: https://www.nfl.com/inactives/

## F. Durable storage design

The authority is `research/nfl-forward-archive/nfl_forward_research/v1`. Snapshots and component objects are content-addressed JSON. Game identities, player identities, model outputs, context, inactive evidence, diagnostics, game markets, prop markets, failures, schedule changes, corrections, finals, player final stats, and settlement evidence have separate append-only paths. A mutable index is only a locator; hashes remain authoritative.

Both scheduled and authenticated manual GitHub workflow runs invoke the same collector and archive root. Archive-only commits use `[skip render]`; Render build filters ignore archive/report paths.

## G. Durability verification

PASS locally and remotely: the archive was closed, reopened through a new archive instance, and every snapshot/component hash verified. The authoritative first capture contains 1,407 files / 1,855,044 bytes and is persisted on remote `main` in commit `246172b`. Future component categories are bundled into one content-addressed object per category to avoid per-quote repository file growth. Scheduled write-back remains awaiting its first observed run.

## H. 7 AM / 2 PM Central scheduler status

Implemented in `.github/workflows/nfl-forward-collector.yml` with `America/Chicago` scheduling at 07:00 and 14:00. DST tests cover CDT, CST, and the transition. No scheduled run has occurred since implementation. Status: `AWAITING FIRST SCHEDULED EXECUTION`.

## I. Manual collection status

PASS. Authenticated `workflow_dispatch` and the operator CLI use the same collector. Manual runs require a bounded idempotency key and are labeled `MANUAL`. Dry-run mode performs discovery/planning without writes.

## J. First live forward snapshot

PASS. At `2026-09-08T02:41:41.126Z`, two future games were captured:

1. New England Patriots at Seattle Seahawks — kickoff `2026-09-10T00:20:00Z`, 45.64 hours to kickoff, snapshot `20696d6cfd4e0b9155cb7b776e9f693c0644159f2f599bbdaf7c0bc3c57c1193`.
2. San Francisco 49ers at Los Angeles Rams — kickoff `2026-09-11T00:35:00Z`, 69.89 hours to kickoff, snapshot `2c3bad0fa84721f746ab1939f6255a49b255cd407893e95af6e89376d9ea77c7`.

The exact retry key returned `RETRY_DUPLICATE` before discovery and spent no additional provider credits.

## K. Game market archive status

PASS. 132 exact game-market quote rows were captured across moneyline, spread, and total, with sportsbook, line, price, provider event ID, quote timestamp, capture timestamp, and raw payload hash.

## L. Player prop archive status

PASS. 688 exact quote rows were captured across the seven Phase 2 core markets. They resolved to 28 canonical players. Six existing-formula point projections were captured without changing formulas. The remaining existing-formula attempts were deterministically deferred by the public-source request cap; attempts/completions/rush-attempt projections remain `MODEL_UNAVAILABLE` because the current model does not support them.

## M. PROP_NOT_POSTED handling

PASS. A valid event response with an absent core market becomes `PROP_NOT_POSTED`. Provider/auth/identity failure becomes `MARKET_UNAVAILABLE`, not `PROP_NOT_POSTED`. Morning and afternoon observations remain separate.

## N. Player opportunity evidence status

PARTIAL/UNKNOWN. Existing historical workload inputs can produce a bounded subset of existing-model projections, but trustworthy 2026 snap share, routes, target share, carry share, goal-line usage, and red-zone usage were not available in this live capture. No values were invented and formulas were not changed.

## O. Starting-QB evidence status

PARTIAL. Current depth-chart first listing is archived as `PROBABLE`, never `VERIFIED`. QB availability remains a separate diagnostic. No prior-week starter is silently carried forward.

## P. Market contamination audit

PASS. Independent football/player evidence rejects fields or providers containing spread, total, moneyline, sportsbook, consensus, implied probability, prop line, or line movement. Market evidence is accepted only in its separate market namespace.

## Q. Future-leakage audit

PASS. Retrieval and effective timestamps must not exceed forecast time; quote timestamps must not exceed forecast time; capture must be strictly before the latest known kickoff. Violations fail closed as leakage/invalid evidence and cannot enter evaluation.

## R. API budget / request counts

Live run: ESPN 10 requests, NFL.com 1 request, Odds API 2 requests. Odds estimate: 20 credits; provider-reported actual: 20. Retries: 0. Failures: 0. Odds cap: 20 requests and 200 credits per run. Closest kickoff is prioritized; betting attractiveness is not an input.

## S. Game-day inactive coverage

Eligible prop players 28; active verified 0; inactive verified 0; pending 28; unknown 0; verified participation 0%. This is expected before official game-day lists are published and blocks full research eligibility.

## T. Current forward archive counts

2 snapshots, 2 games, 28 resolved prop players, 132 game quotes, 688 prop quotes, 536 diagnostics, 14 team evidence rows, 6 available existing-formula prop projections, 0 finals, 0 player-final-stat records, 0 settlement records.

## U. Observability / health

CLI status reports last 7 AM run, last 2 PM run, last manual run, next expected run, run status, eligible/captured games, prop counts, not-posted counts, player identity failures, inactive coverage, provider failures, deferred work, API counts, cache hits, and total snapshots. Current health is `STALE` only because no scheduled run has yet occurred; the manual run status is SUCCESS.

## V. Tests added

41 focused tests cover canonical identities, duplicate names, team/position changes, rookies, exact prop matching, six-stage diagnostics, incomplete/complete official inactive evidence, unknown/pending status, not-posted vs provider unavailable, immutable/durable archive, 7 AM/2 PM Central, DST, manual idempotency, dry run, actual timing, protected cutoff, post-kickoff rejection, leakage, contamination, retry/new snapshot distinction, schedule changes, game/prop preservation, API caps, health, deterministic export, and bounded late-quote labeling.

## W. Full regression results

360 passed, 0 failed in the final full regression. Focused final suite: 41 passed, 0 failed.

## X. Typecheck / lint

TypeScript: PASS. ESLint: PASS with zero errors and zero warnings after the lint configuration was extended to the new Phase 2 files.

## Y. Production impact

No NFL spread, total, or player-prop coefficients changed. No qualification threshold, ranking logic, probability calibration, Kelly/staking, parlay/SGP, or production recommendation behavior changed. Totals remain disabled; spreads and props remain research/paper only.

## Z. Final decision

NFL FORWARD COLLECTION IMPLEMENTED — AWAITING SCHEDULED VERIFICATION

The integrity implementation and first manual live capture work. Phase 2 must not be called operationally healthy until a real 7 AM or 2 PM scheduled workflow completes and its Git-backed archive commit is verified.
