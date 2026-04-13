// ============================================================
// src/dev/mockRun.ts
// ZERO API CALLS -- ZERO CREDITS
// Simulates a morning + midday run to show movement alerts
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import { MOCK_EVENTS } from './mockData';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { EventSummary, RawEvent } from '../types/odds';

// Simulate line movement -- shift some lines for the "midday" run
function shiftLines(events: RawEvent[]): RawEvent[] {
  return events.map(event => ({
    ...event,
    bookmakers: event.bookmakers.map(bm => ({
      ...bm,
      markets: bm.markets.map(market => ({
        ...market,
        outcomes: market.outcomes.map(outcome => {
          // Simulate NBA spread moving half a point
          if (event.sport_key === 'basketball_nba' && market.key === 'spreads') {
            return { ...outcome, point: outcome.point ? outcome.point - 0.5 : outcome.point };
          }
          // Simulate MLB moneyline price shifting
          if (event.sport_key === 'baseball_mlb' && market.key === 'h2h') {
            return { ...outcome, price: outcome.price + (outcome.price < 0 ? -8 : +8) };
          }
          return outcome;
        }),
      })),
    })),
  }));
}

async function main() {
  console.log('\n');
  console.log('+==============================================================+');
  console.log('|       SPORTS BETTING ENGINE -- MOCK PREVIEW                  |');
  console.log('|       Simulating: Morning scan + Midday with movement        |');
  console.log('|       No API calls -- No credits used                         |');
  console.log('+==============================================================+');

  // -- Build "morning" summaries (baseline) -----------------
  const sportKeys = [...new Set(MOCK_EVENTS.map(e => e.sport_key))];
  const morningSummaries: EventSummary[] = [];
  for (const sportKey of sportKeys) {
    const events = MOCK_EVENTS.filter(e => e.sport_key === sportKey);
    const rows = normalizeEvents(events, sportKey);
    morningSummaries.push(...aggregateAllEvents(rows));
  }

  // -- Build "midday" summaries (with shifted lines) --------
  const shiftedEvents = shiftLines(MOCK_EVENTS);
  const middaySummaries: EventSummary[] = [];
  for (const sportKey of sportKeys) {
    const events = shiftedEvents.filter(e => e.sport_key === sportKey);
    const rows = normalizeEvents(events, sportKey);
    middaySummaries.push(...aggregateAllEvents(rows));
  }

  // -- Print Top 10 with movement alerts -------------------
  console.log('\n  NOTE: Movement alerts show changes since the morning scan.');
  console.log('        On a real run these compare your actual saved snapshots.\n');

  const topBets = getTopBets(middaySummaries, 10, {
    windowHours: 24,
    priorSummaries: morningSummaries,
  });

  printTopTen(topBets, 24);

  console.log(`  Events processed : ${middaySummaries.length}`);
  console.log(`  API calls made   : 0  <- no credits used`);
  console.log(`  Snapshots saved  : 0  <- mock run only\n`);
}

main().catch(err => {
  console.error('Mock run failed:', err);
  process.exit(1);
});
