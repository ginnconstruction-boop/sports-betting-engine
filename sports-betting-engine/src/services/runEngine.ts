// ============================================================
// src/services/runEngine.ts
// Core execution engine -- on-demand only, no scheduling
// ============================================================

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from './normalizeOdds';
import { aggregateAllEvents, detectTradingFlags, compareSnapshots } from './aggregateMarkets';
import { saveSnapshot, loadLatestSnapshot } from './snapshotStore';
import { getTopBets, printTopTen } from './topTenBets';
import {
  RunType, RunSummary, EventSummary, TradingFlag, RunError, MarketKey,
} from '../types/odds';
import { getEnabledSports } from '../config/sports';
import { logger } from '../utils/logger';
import { INITIAL_MARKETS } from '../types/odds';

export async function executeRun(
  runType: RunType,
  options: {
    sportKeys?: string[];
    markets?: MarketKey[];
    forceRefresh?: boolean;
    onlyInSeason?: boolean;
    saveSnapshotEnabled?: boolean;
    windowHours?: number;  // how many hours ahead to include games
  } = {}
): Promise<RunSummary> {
  const startTime = Date.now();
  const runTimestamp = new Date().toISOString();
  const errors: RunError[] = [];

  const {
    markets = INITIAL_MARKETS,
    forceRefresh = false,
    onlyInSeason = false,
    saveSnapshotEnabled = true,
    windowHours = 24,
  } = options;

  const sportKeys =
    options.sportKeys ?? getEnabledSports(onlyInSeason).map((s) => s.key);

  logger.section(`${runType} -- ${runTimestamp}`);
  logger.info(`Sports : ${sportKeys.join(', ')}`);
  logger.info(`Markets: ${markets.join(', ')}`);
  logger.info(`Window : next ${windowHours} hours`);

  // Step 1: Fetch
  const { results: rawBySport, errors: fetchErrors } =
    await getOddsForAllSports(sportKeys, markets, forceRefresh);

  for (const [sportKey, errMsg] of fetchErrors) {
    errors.push({ sportKey, error: errMsg, timestamp: new Date().toISOString() });
  }

  // Step 2: Normalize
  const allNormalizedRows = [];
  for (const [sportKey, events] of rawBySport) {
    const rows = normalizeEvents(events, sportKey);
    allNormalizedRows.push(...rows);
  }

  // Step 3: Aggregate
  const eventSummaries: EventSummary[] = aggregateAllEvents(allNormalizedRows);

  // Step 4: Load prior snapshot for movement comparison
  const priorSnapshot = loadLatestSnapshot(runType);
  const priorSummaries = priorSnapshot?.eventSummaries ?? [];

  const topMovementFlags: Array<{ matchup: string; flags: TradingFlag[] }> = [];
  for (const event of eventSummaries) {
    const currentFlags = detectTradingFlags(event);
    const priorEvent = priorSummaries.find(e => e.eventId === event.eventId);
    const movementFlags = priorEvent ? compareSnapshots(priorEvent, event) : [];
    const allFlags = [...currentFlags, ...movementFlags];
    if (allFlags.some((f) => f.severity === 'high' || f.severity === 'medium')) {
      topMovementFlags.push({ matchup: event.matchup, flags: allFlags });
    }
  }

  // Step 5: Save snapshot
  const quota = getSessionQuota();
  if (saveSnapshotEnabled) {
    saveSnapshot(runType, eventSummaries, quota, Date.now() - startTime, errors);
  }

  // Step 6: Top 10 -- with time window + movement alerts from prior snapshot
  const topBets = getTopBets(eventSummaries, 10, {
    windowHours,
    priorSummaries: priorSummaries.length > 0 ? priorSummaries : undefined,
  });
  printTopTen(topBets, windowHours);

  // Step 7: Build summary
  const sportsProcessed = [...new Set(eventSummaries.map((e) => e.sportKey))];
  const marketsProcessed = eventSummaries.reduce(
    (sum, e) => sum + e.availableMarkets.length, 0
  );

  const runSummary: RunSummary = {
    runType,
    runTimestamp,
    sportsProcessed,
    eventsProcessed: eventSummaries.length,
    marketsProcessed,
    quotaUsage: quota,
    durationMs: Date.now() - startTime,
    topMovementFlags,
    eventSummaries,
    errors,
  };

  logger.info(
    `[DONE] ${runType} | ${eventSummaries.length} events | ` +
    `${marketsProcessed} markets | ${quota.requestsMade} API calls | ` +
    `${Date.now() - startTime}ms`
  );

  if (errors.length > 0) {
    logger.warn(`Errors on: ${errors.map(e => e.sportKey).join(', ')}`);
  }

  return runSummary;
}
