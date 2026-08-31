# Football production focus

Updated August 30, 2026. Current site: https://sports-betting-engine-1.onrender.com/

## Scope

- NFL is primary: game lines and core prop model research, plus an on-demand bookmaker quote board.
- NCAAF: spreads and totals only. Moneylines and college props are excluded from new requests and normalized/scored game lines.
- NBA, MLB, NHL, NCAAB and NCAA baseball scans are paused. Their historical records, grading and reports are preserved.
- Generic `props`, `sgp` and `altparlays` commands now default to NFL. Morning/midday/full scans use only the two football sports.

## NFL Market Board

The dashboard discovers NFL games in the next 14 days using the free events endpoint. Select one game and one of 16 categories, then explicitly load posted odds. Categories cover full-game lines, all four quarters, both halves, passing/rushing/receiving, touchdown scorers, combined yardage, kicking/defense, team totals and alternate/milestone lines.

Market keys come from the [provider market list](https://the-odds-api.com/sports-odds-data/betting-markets.html). Availability depends on the event, bookmaker and posting time. Futures, live markets, proprietary sportsbook specials, and sportsbook-priced SGP combinations are not provided by this board.

Each request shows a credit upper bound for one US region; only one category request runs at a time. Identical concurrent calls are coalesced and successful responses are cached for five minutes. No periodic odds polling. The board shows exact market, participant, side, line, book and source timestamp; different lines/periods are never combined. Old/unknown timestamps are flagged.

Quotes are **not** validated model picks and are not written to the official pick log. Quarter/half/specialty quotes are not auto-graded. Existing game-day research commands still have their own time windows. SGP/alternate research uses estimates, not guaranteed sportsbook combination prices or calibrated hit probabilities.

## Safeguards and access

- Football observation guards remain in place; historical results from other sports do not prove an NFL edge.
- Archived all-sport totals are labeled as lifetime history; football category cards are shown by default with an archive toggle.
- Website credentials are `DASHBOARD_USER` and `DASHBOARD_PASS` in the active Render service. Change them directly there; never commit them.
- Active hosting: Render service `sports-betting-engine-1`, GitHub branch `main`, root `sports-betting-engine`, persistent disk `/var/data/snapshots`, health check `/api/health`.
- The older suspended Render web/database/cron stack is not required by this app. Do not unpause it for this release.

## Verification

Run `npm test`, `npm run build`, and `node --check public/nfl-markets.js`. Tests cover scope restrictions, NCAA market filtering, market identities, request validation, missing data, caching, concurrency and kickoff guards. Local browser QA uses a separate snapshot directory and a loopback-only server, not the production pick log.
