# Phase 7 — automated 2026 forward research collection

Generated: 2026-09-07T13:35:00.000Z

## A. Deployment / scheduler audit

The repository deploys one Render web service. Its blueprint sets SNAPSHOT_DIR=/var/data/snapshots but defines no persistent disk. Render's default filesystem is ephemeral; native cron and one-off jobs cannot access a web service disk. Render cron is UTC-only and would not provide shared file authority.

## B. Automation method chosen

GitHub Actions with repository-backed immutable archive commits. Scheduled and manual workflow runs execute the same collector. Archive-only commits use [skip render] so collection does not redeploy the website.

## C. Exact schedule

- 7:00 AM Central daily — SCHEDULED_0700_CT
- 2:00 PM Central daily — SCHEDULED_1400_CT
- No hourly, half-hourly, per-game, or hidden polling job.

## D. CST / CDT handling

Both schedules declare timezone: America/Chicago. Tests verify 07:00/14:00 become 12:00/19:00 UTC during CDT and 13:00/20:00 UTC during CST.

## E. Durable storage

The proposed authority is research/forward-archive on the Git default branch. Content-addressed records and append-only operation logs survive process exit, restart, Render replacement and deploy. Activation still requires the workflow to be present on the default branch with repository write permission and provider secrets.

## F. Actual snapshot semantics

Every operational snapshot uses ACTUAL_PREKICK and stores capture_timestamp, original/latest kickoff, exact minutes_to_kickoff, exact hours_to_kickoff and trigger. Conceptual T-24/T-6/T-1/latest windows are CAPTURED only when their actual tolerances were observed; otherwise they are NOT_SCHEDULED_FOR_CAPTURE.

## G. Manual collector

GitHub workflow_dispatch and the CLI call the same core. Manual runs require an idempotency key and preserve all Phase 6 cutoffs and isolation.

## H. Kickoff changes

Earlier snapshots retain the kickoff known at capture. New runs preserve the earliest original kickoff and use the latest explicitly scheduled kickoff for eligibility.

## I. Postponement / cancellation

POSTPONED stops capture until a new SCHEDULED kickoff is observed. CANCELED stops future capture. Earlier immutable snapshots remain.

## J. API budgeting

Operational horizon: 36 hours. CFBD: at most four shared requests per run. Market: at most one bulk request. Valid archived CFBD payloads seed the next run's cache. Discovery and Model A current-result pulls are slate-wide, not per selection.

## K. Failure / retry policy

Run records retain provider, type, retryability, next eligible attempt and final observation status. Budget-deferred games are explicit and retried by a later legitimate run. Capture retries deduplicate by capture-event ID.

## L. Observability and health

Status includes last morning/afternoon/manual runs, next expected run, health, capture counts, missed/deferred work, provider failures, request counts, cache hits and actual hours-to-kickoff distribution. Current health: NOT_CONFIGURED.

## M. First live / dry-run validation

Dry run found one eligible game inside the 36-hour universe and three already-final games; no archive mutation occurred. The first manual live run captured 401858212 at 2026-09-07T13:30:28.478Z, 9.992089444444444 hours before kickoff. Model A: PROJECTED; evidence: 23; diagnostics: 20; market namespace: EXTERNAL_MARKET_BENCHMARK. Repeating the same idempotency key made zero provider calls and returned the original run.

## N. Tests added

Focused tests cover both schedules, DST, exact T-minus, manual equivalence, trigger persistence, retry deduplication, immutable snapshots, kickoff changes, postponement, cancellation, budgets, backlog, all-game collection, missed-versus-unscheduled semantics, post-kickoff rejection, cutoff, durable re-open, dry run and health.

## O–P. Full regression, typecheck and lint

TYPECHECK_PASS_LINT_PASS_TESTS_294_OF_294_PASS.

## Q. Deployment status

**CODE_READY_NOT_ACTIVATED**. Code and workflow are implemented. Do not call the scheduler active until the workflow is pushed to the default branch and its first scheduled run is observed.

## R. Current forward archive counts

- Snapshots: 1
- Operational runs: 1
- Finals: 0
- Corrections: 0
- Archive failures: 4

## S. Selection-bias protection

The research universe includes every scheduled FBS/FBS and FBS/FCS game inside the 36-hour horizon. Eligibility does not inspect recommendation, edge, disagreement or paper-selection status. PASS and MODEL_UNAVAILABLE games remain research-eligible.

Production Model A, recommendation thresholds, calibration, Kelly, totals, qualification, Model B and market-prior behavior were not changed.
