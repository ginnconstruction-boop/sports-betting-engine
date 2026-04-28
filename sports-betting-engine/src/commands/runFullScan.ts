import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota, countUncachedSports } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { saveSnapshot } from '../services/snapshotStore';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';
// -- Decision layer --
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
import { CreditBudgetGuard } from '../services/creditBudgetGuard';
import { EventFetchCache } from '../services/eventFetchCache';
import { applyKeyNumbers, printKeyNumberSummary } from '../services/keyNumberEngine';

export async function runFullScan(options: { forceRefresh?: boolean } = {}) {
  const allSportKeys = getEnabledSports().map(s => s.key);

  // ── Credit guard ────────────────────────────────────────────
  // Instantiated once per run. canSpend() is checked before each credit-consuming
  // API call; spend() reserves the credits immediately after the check passes.
  const guard = new CreditBudgetGuard();

  // ── Free event pre-flight (0 credits) ───────────────────────
  // Fetch upcoming event IDs for every sport before spending credits.
  // Sports with no games in the next 24h are filtered out — no point
  // pulling odds for off-season sports.
  const eventCache = new EventFetchCache();
  await eventCache.prefetch(allSportKeys);
  const sportKeys = eventCache.filterActive(allSportKeys, 24);
  eventCache.printSummary(allSportKeys, 24);

  if (sportKeys.length === 0) {
    console.log('  [EVENTS] No sports have games in the next 24 hours — skipping full scan.\n');
    return;
  }

  // Only charge for sports not already in the 5-minute in-memory cache.
  const uncachedCount = countUncachedSports(sportKeys);
  if (uncachedCount > 0) {
    const oddsCheck = guard.canSpend('odds', uncachedCount);
    if (!oddsCheck.allowed) {
      console.warn(`[CreditGuard] Full scan blocked: ${oddsCheck.reason} (estimated ${oddsCheck.estimatedCost} credits, ${uncachedCount} uncached sports)`);
      guard.printStatus();
      return;
    }
    guard.spend('odds', uncachedCount);
  }

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

  // OutcomeContext — provides gameSummaries so applyATSSignal can resolve
  // home/away for each candidate. Built once and reused across all decision
  // layer blocks. No additional API calls required.
  const outcomeContext: OutcomeContext = {
    gameSummaries: allSummaries.map(e => ({
      eventId:  e.eventId,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      matchup:  e.matchup,
    })),
  };

  const topBets = getTopBets(allSummaries, 20, { windowHours: 24 }); // 20 candidates, sport diversity auto-applies
  printTopTen(topBets, 24);

  // -- [DECISION LAYER] Qualification pass --
  // Full scan has no intelligence maps (bare odds only) -- the qualification
  // engine degrades gracefully: price and signal rules still apply;
  // the time-window rule uses hoursUntilGame which scoreAllBets always sets.
  // Appended after existing output; does not affect scores, ranking, or saves.
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const todayEvents = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
    const validResult = validateDataIntegrity(decisionCandidates, todayEvents);
    printValidationSummary(validResult);
    const qualResult  = qualifyCandidates(validResult.valid);
    printQualificationSummary(qualResult);
  } catch (e) { console.warn(`  [DECISION LAYER] qualification pass error: ${e instanceof Error ? e.message : String(e)}`); }

  // -- [DECISION LAYER] Probability enrichment --
  // Independent block -- remaps from topBets directly.
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const enriched = enrichWithProbability(decisionCandidates);
    printProbabilitySummary(enriched);
  } catch (e) { console.warn(`  [DECISION LAYER] probability enrichment error: ${e instanceof Error ? e.message : String(e)}`); }

  // -- [DECISION LAYER] Risk engine --
  // Independent block -- does not filter; only adds risk fields and prints summary.
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const enriched           = enrichWithProbability(decisionCandidates);
    const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
    const withIntel          = applySportIntelligence(withOutcome);
    printIntelSummary(withIntel);
    const withDiversity      = applySignalDiversity(withIntel);
    printSignalDiversitySummary(withDiversity);
    const withKeyNumbers     = applyKeyNumbers(withDiversity);
    printKeyNumberSummary(withKeyNumbers);
    const withRisk           = applyRisk(withKeyNumbers);
    printRiskSummary(withRisk);
  } catch (e) { console.warn(`  [DECISION LAYER] risk engine error: ${e instanceof Error ? e.message : String(e)}`); }

  // -- [DECISION LAYER] Label engine --
  // Independent block -- does not affect existing output, saves, or alerts.
  // qualifyCandidates is called here so qualificationPassed is set before
  // labelCandidates runs (the mapper initialises it to false by default).
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const todayEvents        = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
    const validResult        = validateDataIntegrity(decisionCandidates, todayEvents);
    const qualResult         = qualifyCandidates(validResult.valid);
    const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
    const enriched           = enrichWithProbability(allCandidates);
    const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
    const withIntel          = applySportIntelligence(withOutcome);
    const withDiversity      = applySignalDiversity(withIntel);
    const withKeyNumbers     = applyKeyNumbers(withDiversity);
    const withRisk           = applyRisk(withKeyNumbers);
    const labeled            = labelCandidates(withRisk);
    printLabelSummary(labeled);
  } catch (e) { console.warn(`  [DECISION LAYER] label engine error: ${e instanceof Error ? e.message : String(e)}`); }

  // -- [DECISION LAYER] Slate selector --
  // Independent block -- identifies best candidates and the single Best Bet
  // of the Slate.  Does NOT affect existing output, saves, or alerts.
  try {
    const decisionCandidates = mapAllToDecisionCandidates(topBets);
    const todayEvents        = allSummaries.map(e => ({ matchup: e.matchup, homeTeam: e.homeTeam, awayTeam: e.awayTeam }));
    const validResult        = validateDataIntegrity(decisionCandidates, todayEvents);
    const qualResult         = qualifyCandidates(validResult.valid);
    const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
    const enriched           = enrichWithProbability(allCandidates);
    const withOutcome        = applyOutcomeSignals(enriched, outcomeContext);
    printOutcomeSummary(withOutcome);
    const withIntel          = applySportIntelligence(withOutcome);
    const withDiversity      = applySignalDiversity(withIntel);
    const withKeyNumbers     = applyKeyNumbers(withDiversity);
    const withRisk           = applyRisk(withKeyNumbers);
    const labeled            = labelCandidates(withRisk);
    const slateResult        = selectSlate(labeled);
    printSlateSummary(slateResult);
    printFinalCard(slateResult);
  } catch (e) { console.warn(`  [DECISION LAYER] slate/final card error — final card unavailable: ${e instanceof Error ? e.message : String(e)}`); }

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
