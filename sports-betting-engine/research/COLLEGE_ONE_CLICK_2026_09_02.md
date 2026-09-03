# College one-click workflow — September 2, 2026

Release marker: `college-one-click-1`.

The main **College football — scan + track + grade** button sends one explicit
POST to `/api/college/today`. The server selects today's Central calendar date,
scans the full provider-listed slate with independent coverage disclosures,
saves qualifying experimental paper spreads, then grades all previously tracked
eligible college games in ten-game batches and refreshes the separate W/L record.
The optional date, preview checkbox and single-game picker do not affect this run.

The finite server job returns an ID immediately. Read-only authenticated status
polls display progress; they do not buy odds or restart work. Overlapping clicks
share the active job. A lost browser connection does not abandon work, although
a server restart loses in-memory progress; saved picks/results remain durable.
Job metadata is limited to the latest ten runs. This is not an unattended timer,
recurring task, overnight grader or new subscription.

Each eligible game is checked at most once in a run. An unavailable or unfinished
result stays REVIEW/PENDING, never an assumed loss and never an endless retry.
Only saved college picks are graded; future games, settled picks and NFL picks
are excluded. Existing archived-source, identity, exact-line, OT, push and
four-hours-after-kickoff checks remain in force. Repeat clicks preserve original
model picks and prices. The separate stat-correction action remains manual.

Scan failure does not prevent an attempt to grade existing picks. Grading failure
does not erase saved scan selections; partial progress and warnings are visible.
One click scans first so a large old grading backlog cannot expire fresh odds.
Current odds still cost at most two credits per uncached bulk pull; the five-minute
cache is shared with optional scans. No historical odds were purchased for this
workflow change. Model formula/thresholds and all readiness gates are unchanged:
experimental spreads only, totals research-only, calibration failed, no real bets.

## Verification

- 134 automated tests pass, including 25-game backlog/three batches, repeated
  unresolved games terminating, double-click coalescing, server Central midnight,
  progress snapshots, date-override rejection, scope/settled exclusions,
  scan/source/storage failure behavior, selected-ID ledger grading and replay.
- TypeScript build and browser-JavaScript syntax pass; dependency audit clear.
- Local authenticated endpoint smoke: 200/202 success, anonymous 401, forged
  one-click date 400, missing job 404. Today (September 2) had no games; one-click
  scan/grading completed with zero odds credits and no created picks.
- Browser skill verifies the actual main button runs the job without selecting
  a date or checkbox, hides optional date controls and restores buttons on finish.
- Production commit `4d9c65f55fce180e159e6ce43a2c848f824b4a4b` deployed via
  Render `dep-dacbm83bc2fs739gm5lg` (September 2, 7:11 PM Central).
  Public health returns `college-one-click-1`; current HTML/JS expose the new
  main button and handler. Anonymous job status returns 401.
- Authenticated production endpoint smoke passed, including date-override
  rejection and missing-job checks. The real today-only workflow completed on
  September 2: zero games, recommendations, pending/review records, source
  failures or warnings; zero odds credits; zero picks before and after.
  Nonempty slates/backlogs are covered by automated tests and prior model QA,
  not presented as a nonempty production run tonight.
- Before/after production fingerprints match: official picks remain empty,
  ATS database retains 58 keys, and the intentional-reset backup retains 329
  records. NFL and college paper ledgers remain absent until their first saved
  selections. No records were reset, restored, merged or deleted. Local QA
  server was stopped after verification.
