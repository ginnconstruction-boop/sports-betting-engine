import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { saveSnapshot } from '../services/snapshotStore';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';
// -- Decision layer (Phase 2) --
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';

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

  // -- [DECISION LAYER] Phase 2: Qualification pass --
  // Full scan has no intelligence maps (bare odds only) -- the qualification
  // engine degrades gracefully: price and signal rules still apply;
  // the time-window rule uses hoursUntilGame which scoreAllBets always sets.
  // Appended after existing output; does not affect scores, ranking, or saves.
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const qualResult = qualifyCandidates(decisionCandidates);
    printQualificationSummary(qualResult);
  } catch { /* qualification pass is supplemental -- never block output */ }

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
