# College football Phase 2 settlement and storage audit — 2026-09-06

## Scope guard

This phase changes paper selection persistence, result semantics, deterministic settlement, grading evidence, correction audit, accounting displays, and shared football event identity. It does not change score-model weights, probabilities, calibration, edge thresholds, totals eligibility, recommendation thresholds, or decision classifications.

## Confirmed pre-change defects

1. `REVIEW` ambiguously represented identity mismatches, missing settlement fields, unknown final statuses, and result-source failures.
2. Explicitly canceled college games remained `PENDING`; no `VOID` result existed.
3. Manual selection deduplication used the odds-provider event ID. Two provider rows resolving to one ESPN event could create duplicate manual selections.
4. Shared-ledger opening hashes were not applied to every new paper selection and no single versioned selection snapshot contained all required provenance.
5. The existing correction audit retained source revisions, but did not explicitly link previous/new outcomes and evidence hashes with a correction reason and timestamp.

## Preserved correct behavior

- Settlement uses the original saved quote, not current or proxy-close odds.
- ESPN result payloads are archived before a grade is saved.
- Ordinary grading skips terminal results and is idempotent.
- Rechecks preserve terminal results when a source is unavailable.
- College full-game settlement uses final scores including overtime.
- CLV remains separate from settlement and is labeled a last-five-minute proxy, not a verified close.
- Atomic ledger writes remain in place.

## Result semantics

- `PENDING`: an exact known non-final status (`STATUS_SCHEDULED`, `STATUS_IN_PROGRESS`, `STATUS_HALFTIME`, `STATUS_DELAYED`, or `STATUS_POSTPONED`).
- `VOID`: an exact invalidating status (`STATUS_CANCELED`, `STATUS_CANCELLED`, or `STATUS_ABANDONED`).
- `UNABLE_TO_GRADE`: the game should be gradeable but canonical identity, approved final status, final score, original line/price, or result source cannot be established.
- `WIN`, `LOSS`, `PUSH`: deterministic settlement against the original saved selection only after `STATUS_FINAL` or `STATUS_FINAL_OVERTIME`, `completed=true`, and `state=post` all agree.
- `REVIEW`: retained only for archived compatibility. New grading does not emit it.

## New records and immutability

Every new shared-ledger selection receives `football-paper-selection-v2` with pick ID, odds-provider and canonical event IDs, canonical team IDs when the production source provides them, sport/league, market, selected side, exact line/price/book, timestamps, kickoff, model/data/decision/calibration/application/settlement versions, and original projection/disagreement/safety context where applicable.

The `paper-opening-v2` SHA-256 covers the selection snapshot plus the original event, quote, canonical identity, player identity, forecasts, probability fields, reasons, rules, and settlement scope. Later observations, CLV proxies, grades, and corrections are deliberately outside the opening hash. Legacy hashes retain their original verification algorithm.

## Grading evidence and corrections

Each successful source retrieval is content-addressed before result mutation. Audit rows retain provider URL, provider/canonical event ID, canonical home/away IDs, final scores, explicit status, completion timestamp when supplied, retrieval timestamp, grading timestamp, raw-payload hash, and archive hash.

Controlled recheck appends a correction record when result or actual value changes. The record links previous/new results and evidence hashes and includes correction time and reason. An incomplete recheck never erases a settled result.

## Accounting convention

The ledger uses **risk 1 unit**. A -110 win returns +0.9091 units, a +120 win returns +1.2 units, and a loss is -1 unit. WIN/LOSS/PUSH are the settled-stake ROI denominator. PUSH contributes zero units. VOID, PENDING, UNABLE_TO_GRADE, and legacy REVIEW contribute neither stake nor units and never count as a win or loss.

## One-click ordering

The repository intentionally retains its safe existing order: today's time-sensitive scan is captured first, then all prior eligible unresolved selections are graded in bounded ten-event batches. This prevents a large old backlog from allowing fresh odds to expire. A failed scan does not suppress grading, and a grading failure does not erase scan or ledger progress. The workflow remains explicit-click only, not a background scheduler.

## Remaining limitations

- ESPN does not consistently expose an event completion timestamp; it is stored as `null` when absent rather than inferred.
- `STATUS_CANCELLED` and `STATUS_ABANDONED` are defensive exact aliases; observed ESPN college payloads most commonly use `STATUS_CANCELED`. Unknown statuses fail closed as `UNABLE_TO_GRADE`.
- Legacy records without Phase 2 snapshots remain readable and are labeled `LEGACY` with missing fields; absent provenance is never invented.
- The last-five-minute line remains a proxy and is not a verified closing line.
- Sportsbook-specific abandonment, participation, and promotion rules are not inferred. The paper rules are the application's documented rules only.
