// ============================================================
// src/commands/runLateGames.ts
// Late-game scan -- all in-season sports, 90-minute window
// Lightweight: skips heavy per-game intelligence (power ratings,
// player impact, lineups) to run fast. Sharp intel + injuries only.
// ============================================================

import * as dotenv from 'dotenv';
dotenv.config();

import { getOddsForAllSports, getSessionQuota } from '../api/oddsApiClient';
import { normalizeEvents } from '../services/normalizeOdds';
import { aggregateAllEvents } from '../services/aggregateMarkets';
import { getTopBets, printTopTen } from '../services/topTenBets';
import { analyzeSharpIntelligence } from '../services/sharpIntelligence';
import { getESPNInjuries } from '../services/espnData';
import { buildAllContextPackages } from '../services/contextIntelligence';
import { detectSteamMoves } from '../services/steamDetector';
import { loadSignalWeights } from '../services/retroAnalysis';
import { getEnabledSports } from '../config/sports';
import { INITIAL_MARKETS, EventSummary } from '../types/odds';
import { mapAllToDecisionCandidates } from '../services/decisionTypes';
import { qualifyCandidates, printQualificationSummary } from '../services/qualificationEngine';
import { enrichWithProbability, printProbabilitySummary } from '../services/probabilityEngine';
import { applyRisk, printRiskSummary } from '../services/riskEngine';
import { applySportIntelligence, printIntelSummary } from '../services/sportIntelligenceEngine';
import { labelCandidates, printLabelSummary } from '../services/labelEngine';
import { selectSlate, printSlateSummary } from '../services/slateSelector';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
async function safeRun<T>(fn: () => Promise<T>, fallback: T, timeoutMs = 25000): Promise<T> {
  try { return await withTimeout(fn(), timeoutMs, fn.name || 'step'); } catch { return fallback; }
}
function safeSync<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export async function runLateGames(options: { forceRefresh?: boolean } = {}) {
  const WINDOW_HOURS = 1.5; // games starting within 90 minutes

  console.log('\n');
  console.log('=================================================================');
  console.log('  LATE GAMES -- Next 90 Minutes');
  console.log('=================================================================');
  console.log(`  Scanning for games starting within ${WINDOW_HOURS * 60} minutes...\n`);

  const sportKeys = getEnabledSports(true).map(s => s.key);
  if (sportKeys.length === 0) {
    console.log('  No in-season sports configured. Check src/config/sports.ts.');
    return;
  }

  console.log(`  Active sports: ${sportKeys.join(', ')}`);

  // -- Fetch odds for all in-season sports -------------------
  const { results: rawBySport } = await getOddsForAllSports(
    sportKeys, INITIAL_MARKETS, options.forceRefresh ?? false
  );

  const allSummaries: EventSummary[] = [];
  for (const [sportKey, events] of rawBySport) {
    const rows = normalizeEvents(events, sportKey);
    allSummaries.push(...aggregateAllEvents(rows));
  }

  // Filter to only games in the 90-min window
  const now = Date.now();
  const lateSummaries = allSummaries.filter(e => {
    const hours = (new Date(e.startTime).getTime() - now) / 3600000;
    return hours >= 0 && hours <= WINDOW_HOURS;
  });

  if (lateSummaries.length === 0) {
    console.log(`\n  No games found starting within the next ${WINDOW_HOURS * 60} minutes.`);
    console.log('  Check back closer to tip-off.\n');
    return;
  }

  console.log(`  Found ${lateSummaries.length} game(s) starting soon:\n`);
  for (const e of lateSummaries) {
    const mins = Math.round((new Date(e.startTime).getTime() - now) / 60000);
    console.log(`  >> ${e.sport.padEnd(6)} ${e.matchup}  (~${mins} min)`);
  }
  console.log('');

  // -- Lightweight intelligence: sharp + injuries + context --
  const sharpIntel = safeSync(() => analyzeSharpIntelligence(lateSummaries), new Map());
  const steamMoves = safeSync(() => detectSteamMoves(lateSummaries), []);

  const injuryMap = new Map<string, any[]>();
  const sportsInWindow = [...new Set(lateSummaries.map(e => e.sportKey))];
  for (const sportKey of sportsInWindow) {
    await safeRun(async () => {
      const injuries = await getESPNInjuries(sportKey);
      for (const [team, list] of injuries) {
        for (const event of lateSummaries) {
          const homeLast = event.homeTeam.split(' ').pop() ?? '';
          const awayLast = event.awayTeam.split(' ').pop() ?? '';
          if (team.includes(homeLast) || team.includes(awayLast)) {
            const existing = injuryMap.get(event.eventId) ?? [];
            injuryMap.set(event.eventId, [...existing, ...list]);
          }
        }
      }
    }, undefined);
  }

  const contextMap = await safeRun(
    () => buildAllContextPackages(lateSummaries.map(e => ({
      eventId: e.eventId, matchup: e.matchup, sportKey: e.sportKey,
      homeTeam: e.homeTeam, awayTeam: e.awayTeam, gameTime: e.startTime,
    }))),
    new Map()
  );

  const learnedWeights = safeSync(() => loadSignalWeights(), {});

  // -- Score and print ----------------------------------------
  const topBets = getTopBets(lateSummaries, 10, {
    windowHours: WINDOW_HOURS,
    singleSport: true,
    sharpIntel, injuryMap, contextMap, steamMoves, learnedWeights,
  });

  if (topBets.length === 0) {
    console.log('  No qualifying plays found in the 90-minute window.');
    console.log('  Games may not meet minimum signal/book requirements.\n');
  } else {
    printTopTen(topBets, WINDOW_HOURS);

    // ── Decision layer ────────────────────────────────────────
    safeSync(() => {
      const decisionCandidates = mapAllToDecisionCandidates(topBets);
      const qualResult         = qualifyCandidates(decisionCandidates);
      const allCandidates      = [...qualResult.qualified, ...qualResult.rejected];
      printQualificationSummary(qualResult);
      const enriched           = enrichWithProbability(allCandidates);
      printProbabilitySummary(enriched);
      const withIntel          = applySportIntelligence(enriched);
      printIntelSummary(withIntel);
      const withRisk           = applyRisk(withIntel);
      printRiskSummary(withRisk);
      const labeled            = labelCandidates(withRisk);
      printLabelSummary(labeled);
      const slateResult        = selectSlate(labeled);
      printSlateSummary(slateResult);
    }, undefined);
  }

  const quota = await safeRun(() => getSessionQuota(), { requestsMade: 0, remainingRequests: null });
  console.log(`\n  API requests used  : ${quota.requestsMade}`);
  console.log(`  Credits remaining  : ${quota.remainingRequests ?? 'unknown'}\n`);
}
