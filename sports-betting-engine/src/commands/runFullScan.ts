import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { saveSnapshot } from '../services/snapshotStore';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';

export async function runFullScan(options: { forceRefresh?: boolean } = {}) {
  const sportKeys = getEnabledSports().map(s => s.key);

  const { results: rawBySport } = await getOddsForAllSports(
    sportKeys, INITIAL_MARKETS, options.forceRefresh ?? false
  );

  const allSummaries: EventSummary[] = [];
  for (const [sportKey, events] of rawBySport) {
    const rows = normalizeEvents(events, sportKey);
    allSummaries.push(...aggregateAllEvents(rows));
  }

  const quota = getSessionQuota();
  saveSnapshot('FULL_SCAN', allSummaries, quota, 0, []);

  const topBets = getTopBets(allSummaries, 20, { windowHours: 24 }); // 20 candidates, sport diversity auto-applies
  printTopTen(topBets, 24);

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
