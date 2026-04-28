import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
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
import { selectSlate, printSlateSummary } from '../services/slateSelector';
import { validateDataIntegrity, printValidationSummary } from '../services/dataIntegrityValidator';
import { applySignalDiversity, printSignalDiversitySummary } from '../services/signalDiversityEngine';
import { applyOutcomeSignals, printOutcomeSummary, OutcomeContext } from '../services/outcomeSignalEngine';

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
    const withRisk           = applyRisk(withDiversity);
    printRiskSummary(withRisk);
    const labeled            = labelCandidates(withRisk);
    printLabelSummary(labeled);
    const slateResult        = selectSlate(labeled);
    printSlateSummary(slateResult);
  } catch { }

  console.log(`  API requests used : ${quota.requestsMade}`);
  console.log(`  Credits remaining : ${quota.remainingRequests ?? 'unknown'}\n`);
}
