# Football production focus

Updated August 30, 2026. Current site: https://sports-betting-engine-1.onrender.com/

## Scope

- NFL is primary: game lines and core prop model research, plus an on-demand bookmaker quote board.
- NCAAF: spreads and totals only. Moneylines and college props are excluded from new requests and normalized/scored game lines.
- NBA, MLB, NHL, NCAAB and NCAA baseball scans are paused. The owner confirmed the pre-deployment dashboard reset was intentional: keep the fresh active record and retain the verified 329-pick backup untouched. Do not restore or merge older picks without a new explicit request.
- Generic `props`, `sgp` and `altparlays` commands now default to NFL. Morning/midday/full scans use only the two football sports.

## NFL Market Board

The dashboard discovers NFL games in the next 14 days using the free events endpoint. Select one game and one of 16 categories, then explicitly load posted odds. Categories cover full-game lines, all four quarters, both halves, passing/rushing/receiving, touchdown scorers, combined yardage, kicking/defense, team totals and alternate/milestone lines.

Market keys come from the [provider market list](https://the-odds-api.com/sports-odds-data/betting-markets.html). Availability depends on the event, bookmaker and posting time. Futures, live markets, proprietary sportsbook specials, and sportsbook-priced SGP combinations are not provided by this board.

Each request shows a credit upper bound for one US region; only one category request runs at a time. Identical concurrent calls are coalesced and successful responses are cached for five minutes. No periodic odds polling. The board shows exact market, participant, side, line, book and source timestamp; different lines/periods are never combined. Old/unknown timestamps are flagged.

Quotes are **not** validated model picks and are not written to the official pick log. Explicit paper saves support passing yards, rushing yards, receiving yards, receptions and standard two-way game/quarter/half moneyline, spread and total markets. Other markets remain quote-only. SGP/alternate research uses estimates, not guaranteed sportsbook combination prices or calibrated hit probabilities.

## NFL history and paper testing

The generic NFL prop scorer was found to use basketball-shaped player statistics. It is now blocked at all generic scoring/prediction entry points. The `nflprops` command directs users to the board without spending odds credits. No validated NFL prop forecasting model is currently deployed.

The dedicated **Forecast + track** path now provides an experimental workload × efficiency forecast for the four core props. It uses strictly earlier same-team games, shows a rolling error comparison against a trailing average, and blocks issuance on failed data/role/injury/baseline gates. It evaluates both sides at configured accessible books (FanDuel and BetMGM), then durably auto-logs at most one eligible model pick per game/player/market/version before showing it. No extra odds request or real wager is made. Original inputs, quote and model estimates are locked; **View original forecast** reopens them from the paper record. See [NFL_FORECAST_V1.md](NFL_FORECAST_V1.md) for the fixed specification, mixed initial historical results and limitations. This is not a calibrated or validated betting model.

The board's **History** action resolves the player uniquely across the two current-season team rosters, then reads named NFL statistics from ESPN. It shows current and previous regular seasons separately, with means, medians, over/under/push counts, attempts/targets, team-change counts, roster injury flags and provisional depth-chart listed order. No initial-only guesses, preseason/playoff mixing, future observations, NBA-stat fallback or zero-filling. Missing rows may omit zero-opportunity games: these are descriptive observations, not unbiased projections or calibrated hit probabilities. Roster/depth status is not game-day starter confirmation. ESPN public feeds are best-effort; schema changes/outages must remain visible, not silently filled.

**Save paper** requires a fresh server-owned quote, unique ESPN event mapping and acknowledgment of research settlement rules. It records the exact event, player ID where applicable, market, side, line, price, book, source timestamp, season, version and rules in `/var/data/snapshots/nfl_paper_picks.json`, separate from `picks_log.json`. Duplicate event/market/player/side/line selections across books do not multiply the record. Atomic writes and re-reads protect concurrent saves. No wagers are placed.

**Grade completed paper picks** checks up to ten games per click after kickoff plus four hours. It requires matching NFL event/team/season/kickoff identity and final status. Missing stats/players/periods go to REVIEW, never presumed zero/loss/DNP. Source outages can be retried. Full-game and player results include overtime; quarter/half paper results use regulation only. Two-way ties push. Sportsbook DNP, early-injury, overtime and tie rules may differ: this is not sportsbook settlement. Settled results are not automatically changed on later stat corrections; those need review.

Reports split manual/model origin, exact market, season and research version, using fixed one-unit paper risk. Pending/review picks are excluded from returns; pushes are excluded from win rate but included in settled-stake ROI. Manual selections are biased and correlated, not an automatic model backtest. Optional later odds loads record same-book/same-line pregame price observations; these are **not verified closing lines or true CLV**. No automatic probability calibration is claimed. Grading is on demand; no unattended job is configured.

Football BET labels remain capped pending explicit model validation; 20 positive records do not unlock betting. Totals/props remain MONITOR-only. Historical sample diagnostics exclude undated, other-season, parlay and mismatched-market records.

## Safeguards and access

- Football observation guards remain in place; historical results from other sports do not prove an NFL edge.
- Archived all-sport totals are labeled as lifetime history; football category cards are shown by default with an archive toggle.
- Website credentials are `DASHBOARD_USER` and `DASHBOARD_PASS` in the active Render service. Change them directly there; never commit them.
- Active hosting: Render service `sports-betting-engine-1`, GitHub branch `main`, root `sports-betting-engine`, persistent disk `/var/data/snapshots`, health check `/api/health`.
- The older suspended Render web/database/cron stack is not required by this app. Do not unpause it for this release.

## Verification

Run `npm test`, `npm run build`, and `node --check public/nfl-markets.js`. Tests cover scope restrictions, NCAA market filtering, market identities, request validation, missing data, caching, concurrency and kickoff guards. Local browser QA uses a separate snapshot directory and a loopback-only server, not the production pick log.

See [CATCH_UP_CHECKLIST.md](CATCH_UP_CHECKLIST.md) for current status, remaining validation work and the weekly runbook.
