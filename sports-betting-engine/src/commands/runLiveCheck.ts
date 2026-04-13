import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';

export async function runLiveCheck(options: { sportKeys?: string[]; forceRefresh?: boolean } = {}) {
  const sportKeys = options.sportKeys ?? getEnabledSports().map(s => s.key);

  const { results: rawBySport } = await getOddsForAllSports(
    sportKeys, INITIAL_MARKETS, true
  );

  const allSummaries: EventSummary[] = [];
  for (const [key, events] of rawBySport) {
    const rows = normalizeEvents(events, key);
    allSummaries.push(...aggregateAllEvents(rows));
  }

  const quota = getSessionQuota();
  const topBets = getTopBets(allSummaries, 10, { windowHours: 12 });
  printTopTen(topBets, 12);

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
