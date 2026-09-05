# NFL 2026 readiness release — September 5, 2026

## Outcome

The NFL workflow now has a free one-click daily preflight that checks every
remaining NFL game on the current Central calendar day, refreshes source-backed
context, and grades eligible existing paper records. It does not request
sportsbook odds, create a recommendation, enable Kelly staking, or place a bet.

The safe result of this review is not that every requested model is ready.
Items that lack reliable data or chronological validation remain visibly
blocked, diagnostic-only, or quote-only.

## Live source audit

Run September 5 at 6:25 PM Central against the earliest upcoming NFL slate:

- Date checked: September 9 Central (the September 10 UTC kickoff).
- Game: New England Patriots at Seattle Seahawks.
- Sportsbook odds calls and credits: 0.
- Exact event identity: passed.
- Current rosters: 2 of 2 loaded (79 and 80 players).
- Expected depth-chart quarterbacks: Drake Maye and Sam Darnold.
- Dated ESPN injury/news context: loaded for both teams.
- Weather: partial; temperature and gust were available, roof and sustained
  wind were not. Missing fields remained missing.
- Official game-day availability: 0 of 2; no reliable automated inactive source
  is configured, so neither quarterback is described as confirmed active.
- Context and source-registry storage: passed.

## Checklist 1–15

| # | Area | Current state | Meaning |
|---|---|---|---|
| 1 | Context source registry | Ready | Each source records configuration, attempt, success, exact failure, and refresh interval. |
| 2 | Injuries and availability | Partial | The free official weekly NFL report and dated injury/news context are diagnostic. Official game-specific inactive status is still missing. |
| 3 | Roster, depth, QB role | Context ready | Current rosters and expected depth-chart QBs load; expected never means confirmed active. |
| 4 | One-click NFL preflight | Ready | Full current-day slate, context refresh, and bounded grading; zero odds calls. |
| 5 | Full-game NFL model | Research required | Quotes/manual paper tracking exist, but no independently validated NFL spread, total, or moneyline model is approved. |
| 6 | Four core player props | Paper diagnostic | Passing yards, rushing yards, receiving yards, and receptions have experimental workload forecasts; issuance stays availability-gated. |
| 7 | Workload | Partial | Attempts, targets, verified team shares, and free dated snap diagnostics exist; routes, red-zone roles, and teammate interactions remain missing. |
| 8 | Opponent matchup | Diagnostic only | Free dated team/opponent EPA, efficiency, sack, and QB-hit summaries load. No opponent-adjustment coefficient is active. |
| 9 | Weather and venue | Context only | Provider fields are preserved when present; no unvalidated points are added or removed. |
| 10 | Market comparison | Ready | Exact-line, two-sided reference requires three other books and rejects stale/mismatched prices. |
| 11 | Paper record and CLV | Partial | Immutable records, grading, replay, export, corrections, and final-five-minute observations exist. Unattended verified closing capture is missing. |
| 12 | Probability calibration | Not approved | Current NFL paper metrics do not establish calibrated probabilities; Kelly remains disabled. |
| 13 | More player props | Prices only | TDs, attempts, completions, combined, and longest props require separate targets and validation. |
| 14 | Quarters and halves | Prices only | Quotes and manual grading exist; period-specific forecast models do not. |
| 15 | Forward promotion gate | Active | Promotion requires distinct-game forward samples, baseline improvement, calibration, and CLV—not software tests alone. |

## Architecture changes

- `nflContextSources.ts`: persistent, atomic source registry with redacted errors.
- `nflContextIngestion.ts`: exact event/team matching, separate team-directory,
  roster, depth, injury/news, summary, and weather adapters; bounded concurrency,
  caching, retries, isolated failures, and immutable evidence.
- `nflDailyRun.ts`: coalesced one-click job, Central-day filtering, context
  preflight, and grading in bounded batches.
- `nflReadiness.ts`: one server-held checklist used by the website and API.
- Website: prominent **NFL daily preflight + grade** button, plain-language
  summary, expandable source details, game context, and the 15-item checklist.

## Verification

- Full automated suite: 177 passed, 0 failed.
- Targeted new/UI suite: 13 passed, 0 failed.
- TypeScript build/typecheck: passed.
- ESLint: passed.
- Live public-source audit: passed with the limitations listed above.

## Recommended order from here

1. Connect and archive a reliable, timestamped game-specific injury/inactive
   source. Keep automatic prop issuance blocked until this is solved.
2. Collect forward paper observations for the four core prop markets and capture
   same-book closing observations without rewriting original picks.
3. Add snaps, routes, red-zone work, teammate availability, and explicit
   opponent features as dated inputs—not manual point bonuses.
4. Define frozen chronological baselines and evaluate each market separately.
5. Fit and test probability calibration only out of sample; keep Kelly disabled.
6. Promote one core market only if its forward record, calibration, and CLV pass
   predeclared gates with enough distinct games.
7. Build and validate full-game spreads/moneylines next, then totals separately.
8. Add TD/combined/longest props and quarter/half models last, each with its own
   target, baseline, grading rule, calibration, and promotion gate.

Until those gates pass, “no reliable recommendation” is the correct output.
