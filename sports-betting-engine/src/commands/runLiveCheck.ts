import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota, countUncachedSports } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';
import { enrichWithProbability, printProbabilitySummary } from '../services/probabilityEngine';
import { applyRisk, printRiskSummary } from '../services/riskEngine';
import { applySportIntelligence, printIntelSummary } from '../services/sportIntelligenceEngine';
import { labelCandidates, printLabelSummary } from '../services/labelEngine';
import { selectSlate, printSlateSummary, printFinalCard } from '../services/slateSelector';
import { validateDataIntegrity, printValidationSummary } from '../services/dataIntegrityValidator';
import { applySignalDiversity, printSignalDiversitySummary } from '../services/signalDiversityEngine';
import { applyOutcomeSignals, printOutcomeSummary, OutcomeContext } from '../services/outcomeSignalEngine';
import { applyKeyNumbers, printKeyNumberSummary } from '../services/keyNumberEngine';
import { CreditBudgetGuard } from '../services/creditBudgetGuard';
import { EventFetchCache } from '../services/eventFetchCache';

export async function runLiveCheck(options: { sportKeys?: string[]; forceRefresh?: boolean } = {}) {
  const requestedKeys = options.sportKeys ?? getEnabledSports().map(s => s.key);

  // ── Free event pre-flight (0 credits) ───────────────────────
  // Live check window: 12 hours. Filter out sports with no games soon.
  const eventCache = new EventFetchCache();
  await eventCache.prefetch(requestedKeys);
  const sportKeys = eventCache.filterActive(requestedKeys, 12);
  eventCache.printSummary(requestedKeys, 12);

  if (sportKeys.length === 0) {
    console.log('  [EVENTS] No sports have games in the next 12 hours — live check skipped.\n');
    return;
  }

  // ── Credit guard ────────────────────────────────────────────
  const guard = new CreditBudgetGuard();

  // Only charge for sports not already in the 5-minute in-memory cache.
  const uncachedCount = countUncachedSports(sportKeys);
  if (uncachedCount > 0) {
    const oddsCheck = guard.canSpend('odds', uncachedCount);
    if (!oddsCheck.allowed) {
      console.warn(`[CreditGuard] Live check blocked: ${oddsCheck.reason} (estimated ${oddsCheck.estimatedCost} credits, ${uncachedCount} uncached sports)`);
      guard.printStatus();
      return;
    }
    guard.spend('odds', uncachedCount);
  }

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

  // ── Decision layer ──────────────────────────────────────────
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    // Phase A — Step 1: Data integrity validation
    const todayEvents    = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
    const validResult    = validateDataIntegrity(decisionCandidates, todayEvents);
    printValidationSummary(validResult);
    const qualResult         = qualifyCandidates(validResult.valid);
    const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
    printQualificationSummary(qualResult);
    const enriched           = enrichWithProbability(allCandidates);
    printProbabilitySummary(enriched);
    const outcomeContext: OutcomeContext = {
      gameSummaries: allSummaries.map(e => ({
        eventId:  e.eventId,
        homeTeam: e.homeTeam,
        awayTeam: e.awayTeam,
        matchup:  e.matchup,
      })),
    };
    const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
    printOutcomeSummary(withOutcome);
    const withIntel          = applySportIntelligence(withOutcome);
    printIntelSummary(withIntel);
    // Phase A — Step 3: Signal diversity classification (before risk)
    const withDiversity      = applySignalDiversity(withIntel);
    printSignalDiversitySummary(withDiversity);
    // Key number adjustment — spread proximity risk (after diversity, before risk engine)
    const withKeyNumbers     = applyKeyNumbers(withDiversity);
    printKeyNumberSummary(withKeyNumbers);
    const withRisk           = applyRisk(withKeyNumbers);
    printRiskSummary(withRisk);
    const labeled            = labelCandidates(withRisk);
    printLabelSummary(labeled);
    const slateResult        = selectSlate(labeled);
    printSlateSummary(slateResult);
    printFinalCard(slateResult);
  } catch (e) { console.warn(`  [DECISION LAYER] pipeline error — final card unavailable: ${e instanceof Error ? e.message : String(e)}`); }

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
